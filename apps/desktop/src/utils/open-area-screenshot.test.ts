import { describe, expect, it, vi } from "vitest";
import { createFrozenAreaScreenshotOpener } from "./open-area-screenshot";

const target = {
	variant: "area" as const,
	screen: "display-1",
	bounds: {
		position: { x: 0, y: 0 },
		size: { width: 200, height: 200 },
	},
};

function commands(events: string[], showError = false) {
	return {
		saveFrozenAreaScreenshot: vi.fn(async () => {
			events.push("save");
			return "C:/shots/one.cap";
		}),
		automationShouldOpenScreenshotEditor: vi.fn(async () => {
			events.push("ask");
			return true;
		}),
		closeTargetSelectOverlays: vi.fn(async () => {
			events.push("close");
			return null;
		}),
		showWindow: vi.fn(
			async (window: {
				ScreenshotEditor?: { path: string };
				Main?: unknown;
			}) => {
				if (typeof window === "object" && "ScreenshotEditor" in window) {
					events.push("show-editor");
					if (showError) throw new Error("editor window failed");
					return null;
				}
				if (typeof window === "object" && "Main" in window) {
					events.push("show-main");
				}
				return null;
			},
		),
	};
}

describe("openFrozenAreaScreenshot", () => {
	it("closes the picker before showing the editor", async () => {
		const events: string[] = [];
		const open = createFrozenAreaScreenshotOpener();

		await open(target, commands(events));

		expect(events).toEqual(["save", "ask", "close", "show-editor"]);
	});

	it("closes the picker when the capture fails", async () => {
		const events: string[] = [];
		const open = createFrozenAreaScreenshotOpener();
		const api = commands(events);
		api.saveFrozenAreaScreenshot.mockImplementationOnce(async () => {
			events.push("save");
			throw new Error("capture failed");
		});

		await expect(open(target, api)).rejects.toThrow("capture failed");
		expect(events).toEqual(["save", "close", "show-main"]);
	});

	it("restores the main window when the editor cannot be shown", async () => {
		const events: string[] = [];
		const open = createFrozenAreaScreenshotOpener();

		await expect(open(target, commands(events, true))).rejects.toThrow(
			"editor window failed",
		);
		expect(events).toEqual([
			"save",
			"ask",
			"close",
			"show-editor",
			"show-main",
		]);
	});

	it("ignores a second open while the first capture is still in flight", async () => {
		const events: string[] = [];
		const open = createFrozenAreaScreenshotOpener();
		let releaseSave: (path: string) => void = () => {};
		const api = commands(events);
		api.saveFrozenAreaScreenshot.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					releaseSave = resolve;
				}),
		);

		const first = open(target, api);
		await open(target, api);
		expect(api.saveFrozenAreaScreenshot).toHaveBeenCalledOnce();

		releaseSave("C:/shots/one.cap");
		await first;
		expect(events).toEqual(["ask", "close", "show-editor"]);
	});
});
