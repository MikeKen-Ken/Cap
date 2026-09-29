import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSignal } from "solid-js";

const STORAGE_KEY = "cap.mainWindowPinned";

function readStoredPin() {
	try {
		return localStorage.getItem(STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

function writeStoredPin(value: boolean) {
	try {
		localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
	} catch {}
}

const [mainWindowPinned, setPinnedState] = createSignal(readStoredPin());

export { mainWindowPinned };

export function isMainWindowPinned() {
	return mainWindowPinned();
}

export async function syncMainWindowPin() {
	await getCurrentWindow().setAlwaysOnTop(mainWindowPinned());
}

export async function setMainWindowPinned(value: boolean) {
	await getCurrentWindow().setAlwaysOnTop(value);
	writeStoredPin(value);
	setPinnedState(value);
}
