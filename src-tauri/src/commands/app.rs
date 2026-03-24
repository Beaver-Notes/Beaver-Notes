use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State, Theme};
use tauri_plugin_notification::NotificationExt;

use crate::shared::*;

#[cfg(desktop)]
use crate::bootstrap::{get_legacy_migration_status, run_legacy_store_data_migration};

#[cfg(desktop)]
use crate::menu::build_context_menu;

#[tauri::command]
pub(crate) fn app_info(app: AppHandle) -> Result<AppInfo, String> {
    Ok(AppInfo {
        name: app.package_info().name.clone(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
pub(crate) fn migration_status(app: AppHandle) -> Result<LegacyMigrationStatus, String> {
    #[cfg(desktop)]
    {
        get_legacy_migration_status(&app)
    }

    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(LegacyMigrationStatus::default())
    }
}

#[tauri::command]
pub(crate) fn migration_run(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LegacyMigrationResult, String> {
    #[cfg(desktop)]
    {
        run_legacy_store_data_migration(&app, state.inner())
    }

    #[cfg(not(desktop))]
    {
        let _ = (app, state);
        Err("Legacy migration is only available on desktop".into())
    }
}

#[tauri::command]
pub(crate) fn show_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(to_error)
}

#[tauri::command]
pub(crate) fn set_spellcheck(app: AppHandle, enabled: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
            .emit("spellcheck-changed", json!({ "enabled": enabled }))
            .map_err(to_error)?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn set_zoom(app: AppHandle, state: State<AppState>, level: f64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.set_zoom(level).map_err(to_error)?;
    }
    *state.zoom_level.lock().map_err(to_error)? = level;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_zoom(state: State<AppState>) -> Result<f64, String> {
    Ok(*state.zoom_level.lock().map_err(to_error)?)
}

#[tauri::command]
pub(crate) fn change_menu_visibility(app: AppHandle, visible: bool) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if visible {
            window.show_menu().map_err(to_error)?;
        } else {
            window.hide_menu().map_err(to_error)?;
        }
    }

    #[cfg(not(desktop))]
    let _ = (app, visible);

    Ok(())
}

#[tauri::command]
pub(crate) fn app_ready(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    if let Some(banner) = state
        .updater
        .lock()
        .map_err(to_error)?
        .pending_banner_data
        .clone()
    {
        app.emit_to(MAIN_WINDOW_LABEL, "update-banner", banner)
            .map_err(to_error)?;
    }

    let queued = state.pending_open_files.lock().map_err(to_error)?.clone();
    for file_path in queued {
        app.emit_to(MAIN_WINDOW_LABEL, "file-opened", file_path)
            .map_err(to_error)?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn helper_relaunch(app: AppHandle) -> Result<(), String> {
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
pub(crate) fn helper_get_path(app: AppHandle, name: String) -> Result<String, String> {
    Ok(path_for_name(&app, &name)?.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn helper_is_dark_theme(app: AppHandle) -> Result<bool, String> {
    let theme = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .and_then(|window| window.theme().ok())
        .unwrap_or(Theme::Light);
    Ok(matches!(theme, Theme::Dark))
}

#[tauri::command]
pub(crate) fn show_edit_context_menu(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let window = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| "Main window not found".to_string())?;
        let menu = build_context_menu(&app)?;
        return window.popup_menu(&menu).map_err(to_error);
    }

    #[cfg(not(desktop))]
    let _ = app;

    #[cfg(not(desktop))]
    {
        Ok(())
    }
}
