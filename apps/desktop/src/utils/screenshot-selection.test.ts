import { describe, expect, it } from "vitest";
import { screenshotSelectionCapturesFullDisplay } from "./screenshot-selection";

describe("screenshot selection", () => {
	it("captures the full display for a click or a tiny box", () => {
		expect(
			screenshotSelectionCapturesFullDisplay({ width: 0, height: 0 }),
		).toBe(true);
		expect(
			screenshotSelectionCapturesFullDisplay({ width: 1, height: 1 }),
		).toBe(true);
		expect(
			screenshotSelectionCapturesFullDisplay({ width: 15, height: 15 }),
		).toBe(true);
	});

	it("keeps a deliberate drag, including a thin strip", () => {
		expect(
			screenshotSelectionCapturesFullDisplay({ width: 16, height: 16 }),
		).toBe(false);
		expect(
			screenshotSelectionCapturesFullDisplay({ width: 15, height: 200 }),
		).toBe(false);
		expect(
			screenshotSelectionCapturesFullDisplay({ width: 400, height: 8 }),
		).toBe(false);
	});
});
