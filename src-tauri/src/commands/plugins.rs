use std::fs;
use std::path::PathBuf;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::shared::*;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginEntry {
    pub(crate) manifest: serde_json::Value,
    pub(crate) source_code: String,
    pub(crate) settings_source: Option<String>,
    pub(crate) icon_url: Option<String>,
    pub(crate) enabled: bool,
    pub(crate) user_grants: Option<Vec<String>>,
}

fn plugins_dir(app: &AppHandle, state: &AppState) -> Result<PathBuf, String> {
    Ok(app_storage_dir(app, state)?.join("plugins"))
}

fn plugin_dir(app: &AppHandle, state: &AppState, plugin_id: &str) -> Result<PathBuf, String> {
    let dir = plugins_dir(app, state)?.join(plugin_id);
    Ok(dir)
}

fn plugin_data_dir(app: &AppHandle, state: &AppState, plugin_id: &str) -> Result<PathBuf, String> {
    let dir = plugin_dir(app, state, plugin_id)?.join("data");
    fs::create_dir_all(&dir).map_err(to_error)?;
    Ok(dir)
}

fn resolve_plugin_fs_path(
    app: &AppHandle,
    state: &AppState,
    plugin_id: &str,
    path: &str,
) -> Result<PathBuf, String> {
    let base = plugin_data_dir(app, state, plugin_id)?;
    let clean = path.trim_start_matches('/').trim_start_matches('\\');
    if clean.contains("..") || clean.contains("\\") {
        return Err("Path traversal not allowed".to_string());
    }
    let resolved = base.join(clean);
    if !is_path_inside(&base, &resolved) {
        return Err("Path escapes plugin data directory".to_string());
    }
    Ok(resolved)
}

#[tauri::command]
pub(crate) fn install_plugin(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    manifest: String,
    source_code: String,
    settings_source: String,
    icon_url: String,
) -> Result<(), String> {
    let dir = plugin_dir(&app, &state, &plugin_id)?;
    fs::create_dir_all(&dir).map_err(to_error)?;

    let manifest_path = dir.join("manifest.json");
    fs::write(&manifest_path, &manifest).map_err(to_error)?;

    let source_path = dir.join("source.js");
    fs::write(&source_path, &source_code).map_err(to_error)?;

    if !settings_source.is_empty() {
        let settings_path = dir.join("settings.js");
        fs::write(&settings_path, &settings_source).map_err(to_error)?;
    }

    let meta = serde_json::json!({
        "enabled": true,
        "installTs": now_millis(),
        "iconUrl": icon_url,
    });
    let meta_path = dir.join("store.json");
    fs::write(&meta_path, serde_json::to_string(&meta).map_err(to_error)?).map_err(to_error)?;

    Ok(())
}

#[tauri::command]
pub(crate) fn uninstall_plugin(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<(), String> {
    let dir = plugin_dir(&app, &state, &plugin_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(to_error)?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn set_plugin_grants(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    grants: Vec<String>,
) -> Result<(), String> {
    let dir = plugin_dir(&app, &state, &plugin_id)?;
    let meta_path = dir.join("store.json");

    let mut meta: serde_json::Value = if meta_path.exists() {
        let raw = fs::read_to_string(&meta_path).unwrap_or_default();
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        serde_json::Value::Object(serde_json::Map::new())
    };

    meta["userGrants"] = serde_json::Value::Array(
        grants.iter().map(|g| serde_json::Value::String(g.clone())).collect(),
    );

    fs::write(&meta_path, serde_json::to_string(&meta).map_err(to_error)?)
        .map_err(to_error)?;

    Ok(())
}

#[tauri::command]
pub(crate) fn plugin_fs_read_text(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    path: String,
) -> Result<String, String> {
    let resolved = resolve_plugin_fs_path(&app, &state, &plugin_id, &path)?;
    if !resolved.exists() {
        return Err(format!("File not found: {}", path));
    }
    fs::read_to_string(&resolved).map_err(to_error)
}

#[tauri::command]
pub(crate) fn plugin_fs_write_text(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let resolved = resolve_plugin_fs_path(&app, &state, &plugin_id, &path)?;
    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent).map_err(to_error)?;
    }
    fs::write(&resolved, &content).map_err(to_error)
}

#[tauri::command]
pub(crate) fn plugin_fs_read_binary(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    path: String,
) -> Result<String, String> {
    let resolved = resolve_plugin_fs_path(&app, &state, &plugin_id, &path)?;
    if !resolved.exists() {
        return Err(format!("File not found: {}", path));
    }
    let bytes = fs::read(&resolved).map_err(to_error)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[tauri::command]
pub(crate) fn plugin_fs_write_binary(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    path: String,
    data: String,
) -> Result<(), String> {
    let resolved = resolve_plugin_fs_path(&app, &state, &plugin_id, &path)?;
    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent).map_err(to_error)?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Invalid base64 data: {e}"))?;
    fs::write(&resolved, &bytes).map_err(to_error)
}

#[tauri::command]
pub(crate) fn plugin_fs_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    path: String,
) -> Result<(), String> {
    let resolved = resolve_plugin_fs_path(&app, &state, &plugin_id, &path)?;
    if !resolved.exists() {
        return Ok(());
    }
    if resolved.is_dir() {
        fs::remove_dir_all(&resolved).map_err(to_error)
    } else {
        fs::remove_file(&resolved).map_err(to_error)
    }
}

