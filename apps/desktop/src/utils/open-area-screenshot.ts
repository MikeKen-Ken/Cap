export type FrozenAreaScreenshotApi<Target> = {
	saveFrozenAreaScreenshot: (target: Target) => Promise<string>;
	automationShouldOpenScreenshotEditor: (target: Target) => Promise<boolean>;
	closeTargetSelectOverlays: () => Promise<unknown>;
	showWindow: (
		window:
			| { ScreenshotEditor: { path: string } }
			| { Main: { init_target_mode: null } },
	) => Promise<unknown>;
};

export function createFrozenAreaScreenshotOpener() {
	let opening = false;

	return async function openFrozenAreaScreenshot<Target>(
		target: Target,
		api: FrozenAreaScreenshotApi<Target>,
	): Promise<void> {
		if (opening) return;
		opening = true;
		try {
			let path: string | null = null;
			let shouldOpenEditor = false;
			try {
				path = await api.saveFrozenAreaScreenshot(target);
				shouldOpenEditor =
					await api.automationShouldOpenScreenshotEditor(target);
			} finally {
				await api.closeTargetSelectOverlays().catch((error: unknown) => {
					console.error("Failed to close target select overlays", error);
				});
			}
			if (!shouldOpenEditor || path === null) return;
			await api.showWindow({ ScreenshotEditor: { path } });
		} catch (error) {
			await api
				.showWindow({ Main: { init_target_mode: null } })
				.catch((restoreError: unknown) => {
					console.error("Failed to restore the main window", restoreError);
				});
			throw error;
		} finally {
			opening = false;
		}
	};
}

export const openFrozenAreaScreenshot = createFrozenAreaScreenshotOpener();
