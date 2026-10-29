use std::time::{Duration, Instant};

use gpui::{App, AppContext as _, Context};
use scap_targets::DisplayId;

use super::{AreaRect, OverlayWindow, TargetSelect, snap_area_rect};
use crate::app_windows::{self, AppWindows};

/// How long a drag ignores a "button up" sample. The button state can lag the
/// mouse-down that started the gesture.
const RELEASE_GRACE: Duration = Duration::from_millis(50);

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct DisplayFrame {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl DisplayFrame {
    fn contains(self, x: f32, y: f32) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.width && y < self.y + self.height
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct AreaMoveGesture {
    pub grab_dx: f32,
    pub grab_dy: f32,
    pub width: f32,
    pub height: f32,
    started: Instant,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct ScreenRect {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

pub(crate) fn is_active(cx: &App) -> bool {
    TargetSelect::global(cx).read(cx).area_move.is_some()
}

pub(crate) fn begin_area_move(gesture: AreaMoveGesture, cx: &mut App) {
    let started = AreaMoveGesture {
        started: Instant::now(),
        ..gesture
    };
    if TargetSelect::global(cx)
        .update(cx, |select, cx| {
            select.area_move = Some(started);
            // Moves keep arriving after the pointer leaves the overlay that
            // received the press: that window's mouse stream stops at its
            // edge, so the gesture follows the global cursor on a timer.
            select.area_follow = Some(cx.spawn(async move |this, cx| {
                loop {
                    cx.background_executor()
                        .timer(Duration::from_millis(16))
                        .await;
                    let active = this
                        .read_with(cx, |this, _| this.area_move.is_some())
                        .unwrap_or(false);
                    if !active {
                        return;
                    }
                    if cx.update(follow_area_move).is_err() {
                        return;
                    }
                }
            }));
            cx.notify();
        })
        .is_err()
    {
        return;
    }
    cx.defer(move |cx| {
        if is_active(cx) {
            follow_area_move(cx);
        }
    });
}

pub(crate) fn end_area_move(cx: &mut App) {
    if TargetSelect::global(cx)
        .update(cx, |select, cx| {
            select.area_follow = None;
            if select.area_move.take().is_some() {
                cx.notify();
            }
        })
        .is_err()
    {
        return;
    }
}

pub(crate) fn gesture_from_press(
    cursor: (f32, f32),
    origin: (f32, f32),
    crop: AreaRect,
) -> AreaMoveGesture {
    AreaMoveGesture {
        grab_dx: cursor.0 - (origin.0 + crop.x),
        grab_dy: cursor.1 - (origin.1 + crop.y),
        width: crop.width,
        height: crop.height,
        started: Instant::now(),
    }
}

fn follow_area_move(cx: &mut App) {
    let Some(gesture) = TargetSelect::global(cx).read(cx).area_move else {
        return;
    };
    let Some(sample) = scap_targets::Display::sample_pointer() else {
        return;
    };
    if !sample.primary_down && gesture.started.elapsed() > RELEASE_GRACE {
        // The timer is this task. Dropping it here would cancel the future
        // that is running, so only the gesture is cleared and the loop exits.
        let _ = TargetSelect::global(cx).update(cx, |select, cx| {
            if select.area_move.take().is_some() {
                cx.notify();
            }
        });
        return;
    }
    let cursor = (sample.position.x() as f32, sample.position.y() as f32);
    if !cursor.0.is_finite() || !cursor.1.is_finite() {
        return;
    }
    place_area_move(gesture, cursor, cx);
}

pub(crate) fn place_area_move(gesture: AreaMoveGesture, cursor: (f32, f32), cx: &mut App) {
    let frames = display_frames();
    let Some((host, frame)) = host_at(&frames, cursor.0, cursor.1) else {
        return;
    };
    let local = selection_on_display(
        ScreenRect {
            x: cursor.0 - gesture.grab_dx,
            y: cursor.1 - gesture.grab_dy,
            width: gesture.width,
            height: gesture.height,
        },
        frame,
    );
    let handles: Vec<_> = cx
        .global::<AppWindows>()
        .overlays
        .iter()
        .map(|(id, handle)| (id.clone(), *handle))
        .collect();
    let mut changed = false;
    for (id, handle) in handles {
        let on_host = id == host;
        let placed = local;
        changed |= handle
            .update(cx, |view, _, cx| {
                if on_host {
                    view.apply_moved_crop(placed, cx)
                } else {
                    view.clear_moved_crop(cx)
                }
            })
            .unwrap_or(false);
    }
    if changed {
        app_windows::refresh_target_overlays(cx);
    }
}

fn display_frames() -> Vec<(DisplayId, DisplayFrame)> {
    scap_targets::Display::list()
        .into_iter()
        .filter_map(|display| {
            let bounds = display.raw_handle().logical_bounds()?;
            let width = bounds.size().width() as f32;
            let height = bounds.size().height() as f32;
            if !(width.is_finite() && height.is_finite() && width > 0. && height > 0.) {
                return None;
            }
            Some((
                display.id(),
                DisplayFrame {
                    x: bounds.position().x() as f32,
                    y: bounds.position().y() as f32,
                    width,
                    height,
                },
            ))
        })
        .collect()
}

fn host_at(
    frames: &[(DisplayId, DisplayFrame)],
    x: f32,
    y: f32,
) -> Option<(DisplayId, DisplayFrame)> {
    if let Some((id, frame)) = frames.iter().find(|(_, frame)| frame.contains(x, y)) {
        return Some((id.clone(), *frame));
    }
    frames
        .iter()
        .min_by(|(_, left), (_, right)| {
            left.distance_sq(x, y)
                .partial_cmp(&right.distance_sq(x, y))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(id, frame)| (id.clone(), *frame))
}

impl DisplayFrame {
    fn distance_sq(self, x: f32, y: f32) -> f32 {
        let dx = if x < self.x {
            self.x - x
        } else if x >= self.x + self.width {
            x - (self.x + self.width)
        } else {
            0.
        };
        let dy = if y < self.y {
            self.y - y
        } else if y >= self.y + self.height {
            y - (self.y + self.height)
        } else {
            0.
        };
        dx * dx + dy * dy
    }
}

/// Slide a screen-space selection fully onto `frame`. A rect that is still
/// crossing the edge lands on the destination's near edge, which is what lets
/// a drag leave one monitor and arrive on the next.
fn selection_on_display(rect: ScreenRect, frame: DisplayFrame) -> AreaRect {
    let width = rect.width.min(frame.width).max(0.);
    let height = rect.height.min(frame.height).max(0.);
    let max_x = (frame.width - width).max(0.);
    let max_y = (frame.height - height).max(0.);
    AreaRect {
        x: (rect.x - frame.x).clamp(0., max_x),
        y: (rect.y - frame.y).clamp(0., max_y),
        width,
        height,
    }
}

impl OverlayWindow {
    pub(crate) fn apply_moved_crop(&mut self, local: AreaRect, cx: &mut Context<Self>) -> bool {
        let (snapped, guides) = snap_area_rect(local, self.display_size);
        if self.crop.is_some_and(|crop| !crop_moved(crop, snapped)) && self.snap_guides == guides {
            return false;
        }
        self.crop = Some(snapped);
        self.snap_guides = guides;
        self.sync_area_camera(cx);
        cx.notify();
        true
    }

    pub(crate) fn clear_moved_crop(&mut self, cx: &mut Context<Self>) -> bool {
        if self.crop.is_none() && self.snap_guides.is_empty() {
            return false;
        }
        self.crop = None;
        self.snap_guides.clear();
        self.drag = None;
        cx.notify();
        true
    }
}

fn crop_moved(previous: AreaRect, next: AreaRect) -> bool {
    (previous.x - next.x).abs() > 0.5
        || (previous.y - next.y).abs() > 0.5
        || (previous.width - next.width).abs() > 0.5
        || (previous.height - next.height).abs() > 0.5
}

#[cfg(test)]
mod tests {
    use super::{AreaRect, DisplayFrame, selection_on_display};

    fn frame(x: f32, y: f32, width: f32, height: f32) -> DisplayFrame {
        DisplayFrame {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn a_selection_that_has_crossed_lands_on_the_other_display() {
        let right = frame(1920., 0., 1920., 1080.);
        let local = selection_on_display(
            ScreenRect {
                x: 2100.,
                y: 240.,
                width: 640.,
                height: 360.,
            },
            right,
        );
        assert_eq!(
            local,
            AreaRect {
                x: 180.,
                y: 240.,
                width: 640.,
                height: 360.,
            }
        );
    }

    #[test]
    fn a_selection_still_crossing_the_edge_slides_fully_onto_the_destination() {
        let right = frame(1920., 0., 1920., 1080.);
        let local = selection_on_display(
            ScreenRect {
                x: 1700.,
                y: 400.,
                width: 400.,
                height: 300.,
            },
            right,
        );
        assert_eq!(
            local,
            AreaRect {
                x: 0.,
                y: 400.,
                width: 400.,
                height: 300.,
            }
        );
    }

    #[test]
    fn the_shared_edge_belongs_to_the_next_display() {
        let left = frame(0., 0., 1920., 1080.);
        let right = frame(1920., 0., 1920., 1080.);
        assert!(!left.contains(1920., 10.));
        assert!(right.contains(1920., 10.));
    }

    #[test]
    fn a_selection_larger_than_the_destination_shrinks_to_fit() {
        let left = frame(0., 0., 1920., 1080.);
        let local = selection_on_display(
            ScreenRect {
                x: 100.,
                y: 100.,
                width: 4000.,
                height: 2000.,
            },
            left,
        );
        assert_eq!(
            local,
            AreaRect {
                x: 0.,
                y: 0.,
                width: 1920.,
                height: 1080.,
            }
        );
    }
}
