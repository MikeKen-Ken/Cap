export const PIN_ROTATE_STEP_DEGREES = 15;
export const PIN_SCREEN_FILL_LIMIT = 0.9;
export const PIN_MIN_OPACITY = 0.1;
export const PIN_MIN_EDGE = 48;
export const PIN_MAX_SCALE = 4;
export const STALE_PIN_AGE_MS = 24 * 60 * 60 * 1000;

const PIN_WHEEL_SENSITIVITY = 0.0015;
const PIN_HIT_SLOP = 2;

export type PinSize = { width: number; height: number };
export type PinPoint = { x: number; y: number };
export type PinCursorTarget = "image" | "margin" | "outside";

export function pinTransparencyToOpacity(level: number) {
	const clamped = Math.min(9, Math.max(0, Math.round(level)));
	return Math.max(PIN_MIN_OPACITY, 1 - clamped / 10);
}

export function pinKeyToTransparencyLevel(key: string) {
	return /^[0-9]$/.test(key) ? Number(key) : null;
}

export function pinKeyToRotationSteps(key: string) {
	switch (key.toLowerCase()) {
		case "q":
			return -1;
		case "e":
			return 1;
		default:
			return 0;
	}
}

export function normalizePinAngle(degrees: number) {
	return ((degrees % 360) + 360) % 360;
}

export function pinAngleHasEmptyCorners(degrees: number) {
	const quarterTurn = normalizePinAngle(degrees) % 90;
	return quarterTurn > 0.01 && quarterTurn < 89.99;
}

export function rotatedPinBounds(size: PinSize, degrees: number): PinSize {
	const radians = (degrees * Math.PI) / 180;
	const cos = Math.abs(Math.cos(radians));
	const sin = Math.abs(Math.sin(radians));
	return {
		width: Math.ceil(size.width * cos + size.height * sin - 1e-6),
		height: Math.ceil(size.width * sin + size.height * cos - 1e-6),
	};
}

export function naturalPinSize(
	pixels: PinSize,
	devicePixelRatio: number,
): PinSize {
	const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
	return {
		width: Math.max(1, Math.round(pixels.width / ratio)),
		height: Math.max(1, Math.round(pixels.height / ratio)),
	};
}

export function pinFitScale(natural: PinSize, screen: PinSize) {
	if (natural.width <= 0 || natural.height <= 0) return 1;
	return Math.min(
		1,
		(screen.width * PIN_SCREEN_FILL_LIMIT) / natural.width,
		(screen.height * PIN_SCREEN_FILL_LIMIT) / natural.height,
	);
}

export function scaledPinSize(image: PinSize, scale: number): PinSize {
	return {
		width: Math.max(1, Math.round(image.width * scale)),
		height: Math.max(1, Math.round(image.height * scale)),
	};
}

export function fitPinSize(
	pixels: PinSize,
	devicePixelRatio: number,
	screen: PinSize,
): PinSize {
	const natural = naturalPinSize(pixels, devicePixelRatio);
	return scaledPinSize(natural, pinFitScale(natural, screen));
}

export function clampPinScale(scale: number, image: PinSize, screen: PinSize) {
	if (!Number.isFinite(scale)) return 1;
	const minEdge = Math.min(image.width, image.height);
	const maxEdge = Math.max(image.width, image.height);
	const screenEdge = Math.max(screen.width, screen.height);
	const minScale = minEdge > PIN_MIN_EDGE ? PIN_MIN_EDGE / minEdge : 1;
	const maxScale =
		maxEdge > 0 && screenEdge > 0
			? Math.max(1, Math.min(PIN_MAX_SCALE, screenEdge / maxEdge))
			: 1;
	return Math.min(maxScale, Math.max(minScale, scale));
}

export function pinWheelDelta(deltaY: number, deltaMode: number) {
	if (deltaMode === 1) return deltaY * 16;
	if (deltaMode === 2) return deltaY * 800;
	return deltaY;
}

