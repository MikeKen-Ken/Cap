import type { RecordingMode } from "./tauri";

export function normalizeRecordingMode(mode: RecordingMode): RecordingMode {
	return mode === "instant" ? "studio" : mode;
}
