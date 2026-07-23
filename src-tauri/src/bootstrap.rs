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

#[cfg(desktop)]
const COLLECTION_NAMESPACES: &[&str] = &["notes", "folders"];

pub(crate) fn queue_or_emit_file_open(app: &AppHandle, state: &AppState, path: String) {
    grant_trusted_path(state, Path::new(&path));
    if app
        .emit_to(MAIN_WINDOW_LABEL, "file-opened", path.clone())
        .is_err()
    {
        if let Ok(mut pending) = state.files.pending_open_files.lock() {
            pending.push(path);
        }
    }
}

fn bootstrap_file_open_from_argv(app: &AppHandle, state: &AppState) {
    for arg in std::env::args().skip(1) {
        let lower = arg.to_lowercase();
        if lower.ends_with(".bea")
            || lower.ends_with(".md")
            || lower.ends_with(".mdx")
            || lower.ends_with(".txt")
            || lower.ends_with(".html")
        {
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
    let raw = crate::db::db_get(&pool, WINDOW_STATE_KEY).ok()??;
    serde_json::from_str(&raw).ok()
}

#[cfg(desktop)]
fn save_window_state(app: &AppHandle, state: &AppState) -> Result<(), AppError> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };

    let position = window.outer_position().map_err(|e| AppError::Other(e.to_string()))?;
    let size = window.outer_size().map_err(|e| AppError::Other(e.to_string()))?;
    let snapshot = WindowStateSnapshot {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: window.is_maximized().map_err(|e| AppError::Other(e.to_string()))?,
    };

    let pool = settings_pool(app, state)?;
    let serialized = serde_json::to_string(&json!(snapshot))?;
    crate::db::db_set(&pool, WINDOW_STATE_KEY, &serialized)?;
    Ok(())
}

#[cfg(desktop)]
fn restore_window_state(app: &AppHandle, state: &AppState) -> Result<(), AppError> {
    let Some(snapshot) = load_window_state(app, state) else {
        return Ok(());
    };
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };

    if snapshot.width > 0 && snapshot.height > 0 {
        window
            .set_size(PhysicalSize::new(snapshot.width, snapshot.height))
            .map_err(|e| AppError::Other(e.to_string()))?;
    }
    window
        .set_position(PhysicalPosition::new(snapshot.x, snapshot.y))
        .map_err(|e| AppError::Other(e.to_string()))?;
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
        const LEGACY_FLATPAK_ID: &str = "com.beavernotes.beavernotes";
        if let Some(home) = app.path().home_dir().ok() {
            let flatpak_path = home
                .join(".var/app")
                .join(LEGACY_FLATPAK_ID)
                .join("config/Beaver Notes");
            if flatpak_path.exists() {
                return Some(flatpak_path);
            }
        }

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
fn merge_store_file(source_path: &Path, target_path: &Path) -> Result<(), AppError> {
    if !source_path.exists() {
        return Ok(());
    }

    if !target_path.exists() {
        fs::copy(source_path, target_path)?;
        return Ok(());
    }

    let source_text = fs::read_to_string(source_path)?;
    let target_text = fs::read_to_string(target_path)?;
    let source_json = serde_json::from_str::<serde_json::Value>(&source_text)?;
    let mut target_json =
        serde_json::from_str::<serde_json::Value>(&target_text)?;

    merge_json_preserving_target(&mut target_json, source_json);

    let serialized = serde_json::to_string_pretty(&target_json)?;
    fs::write(target_path, format!("{serialized}\n"))?;
    Ok(())
}

#[cfg(desktop)]
fn import_json_file_into_pool(
    state: &AppState,
    path: &Path,
    pool: &crate::db::DbPool,
) -> Result<bool, AppError> {
    if !path.exists() {
        return Ok(false);
    }
    let text = fs::read_to_string(path)?;
    let json: serde_json::Value = serde_json::from_str(&text)?;
    let Some(map) = json.as_object() else {
        return Ok(false);
    };
    let encrypt = state.crypto.session.read()?.active;
    for (key, value) in map {
        if COLLECTION_NAMESPACES.contains(&key.as_str()) {
            if let Some(items) = value.as_object() {
                for (id, item) in items {
                    let flat_key = format!("{}.{}", key, id);
                    if !crate::db::db_has(pool, &flat_key)? {
                        let row = if encrypt {
                            crate::shared::encrypt_note_row_for_storage(
                                state,
                                &flat_key,
                                item.clone(),
                            )?
                        } else {
                            item.clone()
                        };
                        crate::db::db_set(
                            pool,
                            &flat_key,
                            &serde_json::to_string(&row)?,
                        )?;
                    }
                }
                continue;
            }
        }
        if !crate::db::db_has(pool, key)? {
            crate::db::db_set(pool, key, &serde_json::to_string(value)?)?;
        }
    }
    Ok(true)
}

