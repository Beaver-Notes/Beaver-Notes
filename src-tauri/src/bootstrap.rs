use std::{
    fs,
    path::{Path, PathBuf},
};

use http::StatusCode;

#[cfg(desktop)]
use serde_json::json;
use tauri::{App, AppHandle, Emitter, Manager, Wry};

#[cfg(desktop)]
use tauri::{PhysicalPosition, PhysicalSize, WindowEvent};

use crate::{commands, shared::*};

#[cfg(desktop)]
use crate::menu;

#[cfg(desktop)]
const WINDOW_STATE_KEY: &str = "windowStateMain";
#[cfg(desktop)]
const LEGACY_DATA_FILES: &[&str] = &["config.json", "data.json"];

pub(crate) fn queue_or_emit_file_open(app: &AppHandle, state: &AppState, path: String) {
    grant_trusted_path(state, Path::new(&path));
    if app
        .emit_to(MAIN_WINDOW_LABEL, "file-opened", path.clone())
        .is_err()
    {
        if let Ok(mut pending) = state.pending_open_files.lock() {
            pending.push(path);
        }
    }
}

fn bootstrap_file_open_from_argv(app: &AppHandle, state: &AppState) {
    for arg in std::env::args().skip(1) {
        if arg.ends_with(".bea") {
            queue_or_emit_file_open(app, state, arg);
        }
    }
}

pub(crate) fn focus_main_window(app: &AppHandle) {
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if window.is_minimized().unwrap_or(false) {
            let _ = window.unminimize();
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn load_window_state(app: &AppHandle, state: &AppState) -> Option<WindowStateSnapshot> {
    let pool = settings_pool(app, state).ok()?;
    let raw = crate::db::db_get(pool, WINDOW_STATE_KEY).ok()??;
    serde_json::from_str(&raw).ok()
}

#[cfg(desktop)]
fn save_window_state(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };

    let position = window.outer_position().map_err(to_error)?;
    let size = window.outer_size().map_err(to_error)?;
    let snapshot = WindowStateSnapshot {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: window.is_maximized().map_err(to_error)?,
    };

    let pool = settings_pool(app, state)?;
    let serialized = serde_json::to_string(&json!(snapshot)).map_err(to_error)?;
    crate::db::db_set(pool, WINDOW_STATE_KEY, &serialized)
}

#[cfg(desktop)]
fn restore_window_state(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let Some(snapshot) = load_window_state(app, state) else {
        return Ok(());
    };
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };

    if snapshot.width > 0 && snapshot.height > 0 {
        window
            .set_size(PhysicalSize::new(snapshot.width, snapshot.height))
            .map_err(to_error)?;
    }
    window
        .set_position(PhysicalPosition::new(snapshot.x, snapshot.y))
        .map_err(to_error)?;
    if snapshot.maximized {
        let _ = window.maximize();
    }
    Ok(())
}

pub(crate) fn legacy_store_dir(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        return app
            .path()
            .home_dir()
            .ok()
            .map(|home| home.join("Library/Application Support/Beaver Notes"));
    }

    #[cfg(target_os = "windows")]
    {
        return app
            .path()
            .app_data_dir()
            .ok()
            .and_then(|dir| dir.parent().map(|parent| parent.join("Beaver Notes")));
    }

    #[cfg(target_os = "linux")]
    {
        return app
            .path()
            .config_dir()
            .ok()
            .map(|config| config.join("Beaver Notes"));
    }

    #[allow(unreachable_code)]
    None
}

#[cfg(desktop)]
fn merge_json_preserving_target(target: &mut serde_json::Value, source: serde_json::Value) {
    match (target, source) {
        (serde_json::Value::Object(target_map), serde_json::Value::Object(source_map)) => {
            for (key, source_value) in source_map {
                if let Some(target_value) = target_map.get_mut(&key) {
                    merge_json_preserving_target(target_value, source_value);
                } else {
                    target_map.insert(key, source_value);
                }
            }
        }
        _ => {
            // Keep the current Tauri-side value. Migration must not overwrite newer data.
        }
    }
}

