import { describe, expect, it } from "vitest";
import {
	captureStartedWithDevice,
	type RecordingOptionsLocalState,
	recordingOptionsPatchFromStore,
} from "./recording-options-sync";

const baseState = (): RecordingOptionsLocalState => ({
	captureTarget: { variant: "display", id: "0" },
	micName: null,
	mode: "studio",
	captureSystemAudio: false,
	cameraID: null,
	organizationId: null,
});

describe("recordingOptionsPatchFromStore", () => {
	it("syncs micName changes from the shared store", () => {
		expect(
			recordingOptionsPatchFromStore(
				{ micName: "Built-in Microphone" },
				baseState(),
			),
		).toEqual({ micName: "Built-in Microphone" });
	});

	it("syncs clearing the microphone", () => {
		expect(
			recordingOptionsPatchFromStore(
				{ micName: null },
				{ ...baseState(), micName: "Built-in Microphone" },
			),
		).toEqual({ micName: null });
	});

	it("returns null when nothing changed", () => {
		expect(
			recordingOptionsPatchFromStore(
				{ micName: null, mode: "studio", systemAudio: false },
				baseState(),
			),
		).toBeNull();
	});

	it("syncs camera, mode, system audio, and organization together", () => {
		expect(
			recordingOptionsPatchFromStore(
				{
					cameraId: { DeviceID: "cam-1" },
					mode: "instant",
					systemAudio: true,
					organizationId: "org-1",
				},
				baseState(),
			),
		).toEqual({
			cameraID: { DeviceID: "cam-1" },
			mode: "instant",
			captureSystemAudio: true,
			organizationId: "org-1",
		});
	});
});

describe("captureStartedWithDevice", () => {
	it("is false while options are still hydrating as null", () => {
		expect(captureStartedWithDevice(null)).toBe(false);
		expect(captureStartedWithDevice(undefined)).toBe(false);
	});

	it("is true once a device is selected", () => {
		expect(captureStartedWithDevice("Built-in Microphone")).toBe(true);
		expect(captureStartedWithDevice({ DeviceID: "cam-1" })).toBe(true);
	});
});
