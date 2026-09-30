import { convertFileSrc } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import {
	CheckMenuItem,
	Menu,
	MenuItem,
	PredefinedMenuItem,
	Submenu,
} from "@tauri-apps/api/menu";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { cursorPosition } from "@tauri-apps/api/window";
import { remove } from "@tauri-apps/plugin-fs";
import { cx } from "cva";
import { createSignal, onCleanup, onMount } from "solid-js";
import {
	clampPinScale,
	normalizePinAngle,
	PIN_ROTATE_STEP_DEGREES,
	type PinPoint,
	type PinSize,
	pinCursorTarget,
	pinKeyToRotationSteps,
	pinKeyToTransparencyLevel,
	pinScaleFromWheel,
	pinTransparencyToOpacity,
	pinWheelDelta,
	pinZoomAnchorPosition,
	rotatedPinBounds,
	scaledPinSize,
} from "~/utils/pinned-image";
import IconLucideX from "~icons/lucide/x";

const HINT_CLASS =
	"pointer-events-none absolute inset-x-2 bottom-2 rounded-md bg-black/70 px-2 py-1 text-center text-[11px] leading-4 text-white transition-opacity";

export default function PinPage() {
	const currentWindow = getCurrentWebviewWindow();
	const params = new URLSearchParams(location.search);
	const src = params.get("src") ?? "";
	const natural = readPinSize(params.get("w"), params.get("h"));
	const screen = () => ({
		width: window.screen.availWidth,
		height: window.screen.availHeight,
	});
	const fittedScale = clampPinScale(
		readPositive(params.get("s"), 1),
		natural,
		screen(),
	);

	const [angle, setAngle] = createSignal(0);
	const [scale, setScale] = createSignal(fittedScale);
	const [opacity, setOpacity] = createSignal(1);
	const [showHint, setShowHint] = createSignal(true);
	const displayed = () => scaledPinSize(natural, scale());

	let targetAngle = 0;
	let targetScale = fittedScale;
	let appliedAngle = 0;
	let appliedScale = fittedScale;
	let zoomAnchor: PinPoint | null = null;
	let layingOut = false;
	let dragging = false;
	let closing = false;
	let menuOpen = false;
	let clickThrough = false;
	let clickThroughBroken = false;
	let readingCursor = false;
	let pollTimer: number | undefined;
	let clickThroughUpdate: Promise<void> = Promise.resolve();

	const displayedNow = () => scaledPinSize(natural, appliedScale);

	const enqueueLayout = (
		nextAngle: number,
		nextScale: number,
		anchor: PinPoint | null,
	) => {
		targetAngle = nextAngle;
		targetScale = nextScale;
		zoomAnchor = anchor;
		if (layingOut) return;
		layingOut = true;
		void drainLayouts();
	};

	const applyLayout = async (job: {
		angle: number;
		scale: number;
		anchor: PinPoint | null;
	}) => {
		const nextImage = scaledPinSize(natural, job.scale);
		const currentImage = displayedNow();
		if (
			job.angle === appliedAngle &&
			nextImage.width === currentImage.width &&
			nextImage.height === currentImage.height
		) {
			setAngle(job.angle);
			setScale(job.scale);
			return;
		}

		const factor = await currentWindow.scaleFactor();
		const outer = (await currentWindow.outerPosition()).toLogical(factor);
		const inner = (await currentWindow.innerPosition()).toLogical(factor);
		const current = (await currentWindow.innerSize()).toLogical(factor);
		const nextBounds = rotatedPinBounds(nextImage, job.angle);
		const contentOrigin = job.anchor
			? pinZoomAnchorPosition(
					{ x: inner.x + job.anchor.x, y: inner.y + job.anchor.y },
					inner,
					current,
					currentImage,
					nextBounds,
					nextImage,
					appliedAngle,
					job.angle,
				)
			: {
					x: Math.round(inner.x + current.width / 2 - nextBounds.width / 2),
					y: Math.round(inner.y + current.height / 2 - nextBounds.height / 2),
				};

		await currentWindow.setSize(
			new LogicalSize(nextBounds.width, nextBounds.height),
		);
		await currentWindow.setPosition(
			new LogicalPosition(
				contentOrigin.x + (outer.x - inner.x),
				contentOrigin.y + (outer.y - inner.y),
			),
		);
		setAngle(job.angle);
		setScale(job.scale);
	};

	const drainLayouts = async () => {
		while (targetAngle !== appliedAngle || targetScale !== appliedScale) {
			const job = {
				angle: targetAngle,
				scale: targetScale,
				anchor: zoomAnchor,
			};
			zoomAnchor = null;
			try {
				await applyLayout(job);
				appliedAngle = job.angle;
				appliedScale = job.scale;
			} catch (error) {
				console.error("Failed to update pinned image:", error);
				targetAngle = appliedAngle;
				targetScale = appliedScale;
				break;
			}
		}
		layingOut = false;
		if (targetAngle !== appliedAngle || targetScale !== appliedScale) {
			layingOut = true;
			void drainLayouts();
			return;
		}
		void syncCursorHit();
	};

	const rotate = (steps: number) => {
		enqueueLayout(
			normalizePinAngle(targetAngle + steps * PIN_ROTATE_STEP_DEGREES),
			targetScale,
			null,
		);
	};

	const resetScale = () => {
		enqueueLayout(targetAngle, fittedScale, null);
	};

	const closePin = async () => {
		if (closing) return;
		closing = true;
		stopPoll();
		await remove(src).catch(() => undefined);
		await currentWindow.destroy();
	};

	const showMenu = async () => {
		if (menuOpen || closing) return;
		menuOpen = true;
		try {
			const currentOpacity = opacity();
			const opacityItems = await Promise.all(
				Array.from({ length: 10 }, (_, level) => {
					const value = pinTransparencyToOpacity(level);
					const percent = Math.round(value * 100);
					return CheckMenuItem.new({
						text: `${percent}%\t${level}`,
						checked: Math.abs(currentOpacity - value) < 0.001,
						action: () => setOpacity(value),
					});
				}),
			);
			const menu = await Menu.new({
				items: [
					await MenuItem.new({
						text: "Rotate Left\tQ",
						action: () => rotate(-1),
					}),
					await MenuItem.new({
						text: "Rotate Right\tE",
						action: () => rotate(1),
					}),
					await Submenu.new({ text: "Opacity\t0-9", items: opacityItems }),
					await PredefinedMenuItem.new({ item: "Separator" }),
					await MenuItem.new({
						text: "Reset Size",
						action: () => resetScale(),
					}),
					await MenuItem.new({
						text: "Close\tEsc",
						action: () => {
							void closePin();
						},
					}),
				],
			});
			await menu.popup();
		} catch (error) {
			console.error("Failed to open pin menu:", error);
		} finally {
			menuOpen = false;
			void syncCursorHit();
		}
	};

	const stopPoll = () => {
		if (pollTimer === undefined) return;
		window.clearInterval(pollTimer);
		pollTimer = undefined;
	};

	// Ignore-cursor mode stops mousemove, so poll until the pointer re-enters.
	const startPoll = () => {
		if (pollTimer !== undefined || clickThroughBroken || closing) return;
		pollTimer = window.setInterval(() => {
			void syncCursorHit();
		}, 32);
	};

	const setClickThrough = (enabled: boolean) => {
		if (clickThroughBroken || closing || menuOpen) return;
		if (clickThrough === enabled) {
			if (enabled) startPoll();
			else stopPoll();
			return;
		}
		clickThrough = enabled;
		if (enabled) startPoll();
		else stopPoll();
		const next = enabled;
		clickThroughUpdate = clickThroughUpdate
			.then(() => currentWindow.setIgnoreCursorEvents(next))
			.catch((error: unknown) => {
				clickThroughBroken = true;
				stopPoll();
				console.error("Failed to update pin click-through:", error);
			});
	};

	const cursorTargetAt = (point: PinPoint, windowSize: PinSize) =>
		pinCursorTarget(point, windowSize, displayed(), angle());

	const syncCursorHit = async () => {
		if (readingCursor || dragging || closing || clickThroughBroken) return;
		readingCursor = true;
		try {
			const factor = await currentWindow.scaleFactor();
			const [cursor, origin, bounds] = await Promise.all([
				cursorPosition(),
				currentWindow.innerPosition(),
				currentWindow.innerSize(),
			]);
			const cursorLogical = cursor.toLogical(factor);
			const originLogical = origin.toLogical(factor);
			const size = bounds.toLogical(factor);
			setClickThrough(
				cursorTargetAt(
					{
						x: cursorLogical.x - originLogical.x,
						y: cursorLogical.y - originLogical.y,
					},
					size,
				) === "margin",
			);
		} catch (error) {
			clickThroughBroken = true;
			stopPoll();
			console.error("Failed to track pin cursor:", error);
		} finally {
			readingCursor = false;
		}
	};

	const onMouseMove = (event: MouseEvent) => {
		if (dragging || closing) return;
		setClickThrough(
			cursorTargetAt(
				{ x: event.clientX, y: event.clientY },
				{ width: window.innerWidth, height: window.innerHeight },
			) === "margin",
		);
	};

	const endDrag = () => {
		if (!dragging) return;
		dragging = false;
		void syncCursorHit();
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.ctrlKey || event.metaKey || event.altKey) return;

		if (event.key === "Escape") {
			void closePin();
			return;
		}

		const level = pinKeyToTransparencyLevel(event.key);
		if (level !== null) {
			setOpacity(pinTransparencyToOpacity(level));
			return;
		}

		const steps = pinKeyToRotationSteps(event.key);
		if (steps !== 0) rotate(steps);
	};

	const onWheel = (event: WheelEvent) => {
		event.preventDefault();
		const nextScale = pinScaleFromWheel(
			targetScale,
			pinWheelDelta(event.deltaY, event.deltaMode),
			natural,
			screen(),
		);
		if (nextScale === targetScale) return;
		enqueueLayout(targetAngle, nextScale, {
			x: event.clientX,
			y: event.clientY,
		});
	};

	onMount(() => {
		document.documentElement.setAttribute("data-transparent-window", "true");
		document.body.style.background = "transparent";
		const hintTimer = window.setTimeout(() => setShowHint(false), 2500);
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("wheel", onWheel, { passive: false });
		window.addEventListener("mouseup", endDrag);
		window.addEventListener("blur", endDrag);

		const unlistenClose = currentWindow.onCloseRequested((event) => {
			event.preventDefault();
			void closePin();
		});
		onCleanup(() => {
			window.clearTimeout(hintTimer);
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("wheel", onWheel);
			window.removeEventListener("mouseup", endDrag);
			window.removeEventListener("blur", endDrag);
			stopPoll();
			if (clickThrough) {
				void currentWindow.setIgnoreCursorEvents(false).catch(() => undefined);
			}
			void unlistenClose.then((unlisten) => unlisten());
		});
	});

	const reveal = async () => {
		await currentWindow.show();
		await currentWindow.setFocus();
	};

	return (
		<div
			class="relative h-screen w-screen select-none overflow-hidden"
			onMouseMove={onMouseMove}
			onContextMenu={(event) => {
				event.preventDefault();
				if (
					cursorTargetAt(
						{ x: event.clientX, y: event.clientY },
						{ width: window.innerWidth, height: window.innerHeight },
					) === "image"
				) {
					void showMenu();
				}
			}}
		>
			<div
				class="group absolute cursor-move overflow-hidden"
				style={{
					left: "50%",
					top: "50%",
					width: `${displayed().width}px`,
					height: `${displayed().height}px`,
					transform: `translate(-50%, -50%) rotate(${angle()}deg)`,
				}}
				onMouseDown={(event) => {
					if (event.button !== 0) return;
					dragging = true;
					setClickThrough(false);
					void currentWindow.startDragging();
				}}
			>
				<img
					src={convertFileSrc(src)}
					alt=""
					draggable={false}
					onLoad={() => void reveal()}
					class="size-full"
					style={{
						opacity: opacity(),
						outline: "1px solid rgba(0, 0, 0, 0.25)",
						"outline-offset": "-1px",
					}}
				/>
				<button
					type="button"
					aria-label="Close pinned image"
					onMouseDown={(event) => event.stopPropagation()}
					onClick={() => void closePin()}
					class="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
					style={{ transform: `rotate(${-angle()}deg)` }}
				>
					<IconLucideX class="size-3.5" />
				</button>
				<p
					class={cx(
						HINT_CLASS,
						showHint() ? "opacity-100" : "opacity-0 group-hover:opacity-100",
					)}
				>
					Scroll to resize · Q/E rotate · 0-9 opacity · Right-click for menu
				</p>
			</div>
		</div>
	);
}

function readPositive(value: string | null, fallback: number) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPinSize(width: string | null, height: string | null): PinSize {
	return {
		width: readPositive(width, 320),
		height: readPositive(height, 240),
	};
}