#[cfg(desktop)]
fn copy_directory_missing(source: &Path, target: &Path) -> Result<(), AppError> {
    fs::create_dir_all(target)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());

        if source_path.is_dir() {
            copy_directory_missing(&source_path, &target_path)?;
        } else if !target_path.exists() {
            fs::copy(&source_path, &target_path)?;
        }
    }

    Ok(())
}

#[cfg(desktop)]
fn import_legacy_auth_blobs(app: &AppHandle, auth_path: &Path) -> Result<(), AppError> {
    if !auth_path.exists() {
        return Ok(());
    }

    let auth_text = fs::read_to_string(auth_path)?;
    let auth_json = serde_json::from_str::<serde_json::Value>(&auth_text)?;
    let Some(auth_map) = auth_json.as_object() else {
        return Ok(());
    };

    let legacy_blob_map = auth_map.get("blobs").and_then(|value| value.as_object());

    let state = app.state::<AppState>();
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

        let has_existing = state
            .cache.secure_blobs
            .fetch_blob(state.inner(), key)
            .ok()
            .flatten()
            .and_then(|value| String::from_utf8(value).ok())
            .filter(|value: &String| !value.is_empty())
            .is_some()
            || keyring_entry(key)
                .ok()
                .and_then(|entry| entry.get_password().ok())
                .filter(|value: &String| !value.is_empty())
                .is_some();

        if has_existing {
            continue;
        }

        let _ = state
            .cache.secure_blobs
            .store_blob(state.inner(), key, blob.as_bytes().to_vec());
        let _ = keyring_entry(key).and_then(|entry| entry.set_password(blob).map_err(|e| AppError::Other(e.to_string())));
    }

    Ok(())
}

#[cfg(desktop)]
pub(crate) fn dir_has_any_legacy_content(path: &Path) -> bool {
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
    state: &AppState,
) -> Result<LegacyMigrationStatus, AppError> {
    let app_dir = crate::shared::app_storage_dir(app, state)?;
    let marker = app_dir.join(".legacy-store-migrated");
    let legacy_dir = legacy_store_dir(app);
    let has_legacy_data = legacy_dir
        .as_ref()
        .map(|dir| dir.exists() && dir_has_any_legacy_content(dir))
        .unwrap_or(false);
    let target_has_data = dir_has_any_legacy_content(&app_dir);

    Ok(LegacyMigrationStatus {
        legacy_dir: legacy_dir.map(|path| path.to_string_lossy().to_string()),
        app_dir: Some(app_dir.to_string_lossy().to_string()),
        has_legacy_data,
        already_migrated: marker.exists(),
        target_has_data,
    })
}

