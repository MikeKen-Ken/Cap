import { convertFileSrc } from "@tauri-apps/api/core";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { commands, events } from "~/utils/tauri";

export default function ScreenshotFreezeLayer(props: {
	displayId: string;
	instance: number;
	targetMode?: string | null;
}) {
	const [url, setUrl] = createSignal<string | null>(null);
	let presented = false;
	let ticket = 0;

	const present = () => {
		if (presented || props.instance <= 0 || props.targetMode !== "area") return;
		presented = true;
		const current = ticket;
		void commands.presentScreenshotFreeze(props.instance);
		window.setTimeout(() => {
			if (current !== ticket || props.targetMode !== "area") return;
			void commands.presentScreenshotFreeze(props.instance);
		}, 300);
	};

	const showCurrent = async () => {
		if (!props.displayId || props.targetMode !== "area") return;
		const path = await commands.screenshotFreezePreview(props.displayId);
		if (!path || props.targetMode !== "area") return;
		const next = convertFileSrc(path);
		setUrl((current) => {
			if (current === next) return current;
			presented = false;
			ticket += 1;
			return next;
		});
	};

	createEffect(() => {
		if (props.targetMode === "area") {
			void showCurrent();
			return;
		}
		ticket += 1;
		presented = false;
		setUrl(null);
	});

	onMount(() => {
		if (!props.displayId) return;
		let dispose: (() => void) | undefined;
		let cancelled = false;
		void (async () => {
			const unlisten = await events.screenshotFreezeReady.listen((event) => {
				if (event.payload.display_id !== props.displayId) return;
				void showCurrent();
			});
			if (cancelled) {
				unlisten();
				return;
			}
			dispose = unlisten;
			await showCurrent();
		})();
		onCleanup(() => {
			cancelled = true;
			ticket += 1;
			dispose?.();
		});
	});

	return (
		<Show when={props.targetMode === "area" && url()}>
			<div class="pointer-events-none fixed inset-0 z-0 bg-black">
				<img
					class="h-full w-full object-fill"
					alt=""
					src={url() ?? ""}
					onLoad={() => present()}
					onError={() => {
						setUrl(null);
						presented = false;
						present();
					}}
				/>
			</div>
		</Show>
	);
}
