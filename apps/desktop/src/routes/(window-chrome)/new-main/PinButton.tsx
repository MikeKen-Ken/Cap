import { onMount } from "solid-js";
import Tooltip from "~/components/Tooltip";
import {
	mainWindowPinned,
	setMainWindowPinned,
	syncMainWindowPin,
} from "~/utils/main-window-pin";
import IconLucidePin from "~icons/lucide/pin";
import IconLucidePinOff from "~icons/lucide/pin-off";

export default function PinButton() {
	onMount(() => {
		syncMainWindowPin().catch((error) => {
			console.error("Failed to apply main window pin:", error);
		});
	});

	return (
		<Tooltip
			content={
				<span>{mainWindowPinned() ? "Unpin from top" : "Pin on top"}</span>
			}
		>
			<button
				type="button"
				aria-pressed={mainWindowPinned()}
				aria-label={mainWindowPinned() ? "Unpin from top" : "Pin on top"}
				onClick={() => {
					setMainWindowPinned(!mainWindowPinned()).catch((error) => {
						console.error("Failed to update main window pin:", error);
					});
				}}
				class="flex shrink-0 justify-center items-center size-5 focus:outline-hidden"
			>
				{mainWindowPinned() ? (
					<IconLucidePin class="transition-colors text-blue-9 size-4 hover:text-blue-10" />
				) : (
					<IconLucidePinOff class="transition-colors text-gray-11 size-4 hover:text-gray-12" />
				)}
			</button>
		</Tooltip>
	);
}
