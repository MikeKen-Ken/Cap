import { convertFileSrc } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { remove } from "@tauri-apps/plugin-fs";
import { createSignal, onCleanup, onMount } from "solid-js";
import {
	normalizePinAngle,
	PIN_ROTATE_STEP_DEGREES,
	type PinSize,
	pinKeyToRotationSteps,
	pinKeyToTransparencyLevel,
	pinTransparencyToOpacity,
	rotatedPinBounds,
} from "~/utils/pinned-image";
import IconLucideX from "~icons/lucide/x";

export default function PinPage() {
	const currentWindow = getCurrentWebviewWindow();
	const params = new URLSearchParams(location.search);
	const src = params.get("src") ?? "";
	const size: PinSize = {
		width: Number(params.get("w")) || 320,
		height: Number(params.get("h")) || 240,
	};

	const [angle, setAngle] = createSignal(0);
	const [opacity, setOpacity] = createSignal(1);
	let targetAngle = 0;
	let layoutQueue: Promise<void> = Promise.resolve();
	let closing = false;

	const applyAngle = async (nextAngle: number) => {
		const scale = await currentWindow.scaleFactor();
		const position = (await currentWindow.outerPosition()).toLogical(scale);
		const current = (await currentWindow.innerSize()).toLogical(scale);
		const next = rotatedPinBounds(size, nextAngle);
		const centerX = position.x + current.width / 2;
		const centerY = position.y + current.height / 2;

		setAngle(nextAngle);
		await currentWindow.setSize(new LogicalSize(next.width, next.height));
		await currentWindow.setPosition(
			new LogicalPosition(
				Math.round(centerX - next.width / 2),
				Math.round(centerY - next.height / 2),
			),
		);
	};

	const rotate = (steps: number) => {
		targetAngle = normalizePinAngle(
			targetAngle + steps * PIN_ROTATE_STEP_DEGREES,
		);
		const nextAngle = targetAngle;
		layoutQueue = layoutQueue
			.then(() => applyAngle(nextAngle))
			.catch((error) => console.error("Failed to rotate pinned image:", error));
	};

	const closePin = async () => {
		if (closing) return;
		closing = true;
		await remove(src).catch(() => undefined);
		await currentWindow.destroy();
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

	onMount(() => {
		document.documentElement.setAttribute("data-transparent-window", "true");
		document.body.style.background = "transparent";
		window.addEventListener("keydown", onKeyDown);

		const unlistenClose = currentWindow.onCloseRequested((event) => {
			event.preventDefault();
			void closePin();
		});
		onCleanup(() => {
			window.removeEventListener("keydown", onKeyDown);
			void unlistenClose.then((unlisten) => unlisten());
		});
	});

	const reveal = async () => {
		await currentWindow.show();
		await currentWindow.setFocus();
	};

	return (
		<div class="group relative w-screen h-screen overflow-hidden select-none">
			<img
				src={convertFileSrc(src)}
				alt=""
				draggable={false}
				onLoad={() => void reveal()}
				onMouseDown={(event) => {
					if (event.button === 0) void currentWindow.startDragging();
				}}
				class="absolute cursor-move"
				style={{
					left: "50%",
					top: "50%",
					width: `${size.width}px`,
					height: `${size.height}px`,
					transform: `translate(-50%, -50%) rotate(${angle()}deg)`,
					opacity: opacity(),
					outline: "1px solid rgba(0, 0, 0, 0.25)",
					"outline-offset": "-1px",
				}}
			/>
			<button
				type="button"
				aria-label="Close pinned image"
				onClick={() => void closePin()}
				class="absolute top-1 right-1 flex items-center justify-center rounded-full size-6 bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
			>
				<IconLucideX class="size-3.5" />
			</button>
		</div>
	);
}
