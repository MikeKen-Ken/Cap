use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, PoisonError},
    time::Duration,
};

use cap_recording::screen_capture::ScreenCaptureTarget;
use cap_recording::screenshot::{capture_screenshot, crop_captured_area};
use scap_targets::DisplayId;
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_specta::Event;

use crate::target_select_overlay::{WindowFocusManager, request_overlay_reveal};
use crate::windows::CapWindowId;

#[derive(Clone, Serialize, Type, tauri_specta::Event)]
pub struct ScreenshotFreezeReady {
    pub display_id: String,
}

struct Frame {
    image: image::DynamicImage,
    preview: PathBuf,
}

struct Inner {
    generation: u64,
    frames: HashMap<String, Frame>,
}

pub struct FreezeStore {
    inner: Mutex<Inner>,
}

impl Default for FreezeStore {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                generation: 0,
                frames: HashMap::new(),
            }),
        }
    }
}

pub fn begin(app: &AppHandle) -> u64 {
    with_inner(app, |inner| {
        inner.generation = inner.generation.wrapping_add(1);
        inner.frames.clear();
        inner.generation
    })
}

pub fn clear(app: &AppHandle) {
    let _ = begin(app);
}

pub async fn capture_displays(
    app: AppHandle,
    display_ids: Vec<DisplayId>,
    generation: u64,
    session: u32,
) {
    for display_id in display_ids {
        if !still_current(&app, session, generation) {
            return;
        }
        let target = ScreenCaptureTarget::Display {
            id: display_id.clone(),
        };
        match capture_screenshot(target).await {
            Ok(image) => {
                if !still_current(&app, session, generation) {
                    return;
                }
                if let Err(error) = publish(&app, &display_id, generation, image).await {
                    tracing::warn!(%error, "Failed to publish screenshot freeze");
                    reveal_until_shown(&app, &display_id, session).await;
                }
            }
            Err(error) => {
                tracing::warn!(%error, "Failed to freeze display for area screenshot");
                reveal_until_shown(&app, &display_id, session).await;
            }
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn screenshot_freeze_preview(window: WebviewWindow, display_id: String) -> Option<String> {
    let app = window.app_handle();
    let preview = with_inner(&app, |inner| {
        inner
            .frames
            .get(&display_id)
            .map(|frame| frame.preview.clone())
    })?;
    let _ = window
        .state::<tauri::scope::Scopes>()
        .allow_file(preview.as_path());
    Some(preview.to_string_lossy().into_owned())
}

#[tauri::command]
#[specta::specta]
pub async fn save_frozen_area_screenshot(
    app: AppHandle,
    target: ScreenCaptureTarget,
) -> Result<PathBuf, String> {
    let Some(display_id) = area_display_id(&target) else {
        return crate::recording::take_screenshot(app, target).await;
    };
    let Some(image) = take_frame(&app, &display_id) else {
        return crate::recording::take_screenshot(app, target).await;
    };
    let cropped = crop_captured_area(image, &target).map_err(|error| error.to_string())?;
    crate::recording::persist_captured_screenshot(app, cropped, target).await
}

fn area_display_id(target: &ScreenCaptureTarget) -> Option<String> {
    match target {
        ScreenCaptureTarget::Area { screen, .. } => Some(screen.to_string()),
        _ => None,
    }
}

fn take_frame(app: &AppHandle, display_id: &str) -> Option<image::DynamicImage> {
    with_inner(app, |inner| {
        inner.frames.remove(display_id).map(|frame| frame.image)
    })
}

async fn publish(
    app: &AppHandle,
    display_id: &DisplayId,
    generation: u64,
    image: image::DynamicImage,
) -> Result<(), String> {
    let key = display_id.to_string();
    let rgb = image.into_rgb8();
    let preview = preview_path(app, generation, &key)?;
    let preview_for_write = preview.clone();
    let rgb = tokio::task::spawn_blocking(move || {
        write_bmp(&rgb, &preview_for_write)?;
        Ok::<_, String>(rgb)
    })
    .await
    .map_err(|error| error.to_string())??;

    if let Some(window) = overlay_window(app, display_id) {
        let _ = window
            .state::<tauri::scope::Scopes>()
            .allow_file(preview.as_path());
    }

    if let Some(preview) = with_inner(app, |inner| {
        if inner.generation != generation {
            return Some(preview);
        }
        inner.frames.insert(
            key.clone(),
            Frame {
                image: image::DynamicImage::ImageRgb8(rgb),
                preview,
            },
        );
        None
    }) {
        let _ = std::fs::remove_file(&preview);
        return Err("Screenshot freeze was replaced".into());
    }
    let _ = ScreenshotFreezeReady { display_id: key }.emit(app);
    Ok(())
}

fn write_bmp(image: &image::RgbImage, path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let file = std::fs::File::create(path).map_err(|error| error.to_string())?;
    let mut writer = std::io::BufWriter::new(file);
    image::codecs::bmp::BmpEncoder::new(&mut writer)
        .encode(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|error| error.to_string())
}

fn preview_path(app: &AppHandle, generation: u64, display_id: &str) -> Result<PathBuf, String> {
    let stem: String = display_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect();
    let directory = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("screenshot-freeze")
        .join(generation.to_string());
    Ok(directory.join(format!("{stem}.bmp")))
}

async fn reveal_until_shown(app: &AppHandle, display_id: &DisplayId, session: u32) {
    for _ in 0..50 {
        if !app.state::<WindowFocusManager>().picker_is_current(session) {
            return;
        }
        if let Some(window) = overlay_window(app, display_id) {
            request_overlay_reveal(&window, session, true);
            if window.is_visible().unwrap_or(false) {
                return;
            }
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn overlay_window(app: &AppHandle, display_id: &DisplayId) -> Option<WebviewWindow> {
    CapWindowId::TargetSelectOverlay {
        display_id: display_id.clone(),
    }
    .get(app)
}

fn still_current(app: &AppHandle, session: u32, generation: u64) -> bool {
    app.state::<WindowFocusManager>().picker_is_current(session)
        && with_inner(app, |inner| inner.generation) == generation
}

fn with_inner<T>(app: &AppHandle, f: impl FnOnce(&mut Inner) -> T) -> T {
    let store = app.state::<FreezeStore>();
    let mut inner = store.inner.lock().unwrap_or_else(PoisonError::into_inner);
    f(&mut inner)
}