export function pinScaleFromWheel(
	scale: number,
	deltaY: number,
	image: PinSize,
	screen: PinSize,
) {
	if (deltaY === 0) return clampPinScale(scale, image, screen);
	return clampPinScale(
		scale * Math.exp(-deltaY * PIN_WHEEL_SENSITIVITY),
		image,
		screen,
	);
}

function rotatePinPoint(point: PinPoint, degrees: number): PinPoint {
	const radians = (degrees * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return {
		x: point.x * cos - point.y * sin,
		y: point.x * sin + point.y * cos,
	};
}

function unrotatePinPoint(point: PinPoint, degrees: number): PinPoint {
	const radians = (degrees * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return {
		x: point.x * cos + point.y * sin,
		y: -point.x * sin + point.y * cos,
	};
}

export function pinPointInImage(
	point: PinPoint,
	windowSize: PinSize,
	imageSize: PinSize,
	degrees: number,
) {
	const local = unrotatePinPoint(
		{
			x: point.x - windowSize.width / 2,
			y: point.y - windowSize.height / 2,
		},
		degrees,
	);
	return (
		Math.abs(local.x) <= imageSize.width / 2 + PIN_HIT_SLOP &&
		Math.abs(local.y) <= imageSize.height / 2 + PIN_HIT_SLOP
	);
}

export function pinCursorTarget(
	point: PinPoint,
	windowSize: PinSize,
	imageSize: PinSize,
	degrees: number,
): PinCursorTarget {
	const insideWindow =
		point.x >= 0 &&
		point.y >= 0 &&
		point.x < windowSize.width &&
		point.y < windowSize.height;
	if (!insideWindow) return "outside";
	if (
		!pinAngleHasEmptyCorners(degrees) ||
		pinPointInImage(point, windowSize, imageSize, degrees)
	) {
		return "image";
	}
	return "margin";
}

export function pinZoomAnchorPosition(
	cursor: PinPoint,
	windowPosition: PinPoint,
	windowSize: PinSize,
	imageSize: PinSize,
	nextWindowSize: PinSize,
	nextImageSize: PinSize,
	degrees: number,
	nextDegrees = degrees,
): PinPoint {
	const relative = unrotatePinPoint(
		{
			x: cursor.x - windowPosition.x - windowSize.width / 2,
			y: cursor.y - windowPosition.y - windowSize.height / 2,
		},
		degrees,
	);
	const u = imageSize.width > 0 ? (relative.x * 2) / imageSize.width : 0;
	const v = imageSize.height > 0 ? (relative.y * 2) / imageSize.height : 0;
	const nextOffset = rotatePinPoint(
		{
			x: (u * nextImageSize.width) / 2,
			y: (v * nextImageSize.height) / 2,
		},
		nextDegrees,
	);
	return {
		x: Math.round(cursor.x - nextOffset.x - nextWindowSize.width / 2),
		y: Math.round(cursor.y - nextOffset.y - nextWindowSize.height / 2),
	};
}

export function pinFileTimestamp(fileName: string) {
	const timestamp = Number(fileName.split("-")[0]);
	return Number.isFinite(timestamp) ? timestamp : null;
}

export function pinWindowLabel(fileName: string) {
	if (!fileName.toLowerCase().endsWith(".png")) return null;
	const id = fileName.slice(0, -".png".length);
	if (id.length === 0 || id.includes("/") || id.includes("\\")) return null;
	return `pin-${id}`;
}

export function shouldRemoveStalePin(
	fileName: string,
	now: number,
	openLabels: ReadonlySet<string>,
) {
	const createdAt = pinFileTimestamp(fileName);
	if (createdAt === null || createdAt >= now - STALE_PIN_AGE_MS) return false;
	const label = pinWindowLabel(fileName);
	if (!label || openLabels.has(label)) return false;
	return true;
}
