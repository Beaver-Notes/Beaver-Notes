use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, Theme};
use tauri_plugin_notification::NotificationExt;

use crate::shared::*;

#[cfg(desktop)]
use crate::bootstrap::{
    get_legacy_migration_status, get_legacy_migration_status_for_custom_path,
    run_legacy_store_data_migration, run_legacy_store_data_migration_from_path,
};
use crate::shared::path_for_name;

#[cfg(desktop)]
use crate::menu::build_context_menu;

#[tauri::command]
pub(crate) fn app_info(app: AppHandle) -> Result<AppInfo, AppError> {
    Ok(AppInfo {
        name: app.package_info().name.clone(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
pub(crate) fn app_directory(app: AppHandle, state: State<'_, AppState>) -> Result<String, AppError> {
    Ok(app_storage_dir(&app, state.inner())?
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub(crate) fn migration_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LegacyMigrationStatus, AppError> {
    #[cfg(desktop)]
    {
        get_legacy_migration_status(&app, state.inner())
    }

    #[cfg(not(desktop))]
    {
        let _ = (app, state);
        Ok(LegacyMigrationStatus::default())
    }
}

#[tauri::command]
pub(crate) fn migration_run(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LegacyMigrationResult, AppError> {
    #[cfg(desktop)]
    {
        run_legacy_store_data_migration(&app, state.inner())
    }

    #[cfg(not(desktop))]
    {
        let _ = (app, state);
        Err(AppError::Other("Legacy migration is only available on desktop".into()))
    }
}

#[tauri::command]
pub(crate) fn migration_probe_path(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<LegacyMigrationStatus, AppError> {
    #[cfg(desktop)]
    {
        get_legacy_migration_status_for_custom_path(&app, state.inner(), &path)
    }

    #[cfg(not(desktop))]
    {
        let _ = (app, state, path);
        Ok(LegacyMigrationStatus::default())
    }
}

#[tauri::command]
pub(crate) fn migration_run_with_path(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<LegacyMigrationResult, AppError> {
    #[cfg(desktop)]
    {
        run_legacy_store_data_migration_from_path(&app, state.inner(), &path)
    }

    #[cfg(not(desktop))]
    {
        let _ = (app, state, path);
        Err(AppError::Other("Legacy migration is only available on desktop".into()))
    }
}

#[tauri::command]
pub(crate) fn migration_read_legacy_data(dir: String) -> Result<Option<String>, AppError> {
    #[cfg(desktop)]
    {
        let base = std::path::Path::new(&dir);
        for name in ["data.json", "config.json"] {
            let p = base.join(name);
            if p.exists() {
                let content = std::fs::read_to_string(&p)?;
                return Ok(Some(content));
            }
        }
        Ok(None)
    }

    #[cfg(not(desktop))]
    {
        let _ = dir;
        Ok(None)
    }
}

#[tauri::command]
pub(crate) fn migration_write_legacy_data(dir: String, content: String) -> Result<(), AppError> {
    #[cfg(desktop)]
    {
        let base = std::path::Path::new(&dir);
        for name in ["data.json", "config.json"] {
            let p = base.join(name);
            if p.exists() {
                std::fs::write(&p, content)?;
                return Ok(());
            }
        }
        let p = base.join("data.json");
        std::fs::write(&p, content)?;
        Ok(())
    }

    #[cfg(not(desktop))]
    {
        let _ = (dir, content);
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn show_notification(app: AppHandle, title: String, body: String) -> Result<(), AppError> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub(crate) fn set_spellcheck(app: AppHandle, enabled: bool) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
            .emit("spellcheck-changed", json!({ "enabled": enabled }))
            .map_err(|e| AppError::Other(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn set_zoom(app: AppHandle, state: State<AppState>, level: f64) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.set_zoom(level).map_err(|e| AppError::Other(e.to_string()))?;
    }
    *state.ui.zoom_level.lock()? = level;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_zoom(state: State<AppState>) -> Result<f64, AppError> {
    Ok(*state.ui.zoom_level.lock()?)
}

#[tauri::command]
pub(crate) fn set_reduced_motion(
    app: AppHandle,
    state: State<AppState>,
    enabled: bool,
) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
            .emit("reduced-motion-changed", json!({ "enabled": enabled }))
            .map_err(|e| AppError::Other(e.to_string()))?;
    }
    *state.ui.reduced_motion.lock()? = enabled;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_reduced_motion(state: State<AppState>) -> Result<bool, AppError> {
    Ok(*state.ui.reduced_motion.lock()?)
}

#[tauri::command]
pub(crate) fn set_high_contrast(
    app: AppHandle,
    state: State<AppState>,
    enabled: bool,
) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
            .emit("high-contrast-changed", json!({ "enabled": enabled }))
            .map_err(|e| AppError::Other(e.to_string()))?;
    }
    *state.ui.high_contrast.lock()? = enabled;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_high_contrast(state: State<AppState>) -> Result<bool, AppError> {
    Ok(*state.ui.high_contrast.lock()?)
}

#[tauri::command]
pub(crate) fn change_menu_visibility(app: AppHandle, visible: bool) -> Result<(), AppError> {
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if visible {
            window.show_menu().map_err(|e| AppError::Other(e.to_string()))?;
        } else {
            window.hide_menu().map_err(|e| AppError::Other(e.to_string()))?;
        }
    }

    #[cfg(not(desktop))]
    let _ = (app, visible);

    Ok(())
}

#[tauri::command]
pub(crate) fn app_ready(app: AppHandle, state: State<AppState>) -> Result<(), AppError> {
    if let Some(banner) = state
        .updater
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?
        .pending_banner_data
        .clone()
    {
        app.emit_to(MAIN_WINDOW_LABEL, "update-banner", banner)
            .map_err(|e| AppError::Other(e.to_string()))?;
    }

    let queued = state.files.pending_open_files.lock()?.clone();
    for file_path in queued {
        app.emit_to(MAIN_WINDOW_LABEL, "file-opened", file_path)
            .map_err(|e| AppError::Other(e.to_string()))?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn helper_relaunch(app: AppHandle) -> Result<(), AppError> {
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
pub(crate) fn helper_get_path(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
) -> Result<String, AppError> {
    Ok(path_for_name(&app, state.inner(), &name)?
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub(crate) fn helper_is_dark_theme(app: AppHandle) -> Result<bool, AppError> {
    let theme = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .and_then(|window| window.theme().ok())
        .unwrap_or(Theme::Light);
    Ok(matches!(theme, Theme::Dark))
}

#[tauri::command]
pub(crate) fn show_edit_context_menu(app: AppHandle, x: f64, y: f64) -> Result<(), AppError> {
    #[cfg(desktop)]
    {
        let window = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| AppError::Other("Main window not found".into()))?;
        let menu = build_context_menu(&app)?;

        #[cfg(target_os = "linux")]
        {
            // x,y are screen-relative CSS pixels from JS (event.screenX/Y).
            // Tauri's popup_menu_at expects coordinates relative to the
            // window GdkWindow origin (includes CSD decorations).
            // We compute window-relative physical pixels by subtracting
            // the window's outer position from the screen cursor position.
            let window_pos = window.outer_position().map_err(|e| AppError::Other(e.to_string()))?;
            let dpr = window.scale_factor().map_err(|e| AppError::Other(e.to_string()))?;

            // screenX/Y are CSS pixels → multiply by DPR → subtract window origin in physical px
            let phys_x = (x * dpr) - window_pos.x as f64;
            let phys_y = (y * dpr) - window_pos.y as f64;

            return window
                .popup_menu_at(&menu, PhysicalPosition::new(phys_x as i32, phys_y as i32))
                .map_err(|e| AppError::Other(e.to_string()));
        }

        #[cfg(not(target_os = "linux"))]
        return window
            .popup_menu_at(&menu, tauri::LogicalPosition::new(x, y))
            .map_err(|e| AppError::Other(e.to_string()));
    }

    #[cfg(not(desktop))]
    let _ = (app, x, y);

    #[cfg(not(desktop))]
    {
        Ok(())
    }
}
