import { describe, expect, it } from "vitest";
import {
	fitPinSize,
	normalizePinAngle,
	pinFileTimestamp,
	pinKeyToRotationSteps,
	pinKeyToTransparencyLevel,
	pinTransparencyToOpacity,
	rotatedPinBounds,
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
