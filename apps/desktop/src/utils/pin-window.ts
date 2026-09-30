import { appDataDir, join } from "@tauri-apps/api/path";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { mkdir, readDir, remove, writeFile } from "@tauri-apps/plugin-fs";
import { type as ostype } from "@tauri-apps/plugin-os";
import {
	clampPinScale,
	naturalPinSize,
	type PinSize,
	pinFitScale,
	scaledPinSize,
	shouldRemoveStalePin,
} from "./pinned-image";

const PIN_DIRECTORY = "pins";

let pinCounter = 0;

async function removeStalePins(directory: string) {
	const windows = await WebviewWindow.getAll().catch(() => null);
	if (!windows) return;
	const openLabels = new Set(windows.map((entry) => entry.label));
	const entries = await readDir(directory).catch(() => []);
	const now = Date.now();
	await Promise.all(
		entries.map(async (entry) => {
			if (!shouldRemoveStalePin(entry.name, now, openLabels)) return;
			await remove(await join(directory, entry.name)).catch(() => undefined);
		}),
	);
}

function createPinWindow(label: string, url: string, size: PinSize) {
	const isWindows = ostype() === "windows";
	const browserArgs = window.__CAP__?.windowsWebview2BrowserArgs;
	if (isWindows && !browserArgs) {
		throw new Error("Missing Windows WebView2 browser arguments");
	}

	return new Promise<WebviewWindow>((resolve, reject) => {
		const pinWindow = new WebviewWindow(label, {
			url,
			title: "Cap Pinned Image",
			width: size.width,
			height: size.height,
			center: true,
			focus: !isWindows,
			visible: false,
			resizable: false,
			maximizable: false,
			minimizable: false,
			decorations: false,
			transparent: true,
			shadow: false,
			alwaysOnTop: true,
			skipTaskbar: true,
			additionalBrowserArgs: isWindows ? browserArgs : undefined,
		} as ConstructorParameters<typeof WebviewWindow>[1]);
		void pinWindow.once("tauri://created", () => resolve(pinWindow));
		void pinWindow.once("tauri://error", (event) =>
			reject(new Error(String(event.payload))),
		);
	});
}

export async function openPinnedImage(blob: Blob, pixels: PinSize) {
	const directory = await join(await appDataDir(), PIN_DIRECTORY);
	await mkdir(directory, { recursive: true });
	await removeStalePins(directory);

	pinCounter += 1;
	const id = `${Date.now()}-${pinCounter}`;
	const path = await join(directory, `${id}.png`);
	await writeFile(path, new Uint8Array(await blob.arrayBuffer()));

	const screen = {
		width: window.screen.availWidth,
		height: window.screen.availHeight,
	};
	const natural = naturalPinSize(pixels, window.devicePixelRatio);
	const scale = clampPinScale(pinFitScale(natural, screen), natural, screen);
	const size = scaledPinSize(natural, scale);
	const params = new URLSearchParams({
		src: path,
		w: String(natural.width),
		h: String(natural.height),
		s: String(scale),
	});

	try {
		await createPinWindow(`pin-${id}`, `/pin?${params}`, size);
	} catch (error) {
		await remove(path).catch(() => undefined);
		throw error;
	}
}
