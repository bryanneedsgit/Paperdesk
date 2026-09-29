use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri_plugin_fs::FsExt;

const MAX_PPD_BYTES: u64 = 512 * 1024 * 1024;

pub fn is_ppd_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("ppd"))
}

#[tauri::command]
pub fn read_ppd_file_bytes(app: tauri::AppHandle, path: String) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(path);
    if !is_ppd_path(&path) {
        return Err("Choose a .ppd file.".into());
    }
    let file = fs::File::open(&path).map_err(|error| error.to_string())?;
    if file.metadata().map_err(|error| error.to_string())?.len() > MAX_PPD_BYTES {
        return Err("This PaperDesk document exceeds the 512 MB size limit.".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_PPD_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_PPD_BYTES {
        return Err("PaperDesk document is too large.".into());
    }
    app.fs_scope()
        .allow_file(path)
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

#[tauri::command]
pub fn can_write_ppd_file(app: tauri::AppHandle, path: String) -> bool {
    is_ppd_path(Path::new(&path)) && app.fs_scope().is_allowed(path)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Choose a valid save location.")?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    temporary
        .write_all(bytes)
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary.persist(path).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn write_ppd_file_atomic(
    app: tauri::AppHandle,
    path: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let selected_path = PathBuf::from(&path);
    if !app.fs_scope().is_allowed(&selected_path) {
        return Err("Choose the save location again using Save As.".into());
    }
    if bytes.len() as u64 > MAX_PPD_BYTES {
        return Err("PaperDesk document is too large.".into());
    }
    let destination = if is_ppd_path(&selected_path) {
        selected_path
    } else {
        PathBuf::from(format!("{path}.ppd"))
    };
    // If the suffix changes the destination, do not silently overwrite an unconfirmed file.
    if destination != PathBuf::from(&path) && destination.exists() {
        return Err(
            "A .ppd file already exists here. Choose it explicitly in Save As to replace it."
                .into(),
        );
    }
    write_atomic(&destination, &bytes)?;
    app.fs_scope()
        .allow_file(&destination)
        .map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replaces_file_and_leaves_no_temporary_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("notes.ppd");
        fs::write(&path, b"old").unwrap();
        write_atomic(&path, b"new").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
    #[test]
    fn failed_replace_preserves_destination() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("notes.ppd");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("keep"), b"old").unwrap();
        assert!(write_atomic(&destination, b"new").is_err());
        assert_eq!(fs::read(destination.join("keep")).unwrap(), b"old");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
