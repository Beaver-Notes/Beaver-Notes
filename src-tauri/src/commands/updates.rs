use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;

use crate::shared::*;

fn emit_update_status(
    app: &AppHandle,
    message: &str,
    kind: &str,
    extra: Value,
) -> Result<(), String> {
    let mut payload = json!({
      "message": message,
      "type": kind,
      "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    if let Some(map) = payload.as_object_mut() {
        if let Some(extra_map) = extra.as_object() {
            for (key, value) in extra_map {
                map.insert(key.clone(), value.clone());
            }
        }
    }
    app.emit_to(MAIN_WINDOW_LABEL, "update-status-changed", payload)
        .map_err(to_error)
}

fn emit_update_progress(
    app: &AppHandle,
    percent: f64,
    transferred: u64,
    total: u64,
    bytes_per_second: f64,
) -> Result<(), String> {
    app.emit_to(
        MAIN_WINDOW_LABEL,
        "update-progress-changed",
        json!({
          "percent": percent,
          "transferred": transferred,
          "total": total,
          "bytesPerSecond": bytes_per_second,
        }),
    )
    .map_err(to_error)
}

pub(crate) fn load_auto_update_enabled(app: &AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let pool = settings_pool(app, state.inner())?;
    Ok(crate::db::db_get(pool, "autoUpdateEnabled")?
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| value.as_bool())
        .unwrap_or(true))
}

fn save_auto_update_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let pool = settings_pool(app, state.inner())?;
    let serialized = serde_json::to_string(&json!(enabled)).map_err(to_error)?;
    crate::db::db_set(pool, "autoUpdateEnabled", &serialized)
}

#[tauri::command]
pub(crate) async fn check_for_updates(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CheckResult, String> {
    {
        let mut updater = state.updater.lock().map_err(to_error)?;
        if updater.is_checking || updater.is_downloading {
            return Ok(CheckResult {
                success: false,
                available: updater.available_version.is_some(),
                version: updater.available_version.clone(),
                error: Some("Update check already in progress".into()),
            });
        }
        updater.is_checking = true;
    }
    let _ = emit_update_status(&app, "Checking for updates...", "checking", json!({}));

    let updater_client = match app.updater().map_err(to_error) {
        Ok(client) => client,
        Err(error) => {
            let mut updater = state.updater.lock().map_err(to_error)?;
            updater.is_checking = false;
            let _ = emit_update_status(
                &app,
                &format!("Update check failed: {error}"),
                "error",
                json!({ "error": error.clone() }),
            );
            return Ok(CheckResult {
                success: false,
                available: false,
                version: None,
                error: Some(error),
            });
        }
    };

    match updater_client.check().await.map_err(to_error) {
        Err(error) => {
            let mut updater = state.updater.lock().map_err(to_error)?;
            updater.is_checking = false;
            let _ = emit_update_status(
                &app,
                &format!("Update check failed: {error}"),
                "error",
                json!({ "error": error.clone() }),
            );
            Ok(CheckResult {
                success: false,
                available: false,
                version: None,
                error: Some(error),
            })
        }
        Ok(Some(update)) => {
            let mut updater = state.updater.lock().map_err(to_error)?;
            updater.is_checking = false;
            updater.available_version = Some(update.version.clone());
            updater.current_version = Some(update.current_version.clone());
            updater.downloaded_update = Some(update.clone());
            let version = update.version.clone();
            let _ = emit_update_status(
                &app,
                &format!("Update available: {version}"),
                "available",
                json!({ "version": version }),
            );
            Ok(CheckResult {
                success: true,
                available: true,
                version: Some(update.version),
                error: None,
            })
        }
        Ok(None) => {
            let current = app.package_info().version.to_string();
            let mut updater = state.updater.lock().map_err(to_error)?;
            updater.is_checking = false;
            updater.current_version = Some(current.clone());
            updater.available_version = None;
            let _ = emit_update_status(
                &app,
                "You have the latest version",
                "not-available",
                json!({ "version": current }),
            );
            Ok(CheckResult {
                success: true,
                available: false,
                version: None,
                error: None,
            })
        }
    }
}

#[tauri::command]
pub(crate) async fn download_update(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let update = {
        let mut updater = state.updater.lock().map_err(to_error)?;
        if updater.is_downloading {
            return Err("Download already in progress".into());
        }
        updater.is_downloading = true;
        updater
            .downloaded_update
            .clone()
            .ok_or_else(|| "No update available to download".to_string())?
    };

    let started = std::time::Instant::now();
    let mut transferred = 0_u64;
    let total_holder = Arc::new(Mutex::new(0_u64));
    let total_ref = total_holder.clone();
    let progress_app = app.clone();
    let bytes = update
        .download(
            move |chunk_length, total| {
                transferred += chunk_length as u64;
                let total_bytes = total.unwrap_or_default();
                if let Ok(mut total_guard) = total_ref.lock() {
                    *total_guard = total_bytes;
                }
                let percent = if total_bytes > 0 {
                    (transferred as f64 / total_bytes as f64) * 100.0
                } else {
                    0.0
                };
                let elapsed = started.elapsed().as_secs_f64().max(0.001);
                let rate = transferred as f64 / elapsed;
                let _ =
                    emit_update_progress(&progress_app, percent, transferred, total_bytes, rate);
            },
            || {},
        )
        .await
        .map_err(to_error)?;

    let version = update.version.clone();
    let banner = BannerData {
        content: format!("An update is ready: {version}"),
        primary_text: "Install now".into(),
        secondary_text: "Later".into(),
        version: version.clone(),
    };

    let mut updater = state.updater.lock().map_err(to_error)?;
    updater.is_downloading = false;
    updater.pending_banner_data = Some(banner.clone());
    updater.downloaded_bytes = Some(bytes);
    drop(updater);

    let _ = emit_update_status(
        &app,
        &format!("Update ready to install: {version}"),
        "ready",
        json!({ "version": version }),
    );
    app.emit_to(MAIN_WINDOW_LABEL, "update-banner", banner)
        .map_err(to_error)
}

#[tauri::command]
pub(crate) fn install_update(state: State<AppState>) -> Result<(), String> {
    let updater = state.updater.lock().map_err(to_error)?;
    let update = updater
        .downloaded_update
        .clone()
        .ok_or_else(|| "No downloaded update".to_string())?;
    let bytes = updater
        .downloaded_bytes
        .clone()
        .ok_or_else(|| "No update payload available".to_string())?;
    update.install(bytes).map_err(to_error)
}

#[tauri::command]
pub(crate) fn toggle_auto_update(
    app: AppHandle,
    state: State<AppState>,
    enabled: bool,
) -> Result<(), String> {
    save_auto_update_enabled(&app, enabled)?;
    state.updater.lock().map_err(to_error)?.auto_update_enabled = enabled;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_auto_update_status(state: State<AppState>) -> Result<bool, String> {
    Ok(state.updater.lock().map_err(to_error)?.auto_update_enabled)
}

#[tauri::command]
pub(crate) fn is_update_downloading(state: State<AppState>) -> Result<bool, String> {
    Ok(state.updater.lock().map_err(to_error)?.is_downloading)
}

#[tauri::command]
pub(crate) fn get_update_info(state: State<AppState>) -> Result<UpdateInfo, String> {
    let updater = state.updater.lock().map_err(to_error)?;
    Ok(UpdateInfo {
        is_checking: updater.is_checking,
        is_downloading: updater.is_downloading,
        current_version: updater.current_version.clone(),
        available_version: updater.available_version.clone(),
        auto_update_enabled: updater.auto_update_enabled,
        is_busy: updater.is_checking || updater.is_downloading,
    })
}