#[cfg(desktop)]
fn run_migration_core(
    app: &AppHandle,
    state: &AppState,
    old_dir: PathBuf,
) -> Result<LegacyMigrationResult, AppError> {
    let new_dir = crate::shared::app_storage_dir(app, state)?;
    let marker = new_dir.join(".legacy-store-migrated");

    fs::create_dir_all(&new_dir)?;

    let mut merged_store_files = Vec::new();
    let data_pool = data_pool(app, state)?;
    for legacy_name in LEGACY_DATA_FILES {
        let old = old_dir.join(legacy_name);
        if import_json_file_into_pool(state, &old, &data_pool)? {
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
    if import_json_file_into_pool(state, &old_settings, &settings_pool)? {
        merged_store_files.push(SETTINGS_STORE.to_string());
    }

    const SETTINGS_KEY_REMAP: &[(&str, &str)] = &[
        ("color-scheme", "colorScheme"),
        ("selected-font", "selectedFont"),
        ("selected-font-code", "selectedCodeFont"),
        ("selected-dark-text", "selectedDarkText"),
        ("visibility-menubar", "visibilityMenubar"),
        ("advanced-settings", "advancedSettings"),
    ];
    for (old_key, new_key) in SETTINGS_KEY_REMAP {
        if crate::db::db_has(&settings_pool, new_key)? {
            continue; // canonical key already present – don't overwrite
        }
        if let Some(value) = crate::db::db_get(&settings_pool, old_key)? {
            crate::db::db_set(&settings_pool, new_key, &value)?;
        }
    }

    let mut copied_asset_dirs = Vec::new();
    for folder in ["notes-assets", "file-assets"] {
        let old = old_dir.join(folder);
        if old.exists() {
            copy_directory_missing(&old, &new_dir.join(folder))?;
            copied_asset_dirs.push(folder.to_string());
        }
    }

    let _ = import_legacy_auth_blobs(app, &old_dir.join(AUTH_STORE));

    // Intentionally non-destructive while migration is being tested.
    // Do not remove or mutate the legacy Electron directory here.
    // let _ = fs::remove_dir_all(&old_dir);

    fs::write(&marker, b"ok")?;

    Ok(LegacyMigrationResult {
        legacy_dir: Some(old_dir.to_string_lossy().to_string()),
        app_dir: Some(new_dir.to_string_lossy().to_string()),
        merged_store_files,
        copied_asset_dirs,
        marker_written: true,
    })
}

#[cfg(desktop)]
pub(crate) fn run_legacy_store_data_migration(
    app: &AppHandle,
    state: &AppState,
) -> Result<LegacyMigrationResult, AppError> {
    let old_dir = legacy_store_dir(app)
        .filter(|dir| dir.exists() && dir_has_any_legacy_content(dir))
        .ok_or_else(|| AppError::Other("No legacy Electron data found".into()))?;
    run_migration_core(app, state, old_dir)
}

#[cfg(desktop)]
pub(crate) fn get_legacy_migration_status_for_custom_path(
    app: &AppHandle,
    state: &AppState,
    path: &str,
) -> Result<LegacyMigrationStatus, AppError> {
    let legacy_path = PathBuf::from(path);
    let app_dir = crate::shared::app_storage_dir(app, state)?;
    let marker = app_dir.join(".legacy-store-migrated");
    let has_legacy_data = legacy_path.exists() && dir_has_any_legacy_content(&legacy_path);
    let target_has_data = dir_has_any_legacy_content(&app_dir);
    Ok(LegacyMigrationStatus {
        legacy_dir: Some(path.to_string()),
        app_dir: Some(app_dir.to_string_lossy().to_string()),
        has_legacy_data,
        already_migrated: marker.exists(),
        target_has_data,
    })
}

#[cfg(desktop)]
pub(crate) fn run_legacy_store_data_migration_from_path(
    app: &AppHandle,
    state: &AppState,
    path: &str,
) -> Result<LegacyMigrationResult, AppError> {
    let old_dir = PathBuf::from(path);
    if !old_dir.exists() || !dir_has_any_legacy_content(&old_dir) {
        return Err(AppError::Other(format!(
            "No recognisable Beaver Notes data found at: {}",
            path
        )));
    }
    run_migration_core(app, state, old_dir)
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
                    .security.transient_passphrase
                    .lock()
                    .ok()
                    .map(|value| value.clone())
                    .filter(|value| !value.is_empty());
                (state.files.asset_cache_dir.clone(), transient_passphrase)
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
                        .map_err(|e| AppError::Other(e.to_string()))
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
                    .security.transient_passphrase
                    .lock()
                    .ok()
                    .map(|value| value.clone())
                    .filter(|value| !value.is_empty());
                (state.files.asset_cache_dir.clone(), transient_passphrase)
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
                        .map_err(|e| AppError::Other(e.to_string()))
                        .map(|bytes| (resolved, bytes))
                }) {
                    Ok((resolved, bytes)) => protocol_response(StatusCode::OK, &resolved, bytes),
                    Err(_) => protocol_response(StatusCode::NOT_FOUND, &path, Vec::new()),
                };
                responder.respond(response);
            });
        })
}

/// Migrate flat data.db and settings.db into the workspaces layout.
/// Moves `data.db` → `workspaces/default/data.db` and
/// `settings.db` → `workspaces/default/settings.db`.
/// Creates `workspaces.json` at the app root with the default workspace.
fn migrate_to_workspace_layout(app: &AppHandle, state: &AppState) -> Result<(), AppError> {
    let app_dir = crate::shared::app_storage_dir(app, state)?;
    let ws_root = app_dir.join(crate::shared::WORKSPACES_DIR);
    let marker = app_dir.join(".workspace-migrated");

    // Already migrated — just ensure default workspace is registered
    if marker.exists() || ws_root.exists() {
        ensure_default_workspace_in_registry(app, state)?;
        return Ok(());
    }

    let old_data_db = app_dir.join("data.db");
    let old_settings_db = app_dir.join("settings.db");
    let default_ws_dir = ws_root.join(crate::shared::DEFAULT_WORKSPACE_ID);

    fs::create_dir_all(&default_ws_dir)?;

    // Move existing data.db into the default workspace
    if old_data_db.exists() {
        fs::rename(&old_data_db, default_ws_dir.join("data.db"))?;
    }

    // Move existing settings.db into the default workspace
    if old_settings_db.exists() {
        fs::rename(&old_settings_db, default_ws_dir.join("settings.db"))?;
    }

    // Create workspaces.json with the default workspace
    let now = chrono::Utc::now().to_rfc3339();
    let default_ws = crate::shared::WorkspaceInfo {
        id: crate::shared::DEFAULT_WORKSPACE_ID.to_string(),
        name: crate::shared::DEFAULT_WORKSPACE_NAME.to_string(),
        created_at: now,
    };
    let registry_json = serde_json::json!({
        "activeWorkspace": crate::shared::DEFAULT_WORKSPACE_ID,
        "workspaces": [default_ws],
    });
    let json_path = crate::shared::workspaces_json_path(app, state)?;
    let pretty = serde_json::to_string_pretty(&registry_json)?;
    fs::write(&json_path, format!("{pretty}\n"))?;

    fs::write(&marker, b"ok")?;
    Ok(())
}

