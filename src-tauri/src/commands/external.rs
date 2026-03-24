use std::{
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::shared::*;

pub(crate) fn sync_external_temp_file(
    app: &AppHandle,
    original_path: &Path,
    temp_file: &Path,
) -> Result<(), String> {
    if !temp_file.exists() {
        return Ok(());
    }

    let state = app.state::<AppState>();
    let raw = fs::read(temp_file).map_err(to_error)?;
    let existing = fs::read(original_path).map_err(to_error)?;
    let payload = if is_encrypted_asset_buffer(&existing) {
        maybe_encrypt_asset(app, &state, original_path, &raw, false)?
    } else {
        raw
    };

    fs::write(original_path, payload).map_err(to_error)?;
    app.emit_to(
        MAIN_WINDOW_LABEL,
        "file-updated",
        json!({ "originalPath": original_path.to_string_lossy().to_string() }),
    )
    .map_err(to_error)
}

fn temp_file_signature(path: &Path) -> Option<(u128, u64)> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata
        .modified()
        .ok()?
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()?
        .as_millis();
    Some((modified, metadata.len()))
}

fn tracked_temp_file(app: &AppHandle, original_path: &Path) -> Option<PathBuf> {
    app.state::<AppState>()
        .external_open_files
        .lock()
        .ok()
        .and_then(|files| files.get(original_path).cloned())
}

fn track_temp_file(app: &AppHandle, original_path: &Path, temp_file: &Path) {
    if let Ok(mut files) = app.state::<AppState>().external_open_files.lock() {
        files.insert(original_path.to_path_buf(), temp_file.to_path_buf());
    }
}

fn watch_external_temp_file(
    app: AppHandle,
    original_path: PathBuf,
    temp_file: PathBuf,
) -> Result<(), String> {
    let initial_signature = temp_file_signature(&temp_file);

    std::thread::spawn(move || {
        let mut last_signature = initial_signature;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(350));

            let current_signature = temp_file_signature(&temp_file);
            if current_signature.is_none() {
                break;
            }
            if current_signature == last_signature {
                continue;
            }

            std::thread::sleep(std::time::Duration::from_millis(150));
            if let Err(error) = sync_external_temp_file(&app, &original_path, &temp_file) {
                eprintln!(
                    "[external-open] failed syncing {} back to {}: {}",
                    temp_file.display(),
                    original_path.display(),
                    error
                );
            } else {
                last_signature = temp_file_signature(&temp_file);
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub(crate) fn open_file_external(
    app: AppHandle,
    state: State<AppState>,
    src: String,
) -> Result<String, String> {
    let mut src = src;
    if src.starts_with("file-assets:") && !src.starts_with("file-assets://") {
        src = src.replacen("file-assets:", "file-assets://", 1);
    }

    let full_path = resolve_asset_path_from_uri(&app, &src).unwrap_or_else(|_| PathBuf::from(&src));
    assert_path_access(&app, &state, &full_path, "open file externally")?;
    if !full_path.exists() {
        return Err(format!("File not found: {}", full_path.display()));
    }

    if let Some(existing_temp) = tracked_temp_file(&app, &full_path) {
        if existing_temp.exists() {
            let _ = sync_external_temp_file(&app, &full_path, &existing_temp);
            app.opener()
                .open_path(existing_temp.to_string_lossy().to_string(), None::<String>)
                .map_err(to_error)?;
            return Ok(existing_temp.to_string_lossy().to_string());
        }
    }

    let temp_dir = state.external_open_dir.clone();
    fs::create_dir_all(&temp_dir).map_err(to_error)?;
    let ext = full_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let stem = full_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("asset");
    let temp_file = temp_dir.join(if ext.is_empty() {
        format!("{stem}-{}", now_millis())
    } else {
        format!("{stem}-{}.{}", now_millis(), ext)
    });
    let raw = fs::read(&full_path).map_err(to_error)?;
    let payload = maybe_decrypt_asset(&app, &state, &full_path, &raw)?;
    fs::write(&temp_file, payload).map_err(to_error)?;
    track_temp_file(&app, &full_path, &temp_file);
    watch_external_temp_file(app.clone(), full_path.clone(), temp_file.clone())?;
    app.opener()
        .open_path(temp_file.to_string_lossy().to_string(), None::<String>)
        .map_err(|error| {
            let _ = fs::remove_file(&temp_file);
            to_error(error)
        })?;

    Ok(temp_file.to_string_lossy().to_string())
}