#[cfg(desktop)]
fn merge_store_file(source_path: &Path, target_path: &Path) -> Result<(), String> {
    if !source_path.exists() {
        return Ok(());
    }

    if !target_path.exists() {
        fs::copy(source_path, target_path).map_err(to_error)?;
        return Ok(());
    }

    let source_text = fs::read_to_string(source_path).map_err(to_error)?;
    let target_text = fs::read_to_string(target_path).map_err(to_error)?;
    let source_json = serde_json::from_str::<serde_json::Value>(&source_text).map_err(to_error)?;
    let mut target_json =
        serde_json::from_str::<serde_json::Value>(&target_text).map_err(to_error)?;

    merge_json_preserving_target(&mut target_json, source_json);

    let serialized = serde_json::to_string_pretty(&target_json).map_err(to_error)?;
    fs::write(target_path, format!("{serialized}\n")).map_err(to_error)
}

#[cfg(desktop)]
fn import_json_file_into_pool(path: &Path, pool: &crate::db::DbPool) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let text = fs::read_to_string(path).map_err(to_error)?;
    let json: serde_json::Value = serde_json::from_str(&text).map_err(to_error)?;
    let Some(map) = json.as_object() else {
        return Ok(false);
    };
    for (key, value) in map {
        if !crate::db::db_has(pool, key)? {
            crate::db::db_set(pool, key, &serde_json::to_string(value).map_err(to_error)?)?;
        }
    }
    Ok(true)
}

#[cfg(desktop)]
fn copy_directory_missing(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(to_error)?;

    for entry in fs::read_dir(source).map_err(to_error)? {
        let entry = entry.map_err(to_error)?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());

        if source_path.is_dir() {
            copy_directory_missing(&source_path, &target_path)?;
        } else if !target_path.exists() {
            fs::copy(&source_path, &target_path).map_err(to_error)?;
        }
    }

    Ok(())
}

#[cfg(desktop)]
fn copy_file_if_missing(source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() || target.exists() {
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(to_error)?;
    }

    fs::copy(source, target).map_err(to_error)?;
    Ok(())
}

#[cfg(desktop)]
fn import_legacy_auth_blobs(app: &AppHandle, auth_path: &Path) -> Result<(), String> {
    if !auth_path.exists() {
        return Ok(());
    }

    let auth_text = fs::read_to_string(auth_path).map_err(to_error)?;
    let auth_json = serde_json::from_str::<serde_json::Value>(&auth_text).map_err(to_error)?;
    let Some(auth_map) = auth_json.as_object() else {
        return Ok(());
    };

    let legacy_blob_map = auth_map.get("blobs").and_then(|value| value.as_object());

    for key in ALLOWED_BLOB_KEYS {
        let Some(blob) = auth_map
            .get(*key)
            .and_then(|value| value.as_str())
            .or_else(|| {
                legacy_blob_map
                    .and_then(|blob_map| blob_map.get(*key))
                    .and_then(|value| value.as_str())
            })
        else {
            continue;
        };

        let has_existing = stronghold_get_record(app, key)?
            .and_then(|value| String::from_utf8(value).ok())
            .filter(|value| !value.is_empty())
            .is_some()
            || keyring_entry(key)
                .ok()
                .and_then(|entry| entry.get_password().ok())
                .filter(|value| !value.is_empty())
                .is_some();

        if has_existing {
            continue;
        }

        let _ = stronghold_save_record(app, key, blob.as_bytes().to_vec());
        let _ = keyring_entry(key).and_then(|entry| entry.set_password(blob).map_err(to_error));
    }

    Ok(())
}

#[cfg(desktop)]
fn dir_has_any_legacy_content(path: &Path) -> bool {
    LEGACY_DATA_FILES
        .iter()
        .any(|name| path.join(name).exists())
        || [SETTINGS_STORE, AUTH_STORE]
            .iter()
            .any(|name| path.join(name).exists())
        || ["notes-assets", "file-assets"]
            .iter()
            .any(|name| path.join(name).exists())
}

