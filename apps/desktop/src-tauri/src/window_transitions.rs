use tauri::WebviewWindow;

// DWM plays a scale/fade animation when a window is shown or hidden. Full-screen overlays make the
// whole desktop appear to zoom, and a capture taken during the hide animation keeps a ghost of the
// window (or its dim mask) in the frozen frame.
#[cfg(windows)]
pub fn disable(window: &WebviewWindow) {
    use windows::{
        Win32::{
            Foundation::HWND,
            Graphics::Dwm::{DWMWA_TRANSITIONS_FORCEDISABLED, DwmSetWindowAttribute},
        },
        core::BOOL,
    };

    let hwnd = match window.hwnd() {
        Ok(hwnd) => HWND(hwnd.0),
        Err(error) => {
            tracing::warn!(%error, label = window.label(), "Failed to read window handle");
            return;
        }
    };

    let disabled = BOOL(1);
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_TRANSITIONS_FORCEDISABLED,
            std::ptr::from_ref(&disabled).cast(),
            std::mem::size_of::<BOOL>() as u32,
        )
    };
    if let Err(error) = result {
        tracing::warn!(%error, label = window.label(), "Failed to disable window transitions");
    }
}

#[cfg(not(windows))]
pub fn disable(_window: &WebviewWindow) {}
