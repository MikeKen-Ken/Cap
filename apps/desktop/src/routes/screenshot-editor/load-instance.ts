const EDITOR_INSTANCE_ATTEMPTS = 8;
const EDITOR_INSTANCE_RETRY_MS = 50;

export function isRetryableScreenshotEditorError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("not found") || message.includes("no longer registered")
	);
}

export async function loadScreenshotEditorInstance<T>(
	create: () => Promise<T>,
	wait: (ms: number) => Promise<void> = (ms) =>
		new Promise((resolve) => {
			setTimeout(resolve, ms);
		}),
): Promise<T> {
	let failure: unknown;
	for (let attempt = 0; attempt < EDITOR_INSTANCE_ATTEMPTS; attempt++) {
		try {
			return await create();
		} catch (error) {
			failure = error;
			const retry =
				isRetryableScreenshotEditorError(error) &&
				attempt < EDITOR_INSTANCE_ATTEMPTS - 1;
			if (!retry) throw error;
			await wait(EDITOR_INSTANCE_RETRY_MS * (attempt + 1));
		}
	}
	throw failure instanceof Error
		? failure
		: new Error("Screenshot editor did not open");
}
