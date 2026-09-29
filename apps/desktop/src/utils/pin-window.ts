import { appDataDir, join } from "@tauri-apps/api/path";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { mkdir, readDir, remove, writeFile } from "@tauri-apps/plugin-fs";
import { type as ostype } from "@tauri-apps/plugin-os";
import { fitPinSize, type PinSize, pinFileTimestamp } from "./pinned-image";

const PIN_DIRECTORY = "pins";
const STALE_PIN_AGE_MS = 24 * 60 * 60 * 1000;

let pinCounter = 0;

async function removeStalePins(directory: string) {
	const cutoff = Date.now() - STALE_PIN_AGE_MS;
	const entries = await readDir(directory).catch(() => []);
	await Promise.all(
		entries.map(async (entry) => {
			const createdAt = pinFileTimestamp(entry.name);
			if (createdAt === null || createdAt >= cutoff) return;
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

	const size = fitPinSize(pixels, window.devicePixelRatio, {
		width: window.screen.availWidth,
		height: window.screen.availHeight,
	});
	const params = new URLSearchParams({
		src: path,
		w: String(size.width),
		h: String(size.height),
	});

	try {
		await createPinWindow(`pin-${id}`, `/pin?${params}`, size);
	} catch (error) {
		await remove(path).catch(() => undefined);
		throw error;
	}
}
