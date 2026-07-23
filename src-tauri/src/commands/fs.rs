use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::shared::*;

#[tauri::command]
pub(crate) fn fs_copy(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    dest: String,
) -> Result<(), AppError> {
    let src_path = PathBuf::from(path);
    let dest_path = PathBuf::from(dest);
    assert_path_access(&app, &state, &src_path, "copy source")?;
    assert_path_access(&app, &state, &dest_path, "copy destination")?;

    if src_path.is_dir() {
        copy_dir_recursive(&app, &state, &src_path, &dest_path)?;
        return Ok(());
    }

    let mut final_dest = dest_path.clone();
    if final_dest.exists() && final_dest.is_dir() {
        final_dest = final_dest.join(src_path.file_name().unwrap_or_default());
    }
    if let Some(parent) = final_dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = fs::read(&src_path)?;
    let payload = encrypt_asset(&app, &state, &final_dest, &raw, false)?;
    fs::write(final_dest, payload)?;
    Ok(())
}

fn copy_dir_recursive(
    app: &AppHandle,
    state: &State<'_, AppState>,
    src: &Path,
    dest: &Path,
) -> Result<(), AppError> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(app, state, &src_path, &dest_path)?;
        } else {
            let raw = fs::read(&src_path)?;
            let payload = encrypt_asset(app, state, &dest_path, &raw, false)?;
            fs::write(dest_path, payload)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn fs_output_json(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    data: Value,
) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "write json")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let serialized = serde_json::to_vec_pretty(&data)?;
    fs::write(path, serialized)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn fs_read_json(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<Value, AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "read json")?;
    let raw = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw)?)
}

#[tauri::command]
pub(crate) fn fs_ensure_dir(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "ensure directory")?;
    fs::create_dir_all(path)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn fs_path_exists(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<bool, AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "check path exists")?;
    Ok(path.exists())
}

#[tauri::command]
pub(crate) fn fs_remove(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "remove path")?;
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn fs_write_file(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    data: Vec<u8>,
    mode: Option<u32>,
    skip_asset_encryption: Option<bool>,
) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "write file")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let payload = encrypt_asset(
        &app,
        &state,
        &path,
        &data,
        skip_asset_encryption.unwrap_or(false),
    )?;
    let mut file = fs::File::create(&path)?;
    file.write_all(&payload)?;
    #[cfg(unix)]
    if let Some(mode) = mode {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn fs_mkdir(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    mode: Option<u32>,
) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "mkdir")?;
    fs::create_dir_all(&path)?;
    #[cfg(unix)]
    if let Some(mode) = mode {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn fs_read_file(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<String, AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "read file")?;
    Ok(fs::read_to_string(path)?)
}

#[tauri::command]
pub(crate) fn fs_readdir(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<Vec<String>, AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "read directory")?;
    let mut entries = fs::read_dir(path)?
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    entries.sort();
    Ok(entries)
}

#[tauri::command]
pub(crate) fn fs_stat(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<FileStat, AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "stat")?;
    Ok(to_file_stat(fs::metadata(path)?))
}

#[tauri::command]
pub(crate) fn fs_unlink(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "unlink")?;
    fs::remove_file(path)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn fs_read_data(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    skip_decryption: Option<bool>,
) -> Result<String, AppError> {
    let actual_path = resolve_asset_path_from_uri(&app, &path)?;
    assert_path_access(&app, &state, &actual_path, "read data")?;
    let raw = fs::read(&actual_path)?;
    let plain = if skip_decryption.unwrap_or(false) {
        raw
    } else {
        decrypt_asset(&app, &state, &actual_path, &raw)?
    };
    Ok(BASE64.encode(plain))
}

#[tauri::command]
pub(crate) fn fs_is_file(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<bool, AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "is file")?;
    Ok(path.is_file())
}

#[tauri::command]
pub(crate) fn fs_access(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<bool, AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "access check")?;
    Ok(path.exists())
}