fn interop_grants_path(app: &AppHandle, state: &AppState, plugin_id: &str) -> Result<PathBuf, String> {
    Ok(plugin_dir(app, state, plugin_id)?.join("interop-grants.json"))
}

fn read_interop_grants(path: &PathBuf) -> Result<Vec<String>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path).map_err(to_error)?;
    let grants: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();
    Ok(grants)
}

fn write_interop_grants(path: &PathBuf, grants: &[String]) -> Result<(), String> {
    fs::write(path, serde_json::to_string(grants).map_err(to_error)?).map_err(to_error)
}

#[tauri::command]
pub(crate) fn get_interop_grants(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<Vec<String>, String> {
    let path = interop_grants_path(&app, &state, &plugin_id)?;
    read_interop_grants(&path)
}

#[tauri::command]
pub(crate) fn add_interop_grant(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    target_plugin_id: String,
) -> Result<(), String> {
    let path = interop_grants_path(&app, &state, &plugin_id)?;
    let mut grants = read_interop_grants(&path)?;
    if !grants.contains(&target_plugin_id) {
        grants.push(target_plugin_id);
        write_interop_grants(&path, &grants)?;
    }
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FsEntry {
    name: String,
    is_dir: bool,
    size: u64,
    mtime_ms: u128,
}

#[tauri::command]
pub(crate) fn plugin_fs_list(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    dir: String,
) -> Result<Vec<FsEntry>, String> {
    let base = if dir.is_empty() {
        plugin_data_dir(&app, &state, &plugin_id)?
    } else {
        resolve_plugin_fs_path(&app, &state, &plugin_id, &dir)?
    };
    if !base.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    let dirs = fs::read_dir(&base).map_err(to_error)?;
    for entry in dirs {
        let entry = entry.map_err(to_error)?;
        let name = entry.file_name().to_string_lossy().to_string();
        let metadata = entry.metadata().map_err(to_error)?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .unwrap_or_default();
        entries.push(FsEntry {
            name,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            mtime_ms: modified,
        });
    }
    entries.sort_by(|a, b| {
        a.is_dir
            .cmp(&b.is_dir)
            .reverse()
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

#[tauri::command]
pub(crate) fn plugin_fs_exists(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    path: String,
) -> Result<bool, String> {
    let resolved = resolve_plugin_fs_path(&app, &state, &plugin_id, &path)?;
    Ok(resolved.exists())
}

#[tauri::command]
pub(crate) fn list_plugins(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<PluginEntry>, String> {
    let dir = plugins_dir(&app, &state)?;

    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let dirs = fs::read_dir(&dir).map_err(to_error)?;

    for entry in dirs {
        let entry = entry.map_err(to_error)?;
        if !entry.file_type().map_err(to_error)?.is_dir() {
            continue;
        }

        let plugin_dir = entry.path();
        let manifest_path = plugin_dir.join("manifest.json");
        let source_path = plugin_dir.join("source.js");
        let settings_path = plugin_dir.join("settings.js");
        let meta_path = plugin_dir.join("store.json");

        let manifest: serde_json::Value = match fs::read_to_string(&manifest_path) {
            Ok(raw) => match serde_json::from_str(&raw) {
                Ok(m) => m,
                Err(_) => continue,
            },
            Err(_) => continue,
        };

        let source_code = fs::read_to_string(&source_path).unwrap_or_default();

        let settings_source = if settings_path.exists() {
            fs::read_to_string(&settings_path).ok()
        } else {
            None
        };

        let (enabled, icon_url, user_grants) = if meta_path.exists() {
            let meta_raw = fs::read_to_string(&meta_path).unwrap_or_default();
            let meta: serde_json::Value =
                serde_json::from_str(&meta_raw).unwrap_or_default();
            let enabled = meta
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let icon_url = meta
                .get("iconUrl")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            let icon = if icon_url.is_empty() { None } else { Some(icon_url) };
            let grants = meta
                .get("userGrants")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect::<Vec<_>>()
                });
            (enabled, icon, grants)
        } else {
            (true, None, None)
        };

        entries.push(PluginEntry {
            manifest,
            source_code,
            settings_source,
            icon_url,
            enabled,
            user_grants,
        });
    }

    Ok(entries)
}