#[cfg(desktop)]
pub(crate) fn get_legacy_migration_status(
    app: &AppHandle,
) -> Result<LegacyMigrationStatus, String> {
    let app_data_dir = app.path().app_data_dir().map_err(to_error)?;
    let marker = app_data_dir.join(".legacy-store-migrated");
    let legacy_dir = legacy_store_dir(app);
    let has_legacy_data = legacy_dir
        .as_ref()
        .map(|dir| dir.exists() && dir_has_any_legacy_content(dir))
        .unwrap_or(false);
    let target_has_data = dir_has_any_legacy_content(&app_data_dir);

    Ok(LegacyMigrationStatus {
        legacy_dir: legacy_dir.map(|path| path.to_string_lossy().to_string()),
        app_data_dir: Some(app_data_dir.to_string_lossy().to_string()),
        has_legacy_data,
        already_migrated: marker.exists(),
        target_has_data,
    })
}

#[cfg(desktop)]
pub(crate) fn run_legacy_store_data_migration(
    app: &AppHandle,
    state: &AppState,
) -> Result<LegacyMigrationResult, String> {
    let new_dir = app.path().app_data_dir().map_err(to_error)?;
    let old_dir = legacy_store_dir(app)
        .filter(|dir| dir.exists() && dir_has_any_legacy_content(dir))
        .ok_or_else(|| "No legacy Electron data found".to_string())?;
    let marker = new_dir.join(".legacy-store-migrated");

    fs::create_dir_all(&new_dir).map_err(to_error)?;

    let mut merged_store_files = Vec::new();
    let data_pool = data_pool(app, state)?;
    for legacy_name in LEGACY_DATA_FILES {
        let old = old_dir.join(legacy_name);
        if import_json_file_into_pool(&old, data_pool)? {
            merged_store_files.push((*legacy_name).to_string());
        }
    }

    let old_auth = old_dir.join(AUTH_STORE);
    if old_auth.exists() {
        merge_store_file(&old_auth, &new_dir.join(AUTH_STORE))?;
        merged_store_files.push(AUTH_STORE.to_string());
    }

    let settings_pool = settings_pool(app, state)?;
    let old_settings = old_dir.join(SETTINGS_STORE);
    if import_json_file_into_pool(&old_settings, settings_pool)? {
        merged_store_files.push(SETTINGS_STORE.to_string());
    }

    let mut copied_asset_dirs = Vec::new();
    for folder in ["notes-assets", "file-assets"] {
        let old = old_dir.join(folder);
        if old.exists() {
            copy_directory_missing(&old, &new_dir.join(folder))?;
            copied_asset_dirs.push(folder.to_string());
        }
    }

    let legacy_password_file = old_dir.join("password.enc");
    if legacy_password_file.exists() {
        let _ = copy_file_if_missing(&legacy_password_file, &new_dir.join("password.enc"));
    }

    let legacy_app_crypto_dir = old_dir.join("app-crypto");
    if legacy_app_crypto_dir.exists() {
        let _ = copy_directory_missing(&legacy_app_crypto_dir, &new_dir.join("app-crypto"));
    }

    let _ = import_legacy_auth_blobs(app, &old_dir.join(AUTH_STORE));

    // Intentionally non-destructive while migration is being tested.
    // Do not remove or mutate the legacy Electron directory here.
    // let _ = fs::remove_dir_all(&old_dir);

    fs::write(&marker, b"ok").map_err(to_error)?;

    Ok(LegacyMigrationResult {
        legacy_dir: Some(old_dir.to_string_lossy().to_string()),
        app_data_dir: Some(new_dir.to_string_lossy().to_string()),
        merged_store_files,
        copied_asset_dirs,
        marker_written: true,
    })
}

