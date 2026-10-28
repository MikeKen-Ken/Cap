import { describe, expect, it, vi } from "vitest";
import {
	isRetryableScreenshotEditorError,
	loadScreenshotEditorInstance,
} from "./load-instance";

describe("loadScreenshotEditorInstance", () => {
	it("retries when the prewarmed window has not been assigned a project yet", async () => {
		const create = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error("Screenshot editor instance not found"))
			.mockResolvedValueOnce("ready");
		const wait = vi.fn(async () => {});

		await expect(loadScreenshotEditorInstance(create, wait)).resolves.toBe(
			"ready",
		);
		expect(create).toHaveBeenCalledTimes(2);
		expect(wait).toHaveBeenCalledOnce();
	});

	it("does not retry a failure that will not clear by waiting", async () => {
		const create = vi
			.fn<() => Promise<string>>()
			.mockRejectedValue(new Error("Failed to render screenshot frame"));
		const wait = vi.fn(async () => {});

		await expect(loadScreenshotEditorInstance(create, wait)).rejects.toThrow(
			"Failed to render screenshot frame",
		);
		expect(create).toHaveBeenCalledOnce();
		expect(wait).not.toHaveBeenCalled();
	});
});

describe("isRetryableScreenshotEditorError", () => {
	it("recognizes a window that was closed before its project was registered", () => {
		expect(
			isRetryableScreenshotEditorError(
				"Screenshot editor window is no longer registered",
			),
		).toBe(true);
		expect(isRetryableScreenshotEditorError("disk full")).toBe(false);
	});
});
