import { createSignal, onCleanup, onMount } from "solid-js";
import type { CropBounds } from "~/components/Cropper";

export const AREA_HANDOFF_KEY = "target-select-area-handoff-v1";
export const AREA_HANDOFF_ACK_KEY = "target-select-area-handoff-ack-v1";

export type ScreenRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type AreaHandoffPhase = "move" | "drop" | "cancel";

export type AreaHandoffMessage = {
	seq: number;
	fromScreenId: string;
	phase: AreaHandoffPhase;
	bounds: ScreenRect;
	cursorX: number;
	cursorY: number;
};

export type AreaHandoffAck = {
	seq: number;
	fromScreenId: string;
	byScreenId: string;
	phase: "preview" | "accept";
};

export function windowFrame(): ScreenRect {
	return {
		x: window.screenX,
		y: window.screenY,
		width: window.innerWidth,
		height: window.innerHeight,
	};
}

export function containsPoint(
	frame: ScreenRect,
	x: number,
	y: number,
): boolean {
	return (
		x >= frame.x &&
		y >= frame.y &&
		x < frame.x + frame.width &&
		y < frame.y + frame.height
	);
}

export function selectionOnWindow(
	bounds: ScreenRect,
	frame: ScreenRect,
): CropBounds | null {
	const width = Math.min(Math.max(bounds.width, 0), frame.width);
	const height = Math.min(Math.max(bounds.height, 0), frame.height);
	if (width < 1 || height < 1) return null;
	const maxX = Math.max(0, frame.width - width);
	const maxY = Math.max(0, frame.height - height);
	return {
		x: Math.min(Math.max(0, bounds.x - frame.x), maxX),
		y: Math.min(Math.max(0, bounds.y - frame.y), maxY),
		width,
		height,
	};
}

export function parseAreaHandoff(
	value: string | null,
): AreaHandoffMessage | null {
	return parseMessage(value, isHandoff);
}

export function parseAreaHandoffAck(
	value: string | null,
): AreaHandoffAck | null {
	return parseMessage(value, isAck);
}

