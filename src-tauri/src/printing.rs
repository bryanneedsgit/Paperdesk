use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

static PRINTING: AtomicBool = AtomicBool::new(false);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintRequest {
    marked_pdf: Vec<u8>,
    clean_pdf: Option<Vec<u8>>,
    title: String,
    current_page: u32,
    selected_pages: Vec<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PrintOutcome {
    Submitted,
    Cancelled,
}

struct PrintGuard;
impl Drop for PrintGuard {
    fn drop(&mut self) {
        PRINTING.store(false, Ordering::Release);
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
extern "C" {
    fn paperdesk_print(
        owner: *mut std::ffi::c_void,
        marked: *const u8,
        marked_len: usize,
        clean: *const u8,
        clean_len: usize,
        title: *const std::ffi::c_char,
        current: u32,
        selected: *const u32,
        selected_len: usize,
    ) -> i32;
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn run_native(owner: usize, request: PrintRequest) -> Result<PrintOutcome, String> {
    let title = std::ffi::CString::new(request.title.replace('\0', ""))
        .map_err(|_| "Invalid print job title.".to_string())?;
    let clean = request.clean_pdf.as_deref().unwrap_or(&[]);
    // Native adapters copy/retain document data until the modal operation returns.
    // The owner handle is supplied by Tauri, never by the webview caller.
    let result = unsafe {
        paperdesk_print(
            owner as *mut _,
            request.marked_pdf.as_ptr(),
            request.marked_pdf.len(),
            clean.as_ptr(),
            clean.len(),
            title.as_ptr(),
            request.current_page,
            request.selected_pages.as_ptr(),
            request.selected_pages.len(),
        )
    };
    match result {
        1 => Ok(PrintOutcome::Submitted),
        0 => Ok(PrintOutcome::Cancelled),
        -1 => Err("The prepared PDF could not be opened for printing.".into()),
        _ => Err("The print job could not be submitted. Check your printer and try again.".into()),
    }
}

#[tauri::command]
pub async fn print_document(
    window: tauri::WebviewWindow,
    request: PrintRequest,
) -> Result<PrintOutcome, String> {
    if PRINTING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("A print dialog is already open.".into());
    }
    let guard = PrintGuard;
    if request.marked_pdf.is_empty() || request.current_page == 0 {
        return Err("There are no pages to print.".into());
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        let owner = window.ns_window().map_err(|e| e.to_string())? as usize;
        #[cfg(target_os = "windows")]
        let owner = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        window
            .run_on_main_thread(move || {
                let _guard = guard;
                let _ = tx.send(run_native(owner, request));
            })
            .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            rx.recv()
                .map_err(|_| "The print dialog closed unexpectedly.".to_string())?
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (window, guard);
        Err("Printing is supported on macOS and Windows.".into())
    }
}
