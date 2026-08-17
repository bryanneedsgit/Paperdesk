use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::{Emitter, Manager, State};

mod pdf_security;

use pdf_security::{prepare_pdf_for_open, protect_pdf_bytes};

const OPEN_PDFS_EVENT: &str = "paperdesk://open-pdfs";

struct PendingOpenPaths(Mutex<Vec<String>>);

#[tauri::command]
fn drain_pending_open_paths(state: State<'_, PendingOpenPaths>) -> Vec<String> {
    let mut pending_paths = state.0.lock().expect("pending open paths mutex poisoned");
    std::mem::take(&mut *pending_paths)
}

#[tauri::command]
fn read_pdf_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(path);

    let is_pdf = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));

    if !is_pdf {
        return Err("Only PDF files can be opened.".to_string());
    }

    fs::read(&path).map_err(|error| format!("Unable to read PDF file: {error}"))
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
fn collect_pdf_paths(urls: Vec<url::Url>) -> Vec<PathBuf> {
    urls.into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| is_pdf_path(path.as_path()))
        .collect()
}

fn collect_startup_pdf_paths() -> Vec<PathBuf> {
    let cwd = env::current_dir().ok();

    env::args()
        .skip(1)
        .filter_map(|arg| arg_to_pdf_path(&arg, cwd.as_deref()))
        .collect()
}

fn collect_pdf_arg_paths(args: Vec<String>, cwd: &str) -> Vec<PathBuf> {
    let cwd = PathBuf::from(cwd);

    args.into_iter()
        .filter_map(|arg| arg_to_pdf_path(&arg, Some(cwd.as_path())))
        .collect()
}

fn arg_to_pdf_path(arg: &str, cwd: Option<&Path>) -> Option<PathBuf> {
    if let Ok(url) = url::Url::parse(arg) {
        if let Ok(path) = url.to_file_path() {
            return is_pdf_path(path.as_path()).then_some(path);
        }
    }

    let path = PathBuf::from(arg);
    let path = if path.is_absolute() {
        path
    } else if let Some(cwd) = cwd {
        cwd.join(path)
    } else {
        path
    };

    is_pdf_path(path.as_path()).then_some(path)
}

fn is_pdf_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
}

fn paths_to_strings(paths: Vec<PathBuf>) -> Vec<String> {
    paths
        .into_iter()
        .filter_map(|path| path.into_os_string().into_string().ok())
        .collect()
}

fn allow_pdf_paths(app_handle: &tauri::AppHandle, paths: &[String]) {
    let scopes = app_handle.state::<tauri::scope::Scopes>();

    for path in paths {
        let _ = scopes.allow_file(PathBuf::from(path));
    }
}

fn queue_open_pdf_paths(app_handle: &tauri::AppHandle, paths: Vec<String>, emit_event: bool) {
    if paths.is_empty() {
        return;
    }

    allow_pdf_paths(app_handle, &paths);

    let pending_paths = app_handle.state::<PendingOpenPaths>();
    pending_paths
        .0
        .lock()
        .expect("pending open paths mutex poisoned")
        .extend(paths.clone());

    if emit_event {
        let _ = app_handle.emit(OPEN_PDFS_EVENT, paths);
    }
}

fn handle_run_event(app_handle: &tauri::AppHandle, event: tauri::RunEvent) {
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
    if let tauri::RunEvent::Opened { urls } = event {
        let pdf_paths = collect_pdf_paths(urls);
        queue_open_pdf_paths(app_handle, paths_to_strings(pdf_paths), true);
    }

    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
    let _ = (app_handle, event);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_pdf_paths = paths_to_strings(collect_startup_pdf_paths());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue_open_pdf_paths(
                app,
                paths_to_strings(collect_pdf_arg_paths(args, &cwd)),
                true,
            );

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(PendingOpenPaths(Mutex::new(startup_pdf_paths.clone())))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            drain_pending_open_paths,
            prepare_pdf_for_open,
            protect_pdf_bytes,
            read_pdf_file_bytes,
        ])
        .setup(move |app| {
            allow_pdf_paths(app.handle(), &startup_pdf_paths);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Paperdesk")
        .run(handle_run_event);
}
