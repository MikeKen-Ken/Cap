use std::{
    str::FromStr,
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
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

#[derive(Default, Clone)]
pub struct ScreenshotEditorSpares {
    slot: Arc<Mutex<Option<Spare>>>,
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

pub(crate) fn holds(app: &AppHandle, id: u32) -> bool {
    let state = spares(app);
    let slot = state.slot.lock().unwrap_or_else(PoisonError::into_inner);
    slot.as_ref().is_some_and(|spare| spare.id == id)
}

pub(crate) fn is_pending_window(app: &AppHandle, label: &str) -> bool {
    matches!(
        CapWindowId::from_str(label),
        Ok(CapWindowId::ScreenshotEditor { id }) if holds(app, id)
    )
}

pub(crate) fn release(app: &AppHandle, id: u32) {
    let state = spares(app);
    let mut slot = state.slot.lock().unwrap_or_else(PoisonError::into_inner);
    if slot.as_ref().is_some_and(|spare| spare.id == id) {
        *slot = None;
    }
}

pub(crate) fn claim(app: &AppHandle) -> Option<(u32, WebviewWindow)> {
    let key = current_key(app);
    let stale = {
        let state = spares(app);
        let mut slot = state.slot.lock().unwrap_or_else(PoisonError::into_inner);
        let spare = slot.as_mut()?;
        if spare.claimed {
            return None;
        }
        if spare.key == key {
            spare.claimed = true;
            return Some((spare.id, spare.window.clone()));
        }
        slot.take()
    };
    if let Some(stale) = stale {
        let _ = stale.window.destroy();
    }
    None
}

pub(crate) async fn wait_until_released(app: &AppHandle, id: u32) {
    while holds(app, id) {
        tokio::time::sleep(HANDOFF_POLL_INTERVAL).await;
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

async fn create(app: &AppHandle) -> Result<(), String> {
    let state = spares(app);
    let _creating = state.creating.lock().await;
    let already_present = state
        .slot
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .is_some();
    if already_present {
        return Ok(());
    }

    let counter = ScreenshotEditorWindowIds::get(app).counter;
    let id = next_project_window_id(&counter).map_err(|error| error.to_string())?;
    let window_id = CapWindowId::ScreenshotEditor { id };
    let key = current_key(app);
    let window = ShowCapWindow::window_builder_with_id(
        app,
        "/screenshot-editor",
        &window_id,
        window_id.label(),
    )
    .maximizable(true)
    .focused(false)
    .build()
    .map_err(|error| error.to_string())?;
    lock_window_text_scale(&window);

    let mut slot = state.slot.lock().unwrap_or_else(PoisonError::into_inner);
    *slot = Some(Spare {
        id,
        window,
        key,
        claimed: false,
    });
    Ok(())
}
