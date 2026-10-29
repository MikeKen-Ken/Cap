import { describe, expect, it } from "vitest";
import {
	containsPoint,
	parseAreaHandoff,
	parseAreaHandoffAck,
	rectInsideFrame,
	type ScreenRect,
	selectionOnWindow,
} from "./area-display-handoff";

const left: ScreenRect = { x: 0, y: 0, width: 1920, height: 1080 };
const right: ScreenRect = { x: 1920, y: 0, width: 1920, height: 1080 };

describe("selectionOnWindow", () => {
	it("keeps a selection that has fully crossed onto the other display", () => {
		expect(
			selectionOnWindow({ x: 2100, y: 240, width: 640, height: 360 }, right),
		).toEqual({ x: 180, y: 240, width: 640, height: 360 });
	});

	it("slides a selection that is still crossing the edge fully onto the destination", () => {
		expect(
			selectionOnWindow({ x: 1700, y: 400, width: 400, height: 300 }, right),
		).toEqual({ x: 0, y: 400, width: 400, height: 300 });
	});

	it("shrinks a selection that is larger than the destination", () => {
		expect(
			selectionOnWindow({ x: 100, y: 100, width: 4000, height: 2000 }, left),
		).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
	});
});

describe("containsPoint", () => {
	it("treats the shared edge as the next display", () => {
		expect(containsPoint(left, 1920, 10)).toBe(false);
		expect(containsPoint(right, 1920, 10)).toBe(true);
	});
});

describe("rectInsideFrame", () => {
	it("is false once the selection crosses onto the next display", () => {
		expect(
			rectInsideFrame({ x: 1700, y: 400, width: 400, height: 300 }, left),
		).toBe(false);
	});
});

describe("handoff messages", () => {
	it("rejects malformed payloads", () => {
		expect(parseAreaHandoff("not json")).toBeNull();
		expect(parseAreaHandoffAck(null)).toBeNull();
		expect(parseAreaHandoff(JSON.stringify({ seq: 1 }))).toBeNull();
	});

	it("accepts a move between displays", () => {
		const message = {
			seq: 2,
			fromScreenId: "1",
			phase: "move",
			bounds: { x: 2000, y: 10, width: 100, height: 80 },
			cursorX: 2100,
			cursorY: 40,
			grabDx: 40,
			grabDy: 20,
		};
		expect(parseAreaHandoff(JSON.stringify(message))).toEqual(message);
	});
});