pub(crate) fn register_asset_protocols(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    builder
        .register_asynchronous_uri_scheme_protocol("assets", move |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = match resolve_asset_path_from_protocol_url(
                &app,
                request.uri().to_string().as_str(),
                "assets",
            ) {
                Ok(path) => path,
                Err(_) => {
                    responder.respond(protocol_response(
                        StatusCode::BAD_REQUEST,
                        Path::new("asset.bin"),
                        Vec::new(),
                    ));
                    return;
                }
            };
            let (asset_cache_dir, transient_passphrase) = {
                let state = app.state::<AppState>();
                let transient_passphrase = state
                    .transient_passphrase
                    .lock()
                    .ok()
                    .map(|value| value.clone())
                    .filter(|value| !value.is_empty());
                (state.asset_cache_dir.clone(), transient_passphrase)
            };
            std::thread::spawn(move || {
                let response = match cached_or_decrypted_asset(
                    &app,
                    &asset_cache_dir,
                    transient_passphrase.as_deref(),
                    &path,
                )
                .and_then(|resolved| {
                    fs::read(&resolved)
                        .map_err(to_error)
                        .map(|bytes| (resolved, bytes))
                }) {
                    Ok((resolved, bytes)) => protocol_response(StatusCode::OK, &resolved, bytes),
                    Err(_) => protocol_response(StatusCode::NOT_FOUND, &path, Vec::new()),
                };
                responder.respond(response);
            });
        })
        .register_asynchronous_uri_scheme_protocol("file-assets", move |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = match resolve_asset_path_from_protocol_url(
                &app,
                request.uri().to_string().as_str(),
                "file-assets",
            ) {
                Ok(path) => path,
                Err(_) => {
                    responder.respond(protocol_response(
                        StatusCode::BAD_REQUEST,
                        Path::new("asset.bin"),
                        Vec::new(),
                    ));
                    return;
                }
            };
            let (asset_cache_dir, transient_passphrase) = {
                let state = app.state::<AppState>();
                let transient_passphrase = state
                    .transient_passphrase
                    .lock()
                    .ok()
                    .map(|value| value.clone())
                    .filter(|value| !value.is_empty());
                (state.asset_cache_dir.clone(), transient_passphrase)
            };
            std::thread::spawn(move || {
                let response = match cached_or_decrypted_asset(
                    &app,
                    &asset_cache_dir,
                    transient_passphrase.as_deref(),
                    &path,
                )
                .and_then(|resolved| {
                    fs::read(&resolved)
                        .map_err(to_error)
                        .map(|bytes| (resolved, bytes))
                }) {
                    Ok((resolved, bytes)) => protocol_response(StatusCode::OK, &resolved, bytes),
                    Err(_) => protocol_response(StatusCode::NOT_FOUND, &path, Vec::new()),
                };
                responder.respond(response);
            });
        })
}

pub(crate) fn setup_app(app: &mut App<Wry>) -> Result<(), String> {
    let state = app.state::<AppState>();
    sync_roots_from_settings(app.handle(), state.inner());
    grant_trusted_path(&state, &app.path().app_data_dir().map_err(to_error)?);
    grant_trusted_path(&state, &app.path().temp_dir().map_err(to_error)?);
    fs::create_dir_all(&state.asset_cache_dir).map_err(to_error)?;
    *state.updater.lock().map_err(to_error)? = UpdaterState {
        auto_update_enabled: commands::updates::load_auto_update_enabled(app.handle())
            .unwrap_or(true),
        current_version: Some(app.package_info().version.to_string()),
        ..Default::default()
    };
    #[cfg(desktop)]
    {
        let menu = menu::build_app_menu(app.handle())?;
        app.set_menu(menu).map_err(to_error)?;
        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            restore_window_state(app.handle(), state.inner())?;
            let app_handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let WindowEvent::ThemeChanged(theme) = event {
                    let _ = app_handle.emit_to(
                        MAIN_WINDOW_LABEL,
                        "system-theme-changed",
                        json!({
                            "dark": matches!(theme, tauri::Theme::Dark)
                        }),
                    );
                }

                if matches!(
                    event,
                    WindowEvent::Moved(_)
                        | WindowEvent::Resized(_)
                        | WindowEvent::CloseRequested { .. }
                        | WindowEvent::Destroyed
                ) {
                    let state = app_handle.state::<AppState>();
                    let _ = save_window_state(&app_handle, state.inner());
                }
            });
            let _ = window.eval(
                r#"
            if (!window.__beaverContextMenuBound) {
              window.__beaverContextMenuBound = true;
              window.addEventListener('contextmenu', (event) => {
                const target = event.target;
                const editable = target && (
                  target.closest('[contenteditable="true"]') ||
                  ['INPUT', 'TEXTAREA'].includes(target.tagName)
                );
                if (!editable) return;
                event.preventDefault();
                if (window.__TAURI_INTERNALS__?.invoke) {
                  window.__TAURI_INTERNALS__.invoke('show_edit_context_menu');
                }
              });
            }
          "#,
            );
        }
    }
    bootstrap_file_open_from_argv(app.handle(), state.inner());
    Ok(())
}
