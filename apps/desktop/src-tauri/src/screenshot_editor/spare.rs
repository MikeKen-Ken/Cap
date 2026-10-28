use std::{
    str::FromStr,
    sync::{Arc, Mutex, PoisonError},
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager, WebviewWindow};

use crate::{
    general_settings::{AppTheme, GeneralSettingsStore},
    target_select_overlay::WindowFocusManager,
    windows::{
        CapWindowId, ScreenshotEditorWindowIds, ShowCapWindow, lock_window_text_scale,
        next_project_window_id,
    },
};

const STARTUP_DELAY: Duration = Duration::from_secs(2);
const REFILL_DELAY: Duration = Duration::from_secs(3);
const BUSY_RETRY_DELAY: Duration = Duration::from_secs(2);
const HANDOFF_POLL_INTERVAL: Duration = Duration::from_millis(20);
const UNASSIGNED_EDITOR_LIMIT: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EditorHandoff {
    Wait,
    Ready,
    Missing,
}

/// A prewarmed editor can ask for its project before a capture is assigned, and
/// the webview can also ask in the gap before that window is published. Failing
/// either request leaves the page on its skeleton after the window is shown.
pub(crate) fn editor_handoff(
    has_path: bool,
    held: bool,
    window_alive: bool,
    unassigned_for: Duration,
) -> EditorHandoff {
    if has_path && !held {
        return EditorHandoff::Ready;
    }
    let parked_spare = window_alive && (held || has_path);
    if parked_spare {
        return EditorHandoff::Wait;
    }
    if !window_alive && !held {
        return EditorHandoff::Missing;
    }
    if unassigned_for >= UNASSIGNED_EDITOR_LIMIT {
        EditorHandoff::Missing
    } else {
        EditorHandoff::Wait
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct SpareKey {
    transparent: bool,
    theme: Option<tauri::Theme>,
}

struct Spare {
    id: u32,
    window: WebviewWindow,
    key: SpareKey,
    claimed: bool,
}

#[derive(Default)]
struct SpareState {
    /// Set before the hidden webview exists, so its first request waits.
    reserved: Option<u32>,
    slot: Option<Spare>,
}

#[derive(Default, Clone)]
pub struct ScreenshotEditorSpares {
    state: Arc<Mutex<SpareState>>,
    creating: Arc<tokio::sync::Mutex<()>>,
}

fn spares(app: &AppHandle) -> ScreenshotEditorSpares {
    match app.try_state::<ScreenshotEditorSpares>() {
        Some(state) => (*state).clone(),
        None => {
            app.manage(ScreenshotEditorSpares::default());
            (*app.state::<ScreenshotEditorSpares>()).clone()
        }
    }
}

fn current_key(app: &AppHandle) -> SpareKey {
    let settings = GeneralSettingsStore::get(app).ok().flatten();
    let transparent = settings
        .as_ref()
        .is_some_and(|settings| settings.window_transparency);
    let theme = settings.and_then(|settings| match settings.theme {
        AppTheme::System => None,
        AppTheme::Light => Some(tauri::Theme::Light),
        AppTheme::Dark => Some(tauri::Theme::Dark),
    });
    SpareKey { transparent, theme }
}

fn busy(app: &AppHandle) -> bool {
    crate::clean_capture::phase(app).is_some()
        || app
            .try_state::<WindowFocusManager>()
            .is_some_and(|focus| focus.picker_session().is_some())
}

fn spare_state(app: &AppHandle) -> Arc<Mutex<SpareState>> {
    spares(app).state.clone()
}

fn holds_state(state: &SpareState, id: u32) -> bool {
    state.reserved == Some(id) || state.slot.as_ref().is_some_and(|spare| spare.id == id)
}

pub(crate) fn holds(app: &AppHandle, id: u32) -> bool {
    let state = spare_state(app);
    let state = state.lock().unwrap_or_else(PoisonError::into_inner);
    holds_state(&state, id)
}

pub(crate) fn is_pending_window(app: &AppHandle, label: &str) -> bool {
    matches!(
        CapWindowId::from_str(label),
        Ok(CapWindowId::ScreenshotEditor { id }) if holds(app, id)
    )
}

pub(crate) fn release(app: &AppHandle, id: u32) {
    let state = spare_state(app);
    let mut state = state.lock().unwrap_or_else(PoisonError::into_inner);
    if state.reserved == Some(id) {
        state.reserved = None;
    }
    if state.slot.as_ref().is_some_and(|spare| spare.id == id) {
        state.slot = None;
    }
}

pub(crate) fn claim(app: &AppHandle) -> Option<(u32, WebviewWindow)> {
    let key = current_key(app);
    let stale = {
        let state = spare_state(app);
        let mut state = state.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(spare) = state.slot.as_ref() else {
            return None;
        };
        if spare.claimed {
            return None;
        }
        let spare_id = spare.id;
        let key_matches = spare.key == key;
        if (CapWindowId::ScreenshotEditor { id: spare_id })
            .get(app)
            .is_none()
        {
            state.slot = None;
            return None;
        }
        if key_matches {
            let Some(spare) = state.slot.as_mut() else {
                return None;
            };
            spare.claimed = true;
            return Some((spare.id, spare.window.clone()));
        }
        state.slot.take()
    };
    if let Some(stale) = stale {
        let _ = stale.window.destroy();
    }
    None
}

fn registered_path(app: &AppHandle, id: u32) -> bool {
    ScreenshotEditorWindowIds::get(app)
        .ids
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .any(|(_, registered_id)| *registered_id == id)
}

pub(crate) async fn wait_for_assignment(app: &AppHandle, id: u32) -> Result<(), String> {
    let mut stuck = Instant::now();
    loop {
        if crate::app_is_exiting(app) {
            return Err("Screenshot editor instance not found".to_string());
        }
        let has_path = registered_path(app, id);
        let held = holds(app, id);
        let window_alive = (CapWindowId::ScreenshotEditor { id }).get(app).is_some();
        if window_alive && (held || has_path) {
            stuck = Instant::now();
        }
        match editor_handoff(has_path, held, window_alive, stuck.elapsed()) {
            EditorHandoff::Ready => return Ok(()),
            EditorHandoff::Missing => {
                return Err("Screenshot editor instance not found".to_string());
            }
            EditorHandoff::Wait => tokio::time::sleep(HANDOFF_POLL_INTERVAL).await,
        }
    }
}

pub(crate) fn schedule_startup(app: AppHandle) {
    schedule(app, STARTUP_DELAY);
}

pub(crate) fn schedule_refill(app: AppHandle) {
    schedule(app, REFILL_DELAY);
}

fn schedule(app: AppHandle, delay: Duration) {
    if cfg!(target_os = "linux") {
        return;
    }
    tokio::spawn(async move {
        tokio::time::sleep(delay).await;
        loop {
            if crate::app_is_exiting(&app) {
                return;
            }
            if !busy(&app) {
                break;
            }
            tokio::time::sleep(BUSY_RETRY_DELAY).await;
        }
        if let Err(error) = create(&app).await {
            tracing::debug!(%error, "Screenshot editor prewarm skipped");
        }
    });
}

fn clear_reservation(app: &AppHandle, id: u32) {
    let state = spare_state(app);
    let mut state = state.lock().unwrap_or_else(PoisonError::into_inner);
    if state.reserved == Some(id) {
        state.reserved = None;
    }
}

async fn create(app: &AppHandle) -> Result<(), String> {
    let state = spares(app);
    let _creating = state.creating.lock().await;
    let already_present = {
        let inner = spare_state(app);
        let inner = inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.slot.is_some() || inner.reserved.is_some()
    };
    if already_present {
        return Ok(());
    }

    let counter = ScreenshotEditorWindowIds::get(app).counter;
    let id = next_project_window_id(&counter).map_err(|error| error.to_string())?;
    {
        let inner = spare_state(app);
        inner
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .reserved = Some(id);
    }

    let window_id = CapWindowId::ScreenshotEditor { id };
    let key = current_key(app);
    let window = match ShowCapWindow::window_builder_with_id(
        app,
        "/screenshot-editor",
        &window_id,
        window_id.label(),
    )
    .maximizable(true)
    .focused(false)
    .skip_taskbar(true)
    .build()
    {
        Ok(window) => window,
        Err(error) => {
            clear_reservation(app, id);
            return Err(error.to_string());
        }
    };
    lock_window_text_scale(&window);

    let inner = spare_state(app);
    let mut inner = inner.lock().unwrap_or_else(PoisonError::into_inner);
    if inner.reserved != Some(id) {
        drop(inner);
        let _ = window.destroy();
        return Ok(());
    }
    inner.reserved = None;
    inner.slot = Some(Spare {
        id,
        window,
        key,
        claimed: false,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{EditorHandoff, UNASSIGNED_EDITOR_LIMIT, editor_handoff};
    use std::time::Duration;

    #[test]
    fn unassigned_live_window_waits_instead_of_failing() {
        assert_eq!(
            editor_handoff(false, false, true, Duration::ZERO),
            EditorHandoff::Wait
        );
    }

    #[test]
    fn parked_spare_keeps_waiting_until_a_capture_is_assigned() {
        assert_eq!(
            editor_handoff(false, true, true, UNASSIGNED_EDITOR_LIMIT),
            EditorHandoff::Wait
        );
    }

    #[test]
    fn assigned_window_stays_pending_until_it_is_shown() {
        assert_eq!(
            editor_handoff(true, true, true, Duration::ZERO),
            EditorHandoff::Wait
        );
        assert_eq!(
            editor_handoff(true, false, true, Duration::ZERO),
            EditorHandoff::Ready
        );
    }

    #[test]
    fn missing_window_fails_immediately_and_a_stuck_gap_times_out() {
        assert_eq!(
            editor_handoff(false, false, false, Duration::ZERO),
            EditorHandoff::Missing
        );
        assert_eq!(
            editor_handoff(false, false, true, UNASSIGNED_EDITOR_LIMIT),
            EditorHandoff::Missing
        );
        assert_eq!(
            editor_handoff(false, true, false, UNASSIGNED_EDITOR_LIMIT),
            EditorHandoff::Missing
        );
    }
}
