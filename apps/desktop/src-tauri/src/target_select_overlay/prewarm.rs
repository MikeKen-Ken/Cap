use std::{str::FromStr, time::Duration};

use scap_targets::Display;
use tauri::{AppHandle, Manager};

use super::WindowFocusManager;
use crate::windows::{CapWindowId, ShowCapWindow};

pub fn schedule(app: AppHandle) {
    tokio::spawn(async move {
        if let Err(error) = warm(app).await {
            tracing::debug!(%error, "Target picker prewarm skipped");
        }
    });
}

async fn warm(app: AppHandle) -> Result<(), String> {
    if crate::app_is_exiting(&app) || crate::clean_capture::phase(&app).is_some() {
        return Ok(());
    }

    let state = app.state::<WindowFocusManager>();
    let _prewarm = state.prewarm.lock().await;
    if state.picker_session().is_some() {
        return Ok(());
    }

    for _ in 0..50 {
        if !overlay_exists(&app) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    if overlay_exists(&app) || state.picker_session().is_some() {
        return Ok(());
    }

    let session = state.begin_picker();
    state.pause_reveal();
    let displays = Display::list();
    let displays = if displays.is_empty() {
        vec![Display::primary()]
    } else {
        displays
    };

    for display in displays {
        if !state.picker_is_current(session) || crate::app_is_exiting(&app) {
            return Ok(());
        }
        let display_id = display.id();
        if (CapWindowId::TargetSelectOverlay {
            display_id: display_id.clone(),
        })
        .get(&app)
        .is_some()
        {
            continue;
        }
        if let Err(error) = (ShowCapWindow::TargetSelectOverlay {
            display_id,
            target_mode: None,
        })
        .show_for_picker(&app, session)
        .await
        {
            tracing::debug!(%error, "Target picker prewarm could not open an overlay");
        }
    }

    if state.picker_is_current(session) {
        state.cancel_picker();
    }
    Ok(())
}

fn overlay_exists(app: &AppHandle) -> bool {
    app.webview_windows().keys().any(|label| {
        matches!(
            CapWindowId::from_str(label),
            Ok(CapWindowId::TargetSelectOverlay { .. })
        )
    })
}
