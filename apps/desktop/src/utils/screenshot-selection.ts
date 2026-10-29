// A release smaller than this on both sides is a click or an accidental speck.
// Those capture the whole display. A longer thin drag still crops.
export const FULL_DISPLAY_SCREENSHOT_MAX = 16;

export function screenshotSelectionCapturesFullDisplay(bounds: {
	width: number;
	height: number;
}): boolean {
	return (
		bounds.width < FULL_DISPLAY_SCREENSHOT_MAX &&
		bounds.height < FULL_DISPLAY_SCREENSHOT_MAX
	);
}
