import type {
	DeviceOrModelID,
	RecordingMode,
	ScreenCaptureTarget,
} from "./tauri";

export type RecordingOptionsLocalState = {
	captureTarget: ScreenCaptureTarget;
	micName: string | null;
	mode: RecordingMode;
	captureSystemAudio?: boolean;
	cameraID?: DeviceOrModelID | null;
	organizationId?: string | null;
};

export type RecordingSettingsLike = {
	target?: ScreenCaptureTarget | null;
	micName?: string | null;
	cameraId?: DeviceOrModelID | null;
	mode?: RecordingMode | null;
	systemAudio?: boolean;
	organizationId?: string | null;
};

export type RecordingOptionsStorePatch = {
	captureTarget?: ScreenCaptureTarget;
	micName?: string | null;
	cameraID?: DeviceOrModelID | null;
	mode?: RecordingMode;
	captureSystemAudio?: boolean;
	organizationId?: string | null;
};

export function recordingOptionsPatchFromStore(
	data: RecordingSettingsLike | null | undefined,
	current: RecordingOptionsLocalState,
): RecordingOptionsStorePatch | null {
	if (!data) return null;

	const patch: RecordingOptionsStorePatch = {};
	let changed = false;

	if (
		data.target != null &&
		JSON.stringify(data.target) !== JSON.stringify(current.captureTarget)
	) {
		patch.captureTarget = data.target;
		changed = true;
	}
	if (data.micName !== undefined && data.micName !== current.micName) {
		patch.micName = data.micName;
		changed = true;
	}
	if (
		data.cameraId !== undefined &&
		JSON.stringify(data.cameraId) !== JSON.stringify(current.cameraID)
	) {
		patch.cameraID = data.cameraId;
		changed = true;
	}
	if (data.mode != null && data.mode !== current.mode) {
		patch.mode = data.mode;
		changed = true;
	}
	if (
		data.systemAudio !== undefined &&
		data.systemAudio !== current.captureSystemAudio
	) {
		patch.captureSystemAudio = data.systemAudio;
		changed = true;
	}
	if (
		data.organizationId !== undefined &&
		data.organizationId !== current.organizationId
	) {
		patch.organizationId = data.organizationId;
		changed = true;
	}

	return changed ? patch : null;
}

export function captureStartedWithDevice(
	value: string | DeviceOrModelID | null | undefined,
): boolean {
	return value != null;
}
