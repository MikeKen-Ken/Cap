export const PIN_ROTATE_STEP_DEGREES = 15;
export const PIN_SCREEN_FILL_LIMIT = 0.9;
export const PIN_MIN_OPACITY = 0.1;

export type PinSize = { width: number; height: number };

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

export function rotatedPinBounds(size: PinSize, degrees: number): PinSize {
	const radians = (degrees * Math.PI) / 180;
	const cos = Math.abs(Math.cos(radians));
	const sin = Math.abs(Math.sin(radians));
	return {
		width: Math.ceil(size.width * cos + size.height * sin - 1e-6),
		height: Math.ceil(size.width * sin + size.height * cos - 1e-6),
	};
}

export function fitPinSize(
	pixels: PinSize,
	devicePixelRatio: number,
	screen: PinSize,
): PinSize {
	const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
	const width = pixels.width / ratio;
	const height = pixels.height / ratio;
	const scale = Math.min(
		1,
		(screen.width * PIN_SCREEN_FILL_LIMIT) / width,
		(screen.height * PIN_SCREEN_FILL_LIMIT) / height,
	);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

export function pinFileTimestamp(fileName: string) {
	const timestamp = Number(fileName.split("-")[0]);
	return Number.isFinite(timestamp) ? timestamp : null;
}
