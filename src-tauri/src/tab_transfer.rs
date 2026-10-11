//! In-memory handoff: source ownership is retained until the receiver acknowledges installation.
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Default)]
pub struct TabTransfers(Mutex<HashMap<String, Transfer>>, Mutex<Vec<String>>);
struct Transfer {
    source: String,
    target: String,
    payload: Option<String>,
    status: String,
    created: Instant,
    claimed: bool,
}
static NEXT_WINDOW: AtomicU64 = AtomicU64::new(1);

fn contains(window: &WebviewWindow, point: tauri::PhysicalPosition<f64>) -> bool {
    if window.is_minimized().unwrap_or(true) || !window.is_visible().unwrap_or(false) {
        return false;
    }
    match (window.outer_position(), window.outer_size()) {
        (Ok(p), Ok(s)) => {
            point.x >= p.x as f64
                && point.y >= p.y as f64
                && point.x < p.x as f64 + s.width as f64
                && point.y < p.y as f64 + s.height as f64
        }
        _ => false,
    }
}

#[tauri::command]
pub async fn move_workspace_tabs(
    window: WebviewWindow,
    state: State<'_, TabTransfers>,
    payload: String,
    new_window: bool,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<Option<String>, String> {
    let app = window.app_handle();
    let cursor = if let (Some(x), Some(y)) = (x, y) {
        if !x.is_finite() || !y.is_finite() {
            return Err("Invalid drop position".into());
        }
        let origin = window.inner_position().map_err(|e| e.to_string())?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        tauri::PhysicalPosition::new(origin.x as f64 + x * scale, origin.y as f64 + y * scale)
    } else {
        window.cursor_position().map_err(|e| e.to_string())?
    };
    if !new_window && contains(&window, cursor) {
        return Ok(None);
    }
    let mut candidates: Vec<_> = app
        .webview_windows()
        .into_values()
        .filter(|w| w.label() != window.label() && contains(w, cursor))
        .collect();
    {
        let order = state.1.lock().map_err(|e| e.to_string())?;
        candidates
            .sort_by_key(|w| std::cmp::Reverse(order.iter().position(|label| label == w.label())));
    }
    let existing = if new_window {
        None
    } else {
        candidates.into_iter().next()
    };
    let target = if let Some(target) = existing {
        target
    } else {
        let label = format!("workspace-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
        let target = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .title("Paperdesk")
            .inner_size(1280.0, 820.0)
            .min_inner_size(900.0, 620.0)
            .build()
            .map_err(|e| e.to_string())?;
        let _ = target.set_position(tauri::PhysicalPosition::new(
            cursor.x as i32 - 120,
            cursor.y as i32 - 40,
        ));
        target
    };
    let id = format!(
        "{}-{}",
        window.label(),
        NEXT_WINDOW.fetch_add(1, Ordering::Relaxed)
    );
    state.0.lock().map_err(|e| e.to_string())?.insert(
        id.clone(),
        Transfer {
            source: window.label().into(),
            target: target.label().into(),
            payload: Some(payload),
            status: "pending".into(),
            created: Instant::now(),
            claimed: false,
        },
    );
    let _ = target.set_focus();
    Ok(Some(id))
}

#[tauri::command]
pub fn receive_workspace_tabs(
    window: WebviewWindow,
    state: State<'_, TabTransfers>,
) -> Result<Option<(String, String)>, String> {
    let mut transfers = state.0.lock().map_err(|e| e.to_string())?;
    for (id, transfer) in transfers.iter_mut() {
        if transfer.target == window.label() && transfer.status == "pending" {
            if !transfer.claimed && transfer.created.elapsed() > Duration::from_secs(30) {
                continue;
            }
            transfer.claimed = true;
            return Ok(transfer
                .payload
                .as_ref()
                .map(|payload| (id.clone(), payload.clone())));
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn finish_workspace_tabs(
    window: WebviewWindow,
    state: State<'_, TabTransfers>,
    id: String,
    accepted: bool,
) -> Result<(), String> {
    let mut transfers = state.0.lock().map_err(|e| e.to_string())?;
    let Some(transfer) = transfers.get_mut(&id) else {
        return Ok(());
    };
    if transfer.target != window.label() {
        return Err("Wrong destination window".into());
    }
    if transfer.status != "pending" {
        return Ok(());
    }
    transfer.status = if accepted { "accepted" } else { "rejected" }.into();
    transfer.payload = None;
    Ok(())
}

#[tauri::command]
pub fn workspace_tabs_status(
    window: WebviewWindow,
    state: State<'_, TabTransfers>,
    id: String,
) -> Result<String, String> {
    let mut transfers = state.0.lock().map_err(|e| e.to_string())?;
    let transfer = transfers.get_mut(&id).ok_or("Transfer no longer exists")?;
    if transfer.source != window.label() {
        return Err("Wrong source window".into());
    }
    if transfer.status == "pending"
        && (window
            .app_handle()
            .get_webview_window(&transfer.target)
            .is_none()
            || (!transfer.claimed && transfer.created.elapsed() > Duration::from_secs(30)))
    {
        transfer.status = "rejected".into();
        transfer.payload = None;
    }
    // Keep completion idempotent when an IPC response is lost. Payload bytes were released above.
    Ok(transfer.status.clone())
}

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    let state = window.state::<TabTransfers>();
    if matches!(event, tauri::WindowEvent::Focused(true)) {
        if let Ok(mut order) = state.1.lock() {
            order.retain(|label| label != window.label());
            order.push(window.label().into());
        }
    }
    if matches!(event, tauri::WindowEvent::Destroyed) {
        if let Ok(mut transfers) = state.0.lock() {
            transfers.retain(|_, transfer| transfer.source != window.label());
        }
        if let Ok(mut order) = state.1.lock() {
            order.retain(|label| label != window.label());
        }
    }
}
