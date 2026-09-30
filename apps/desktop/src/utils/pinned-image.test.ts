import { describe, expect, it } from "vitest";
import {
	clampPinScale,
	fitPinSize,
	naturalPinSize,
	normalizePinAngle,
	pinAngleHasEmptyCorners,
	pinCursorTarget,
	pinFileTimestamp,
	pinFitScale,
	pinKeyToRotationSteps,
	pinKeyToTransparencyLevel,
	pinScaleFromWheel,
	pinTransparencyToOpacity,
	pinWheelDelta,
	pinWindowLabel,
	pinZoomAnchorPosition,
	rotatedPinBounds,
	STALE_PIN_AGE_MS,
	scaledPinSize,
	shouldRemoveStalePin,
} from "./pinned-image";

describe("pinTransparencyToOpacity", () => {
	it("treats 0 as fully opaque and 9 as the most transparent", () => {
		expect(pinTransparencyToOpacity(0)).toBe(1);
		expect(pinTransparencyToOpacity(5)).toBe(0.5);
		expect(pinTransparencyToOpacity(9)).toBeCloseTo(0.1);
	});

	it("never lets the image disappear entirely", () => {
		expect(pinTransparencyToOpacity(10)).toBeCloseTo(0.1);
		expect(pinTransparencyToOpacity(-3)).toBe(1);
	});
});

describe("pin keys", () => {
	it("maps digit keys and ignores everything else", () => {
		expect(pinKeyToTransparencyLevel("0")).toBe(0);
		expect(pinKeyToTransparencyLevel("7")).toBe(7);
		expect(pinKeyToTransparencyLevel("q")).toBeNull();
		expect(pinKeyToTransparencyLevel("10")).toBeNull();
	});

	it("maps q to counter-clockwise and e to clockwise", () => {
		expect(pinKeyToRotationSteps("q")).toBe(-1);
		expect(pinKeyToRotationSteps("Q")).toBe(-1);
		expect(pinKeyToRotationSteps("e")).toBe(1);
		expect(pinKeyToRotationSteps("w")).toBe(0);
	});
});

describe("rotation", () => {
	it("keeps angles within 0..360", () => {
		expect(normalizePinAngle(-15)).toBe(345);
		expect(normalizePinAngle(375)).toBe(15);
		expect(normalizePinAngle(0)).toBe(0);
	});

	it("swaps width and height at 90 degrees", () => {
		expect(rotatedPinBounds({ width: 400, height: 200 }, 90)).toEqual({
			width: 200,
			height: 400,
		});
		expect(rotatedPinBounds({ width: 400, height: 200 }, 0)).toEqual({
			width: 400,
			height: 200,
		});
	});

	it("grows the bounding box for diagonal angles", () => {
		const bounds = rotatedPinBounds({ width: 100, height: 100 }, 45);
		expect(bounds.width).toBe(142);
		expect(bounds.height).toBe(142);
	});
});

describe("fitPinSize", () => {
	const screen = { width: 1920, height: 1080 };

	it("shows the screenshot at its on-screen size when it fits", () => {
		expect(fitPinSize({ width: 800, height: 600 }, 2, screen)).toEqual({
			width: 400,
			height: 300,
		});
	});

	it("shrinks oversized screenshots while keeping the aspect ratio", () => {
		const size = fitPinSize({ width: 4000, height: 2000 }, 1, screen);
		expect(size.width).toBeLessThanOrEqual(1920 * 0.9);
		expect(size.height).toBeLessThanOrEqual(1080 * 0.9);
		expect(size.width / size.height).toBeCloseTo(2, 1);
	});

	it("falls back to a ratio of 1 for invalid pixel ratios", () => {
		expect(fitPinSize({ width: 300, height: 200 }, 0, screen)).toEqual({
			width: 300,
			height: 200,
		});
	});
});

describe("pinFileTimestamp", () => {
	it("reads the creation time from a pin file name", () => {
		expect(pinFileTimestamp("1727600000000-1.png")).toBe(1727600000000);
		expect(pinFileTimestamp("notes.png")).toBeNull();
	});
});

describe("pin window labels", () => {
	it("matches the label used for an open pin window", () => {
		expect(pinWindowLabel("1727600000000-1.png")).toBe("pin-1727600000000-1");
		expect(pinWindowLabel("notes.png")).toBe("pin-notes");
		expect(pinWindowLabel("folder")).toBeNull();
	});
});