function parseMessage<T>(
	value: string | null,
	guard: (value: unknown) => value is T,
): T | null {
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return guard(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function isRect(value: unknown): value is ScreenRect {
	if (!value || typeof value !== "object") return false;
	const rect = value as ScreenRect;
	return [rect.x, rect.y, rect.width, rect.height].every(
		(part) => typeof part === "number" && Number.isFinite(part),
	);
}

function isHandoff(value: unknown): value is AreaHandoffMessage {
	if (!value || typeof value !== "object") return false;
	const message = value as AreaHandoffMessage;
	return (
		typeof message.seq === "number" &&
		typeof message.fromScreenId === "string" &&
		(message.phase === "move" ||
			message.phase === "drop" ||
			message.phase === "cancel") &&
		isRect(message.bounds) &&
		typeof message.cursorX === "number" &&
		typeof message.cursorY === "number"
	);
}

function isAck(value: unknown): value is AreaHandoffAck {
	if (!value || typeof value !== "object") return false;
	const ack = value as AreaHandoffAck;
	return (
		typeof ack.seq === "number" &&
		typeof ack.fromScreenId === "string" &&
		typeof ack.byScreenId === "string" &&
		(ack.phase === "preview" || ack.phase === "accept")
	);
}

function writeStorage(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// A private-mode or full store should not abort the drag.
	}
}

export function createAreaDisplayHandoff(options: {
	screenId: () => string;
	crop: () => CropBounds;
	interacting: () => boolean;
	applyCrop: (bounds: CropBounds) => void;
	clearCrop: () => void;
	onAccept: (bounds: CropBounds) => void;
	claimActive: () => void;
	releaseActive: () => void;
}) {
	const [handedOff, setHandedOff] = createSignal(false);
	const [receiving, setReceiving] = createSignal(false);
	const [cursorOutside, setCursorOutside] = createSignal(false);
	let outboundSeq = 0;
	let offset = { dx: 0, dy: 0 };
	let lastMove: AreaHandoffMessage | null = null;
	let awaitingClear: number | null = null;
	let preview: { seq: number; fromScreenId: string } | null = null;
	let giveUpTimer: number | undefined;
	let moveFrame = 0;
	let pendingMove: PointerEvent | null = null;

	const publish = (message: AreaHandoffMessage) => {
		lastMove = message;
		writeStorage(AREA_HANDOFF_KEY, message);
	};

	const clearGiveUp = () => {
		if (giveUpTimer !== undefined) {
			window.clearTimeout(giveUpTimer);
			giveUpTimer = undefined;
		}
	};

	const dropPreview = () => {
		if (!preview) return;
		options.clearCrop();
		options.releaseActive();
		preview = null;
		setReceiving(false);
	};

	const applyIncoming = (message: AreaHandoffMessage) => {
		if (message.fromScreenId === options.screenId()) return;
		const frame = windowFrame();
		const inside = containsPoint(frame, message.cursorX, message.cursorY);
		if (message.phase === "cancel" || !inside) {
			if (
				preview?.seq === message.seq &&
				preview.fromScreenId === message.fromScreenId
			) {
				dropPreview();
			}
			return;
		}
		const local = selectionOnWindow(message.bounds, frame);
		if (!local) return;
		options.applyCrop(local);
		options.claimActive();
		preview = { seq: message.seq, fromScreenId: message.fromScreenId };
		setReceiving(message.phase === "move");
		writeStorage(AREA_HANDOFF_ACK_KEY, {
			seq: message.seq,
			fromScreenId: message.fromScreenId,
			byScreenId: options.screenId(),
			phase: message.phase === "drop" ? "accept" : "preview",
		} satisfies AreaHandoffAck);
		if (message.phase === "drop") {
			setReceiving(false);
			preview = null;
			options.onAccept(local);
		}
	};

	const publishMove = (event: PointerEvent) => {
		const frame = windowFrame();
		const outside = !containsPoint(frame, event.screenX, event.screenY);
		if (!outside) {
			const bounds = options.crop();
			offset = {
				dx: event.screenX - (frame.x + bounds.x),
				dy: event.screenY - (frame.y + bounds.y),
			};
			if (cursorOutside()) {
				publish({
					seq: outboundSeq,
					fromScreenId: options.screenId(),
					phase: "cancel",
					bounds: {
						x: frame.x + bounds.x,
						y: frame.y + bounds.y,
						width: bounds.width,
						height: bounds.height,
					},
					cursorX: event.screenX,
					cursorY: event.screenY,
				});
				setCursorOutside(false);
				setHandedOff(false);
			}
			return;
		}
		const bounds = options.crop();
		if (bounds.width < 1 || bounds.height < 1) return;
		setCursorOutside(true);
		publish({
			seq: outboundSeq,
			fromScreenId: options.screenId(),
			phase: "move",
			bounds: {
				x: event.screenX - offset.dx,
				y: event.screenY - offset.dy,
				width: bounds.width,
				height: bounds.height,
			},
			cursorX: event.screenX,
			cursorY: event.screenY,
		});
	};

	onMount(() => {
		const onStorage = (event: StorageEvent) => {
			if (event.key === AREA_HANDOFF_KEY) {
				const message = parseAreaHandoff(event.newValue);
				if (message) applyIncoming(message);
				return;
			}
			if (event.key !== AREA_HANDOFF_ACK_KEY) return;
			const ack = parseAreaHandoffAck(event.newValue);
			if (!ack || ack.fromScreenId !== options.screenId()) return;
			if (ack.phase === "preview" && ack.seq === outboundSeq) {
				setHandedOff(true);
				return;
			}
			if (ack.phase === "accept" && ack.seq === awaitingClear) {
				clearGiveUp();
				awaitingClear = null;
				if (!options.interacting()) options.clearCrop();
				setHandedOff(false);
				setCursorOutside(false);
			}
		};

		const onPointerDown = (event: PointerEvent) => {
			if (event.button !== 0) return;
			outboundSeq += 1;
			lastMove = null;
			const frame = windowFrame();
			const bounds = options.crop();
			offset = {
				dx: event.screenX - (frame.x + bounds.x),
				dy: event.screenY - (frame.y + bounds.y),
			};
			setCursorOutside(false);
			setHandedOff(false);
		};

		const onPointerMove = (event: PointerEvent) => {
			if (!options.interacting()) return;
			pendingMove = event;
			if (moveFrame) return;
			moveFrame = window.requestAnimationFrame(() => {
				moveFrame = 0;
				const next = pendingMove;
				pendingMove = null;
				if (next && options.interacting()) publishMove(next);
			});
		};

		const onPointerUp = (event: PointerEvent) => {
			if (moveFrame) {
				window.cancelAnimationFrame(moveFrame);
				moveFrame = 0;
			}
			pendingMove = null;
			if (options.interacting()) publishMove(event);
			if (!cursorOutside() || !lastMove || lastMove.phase === "cancel") return;
			awaitingClear = outboundSeq;
			publish({ ...lastMove, phase: "drop" });
			clearGiveUp();
			const seq = outboundSeq;
			giveUpTimer = window.setTimeout(() => {
				if (awaitingClear !== seq) return;
				awaitingClear = null;
				setHandedOff(false);
				setCursorOutside(false);
			}, 200);
		};

		window.addEventListener("storage", onStorage);
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("pointermove", onPointerMove, true);
		window.addEventListener("pointerup", onPointerUp, true);
		window.addEventListener("pointercancel", onPointerUp, true);
		onCleanup(() => {
			window.removeEventListener("storage", onStorage);
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("pointermove", onPointerMove, true);
			window.removeEventListener("pointerup", onPointerUp, true);
			window.removeEventListener("pointercancel", onPointerUp, true);
			if (moveFrame) window.cancelAnimationFrame(moveFrame);
			clearGiveUp();
		});
	});

	return { handedOff, receiving, cursorOutside };
}