/// Ensure the default workspace entry exists in workspaces.json.
fn ensure_default_workspace_in_registry(
    app: &AppHandle,
    state: &AppState,
) -> Result<(), AppError> {
    let json_path = crate::shared::workspaces_json_path(app, state)?;
    let has_json = json_path.exists();

    if !has_json {
        // No workspaces.json yet — create one with default
        let now = chrono::Utc::now().to_rfc3339();
        let default_ws = crate::shared::WorkspaceInfo {
            id: crate::shared::DEFAULT_WORKSPACE_ID.to_string(),
            name: crate::shared::DEFAULT_WORKSPACE_NAME.to_string(),
            created_at: now,
        };
        let registry_json = serde_json::json!({
            "activeWorkspace": crate::shared::DEFAULT_WORKSPACE_ID,
            "workspaces": [default_ws],
        });
        let pretty = serde_json::to_string_pretty(&registry_json)?;
        fs::write(&json_path, format!("{pretty}\n"))?;
        return Ok(());
    }

    // Check if default workspace is registered
    let registry = crate::shared::load_workspace_registry(app, state)?;
    if !registry.iter().any(|w| w.id == crate::shared::DEFAULT_WORKSPACE_ID) {
        let now = chrono::Utc::now().to_rfc3339();
        let default_ws = crate::shared::WorkspaceInfo {
            id: crate::shared::DEFAULT_WORKSPACE_ID.to_string(),
            name: crate::shared::DEFAULT_WORKSPACE_NAME.to_string(),
            created_at: now,
        };
        let mut new_registry = registry;
        new_registry.push(default_ws);
        crate::shared::save_workspace_registry(app, state, &new_registry)?;
        crate::shared::save_active_workspace_id(
            app,
            state,
            crate::shared::DEFAULT_WORKSPACE_ID,
        )?;
    }
    Ok(())
}

pub(crate) fn setup_app(app: &mut App<Wry>) -> Result<(), AppError> {
    let state = app.state::<AppState>();

    // ── Workspace migration (must run BEFORE any settings_pool call) ──────
    migrate_to_workspace_layout(app.handle(), state.inner())?;

    sync_roots_from_settings(app.handle(), state.inner());
    grant_trusted_path(
        &state,
        &crate::shared::app_storage_dir(app.handle(), state.inner())?,
    );
    grant_trusted_path(&state, &app.path().temp_dir().map_err(|e| AppError::Other(e.to_string()))?);
    fs::create_dir_all(&state.files.asset_cache_dir)?;

    *state.updater.lock().map_err(|e| AppError::Other(e.to_string()))? = UpdaterState {
        auto_update_enabled: commands::updates::load_auto_update_enabled(app.handle())
            .unwrap_or(true),
        current_version: Some(app.package_info().version.to_string()),
        ..Default::default()
    };
    #[cfg(desktop)]
    {
        let menu = menu::build_app_menu(app.handle())?;
        app.set_menu(menu).map_err(|e| AppError::Other(e.to_string()))?;
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
                  window.__TAURI_INTERNALS__.invoke('show_edit_context_menu', {
                    x: event.screenX,
                    y: event.screenY,
                  });
                }
              });
            }
          "#,
            );
        }
    }
    bootstrap_file_open_from_argv(app.handle(), state.inner());
    if let Ok(manifest_path) = app_encryption_manifest_path(app.handle(), state.inner()) {
        let mut s = state.inner().crypto.session.write()?;
        s.active = manifest_path.exists();
    }
    Ok(())
}