describe("shouldRemoveStalePin", () => {
	const fileName = "1727600000000-1.png";
	const createdAt = 1727600000000;

	it("keeps a pin that is still open", () => {
		expect(
			shouldRemoveStalePin(
				fileName,
				createdAt + STALE_PIN_AGE_MS + 1,
				new Set(["pin-1727600000000-1"]),
			),
		).toBe(false);
	});

	it("removes an old pin that no window is showing", () => {
		expect(
			shouldRemoveStalePin(
				fileName,
				createdAt + STALE_PIN_AGE_MS + 1,
				new Set(),
			),
		).toBe(true);
	});

	it("keeps a pin until it is a full day old", () => {
		expect(
			shouldRemoveStalePin(fileName, createdAt + STALE_PIN_AGE_MS, new Set()),
		).toBe(false);
	});

	it("keeps files that do not come from a pin", () => {
		expect(
			shouldRemoveStalePin(
				"notes.png",
				createdAt + STALE_PIN_AGE_MS + 1,
				new Set(),
			),
		).toBe(false);
	});
});

describe("pin scale", () => {
	const image = { width: 400, height: 200 };
	const screen = { width: 1920, height: 1080 };

	it("zooms out on a positive wheel delta and in on a negative one", () => {
		const smaller = pinScaleFromWheel(1, pinWheelDelta(100, 0), image, screen);
		const larger = pinScaleFromWheel(1, pinWheelDelta(-100, 0), image, screen);
		expect(smaller).toBeLessThan(1);
		expect(larger).toBeGreaterThan(1);
	});

	it("stops at the native size when that already fills the screen", () => {
		const huge = { width: 4000, height: 2000 };
		expect(clampPinScale(8, huge, screen)).toBe(1);
	});

	it("lets a small image grow, but not without limit", () => {
		expect(clampPinScale(8, image, screen)).toBe(4);
		expect(clampPinScale(0.01, image, screen)).toBeCloseTo(48 / 200);
	});

	it("builds the fitted size from the natural size and scale", () => {
		const pixels = { width: 4000, height: 2000 };
		const natural = naturalPinSize(pixels, 1);
		const scale = pinFitScale(natural, screen);
		expect(fitPinSize(pixels, 1, screen)).toEqual(
			scaledPinSize(natural, scale),
		);
	});
});

describe("pin hit testing", () => {
	it("treats the whole window as the image at right angles", () => {
		expect(pinAngleHasEmptyCorners(0)).toBe(false);
		expect(pinAngleHasEmptyCorners(90)).toBe(false);
		expect(pinAngleHasEmptyCorners(45)).toBe(true);
		expect(
			pinCursorTarget(
				{ x: 0, y: 0 },
				{ width: 100, height: 50 },
				{ width: 100, height: 50 },
				0,
			),
		).toBe("image");
	});

	it("lets the empty corners of a rotated pin pass through", () => {
		const image = { width: 100, height: 100 };
		const bounds = rotatedPinBounds(image, 45);
		expect(pinCursorTarget({ x: 0, y: 0 }, bounds, image, 45)).toBe("margin");
		expect(
			pinCursorTarget(
				{ x: bounds.width / 2, y: bounds.height / 2 },
				bounds,
				image,
				45,
			),
		).toBe("image");
		expect(pinCursorTarget({ x: -10, y: -10 }, bounds, image, 45)).toBe(
			"outside",
		);
	});
});

describe("pinZoomAnchorPosition", () => {
	it("keeps the image point under the cursor", () => {
		const origin = pinZoomAnchorPosition(
			{ x: 10, y: 20 },
			{ x: 10, y: 20 },
			{ width: 100, height: 100 },
			{ width: 100, height: 100 },
			{ width: 200, height: 200 },
			{ width: 200, height: 200 },
			0,
		);
		expect(origin).toEqual({ x: 10, y: 20 });
	});

	it("grows around the center when the cursor is centered", () => {
		const next = { width: 200, height: 200 };
		const origin = pinZoomAnchorPosition(
			{ x: 60, y: 70 },
			{ x: 10, y: 20 },
			{ width: 100, height: 100 },
			{ width: 100, height: 100 },
			next,
			next,
			0,
		);
		expect(origin).toEqual({ x: -40, y: -30 });
	});

	it("keeps a rotated pin centered when zooming at its center", () => {
		const image = { width: 100, height: 100 };
		const bounds = rotatedPinBounds(image, 45);
		const nextImage = { width: 200, height: 200 };
		const nextBounds = rotatedPinBounds(nextImage, 45);
		const center = { x: bounds.width / 2, y: bounds.height / 2 };
		const origin = pinZoomAnchorPosition(
			center,
			{ x: 0, y: 0 },
			bounds,
			image,
			nextBounds,
			nextImage,
			45,
		);
		expect(origin.x + nextBounds.width / 2).toBeCloseTo(center.x, 0);
		expect(origin.y + nextBounds.height / 2).toBeCloseTo(center.y, 0);
	});
});
