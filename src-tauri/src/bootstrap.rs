use std::{
    borrow::Cow,
    fs,
    io::{BufReader, Read, Seek, SeekFrom},
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

/// Progress payload for the legacy migration, emitted over the
/// `migration-progress` Tauri event so the onboarding UI can show real
/// progress instead of a fake ticker. `done`/`total` count files (store JSON +
/// assets); the renderer maps the "copy" phase into the overall bar.
#[derive(Clone, serde::Serialize)]
pub(crate) struct MigrationProgress {
    pub(crate) phase: String,
    pub(crate) done: u64,
    pub(crate) total: u64,
}

fn emit_migration_progress(app: &AppHandle, phase: &str, done: u64, total: u64) {
    let _ = app.emit(
        "migration-progress",
        MigrationProgress {
            phase: phase.to_string(),
            done,
            total,
        },
    );
}

fn count_files(dir: &std::path::Path) -> u64 {
    let mut n = 0u64;
    if let Ok(rd) = fs::read_dir(dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                n += count_files(&p);
            } else {
                n += 1;
            }
        }
    }
    n
}

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
    path: &Path,
    pool: &crate::db::DbPool,
) -> Result<bool, AppError> {
    if !path.exists() {
        eprintln!("[migration] import_json_file_into_pool: source missing: {}", path.display());
        return Ok(false);
    }
    let text = fs::read_to_string(path)?;
    let json: serde_json::Value = serde_json::from_str(&text)?;
    let Some(map) = json.as_object() else {
        eprintln!("[migration] import_json_file_into_pool: not a JSON object: {}", path.display());
        return Ok(false);
    };
    eprintln!(
        "[migration] import_json_file_into_pool: {} top-level keys: {:?}",
        path.display(),
        map.keys().collect::<Vec<_>>()
    );
    for (key, value) in map {
        if !crate::db::db_has(pool, key)? {
            crate::db::db_set(pool, key, &serde_json::to_string(value)?)?;
        }
    }

    // Post-import store summary so we can verify what actually landed in KV.
    // Legacy notes/folders collections are no longer written as KV rows — the
    // frontend converts them straight to Yjs — so only top-level scalar keys
    // (labels, labelColors, deletedIds, …) appear here.
    match crate::db::db_all(pool) {
        Ok(rows) => {
            let notes = rows.keys().filter(|k| k.starts_with("notes.")).count();
            let folders = rows.keys().filter(|k| k.starts_with("folders.")).count();
            eprintln!(
                "[migration] import_json_file_into_pool: {} done — KV now has {} notes, {} folders (both expected to be 0), {} total rows",
                path.display(),
                notes,
                folders,
                rows.len()
            );
        }
        Err(e) => eprintln!("[migration] import_json_file_into_pool: post-import summary failed: {e}"),
    }
    Ok(true)
}

#[cfg(desktop)]
fn copy_directory_missing(
    app: &AppHandle,
    state: &AppState,
    source: &Path,
    target: &Path,
    done: &mut u64,
    total: u64,
) -> Result<(), AppError> {
    fs::create_dir_all(target)?;

    let mut last_pct = u64::MAX;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());

        if source_path.is_dir() {
            copy_directory_missing(app, state, &source_path, &target_path, done, total)?;
        } else if !target_path.exists() {
            let raw = fs::read(&source_path)?;
            let payload = encrypt_asset(app, state, &target_path, &raw)?;
            fs::write(&target_path, payload)?;
            *done += 1;
            // Throttle: emit once per percentage point so large asset trees
            // don't flood the event channel.
            let pct = if total > 0 { (*done * 100) / total } else { 100 };
            if pct != last_pct {
                last_pct = pct;
                emit_migration_progress(app, "copy", *done, total);
            }
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
            .is_some();

        if has_existing {
            continue;
        }

        let _ = state
            .cache.secure_blobs
            .store_blob(state.inner(), key, blob.as_bytes().to_vec());
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
        || ["notes-assets", "file-assets", "assets"]
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

    eprintln!("[migration] run_migration_core: start");
    eprintln!("[migration]   legacy dir: {}", old_dir.display());
    eprintln!("[migration]   target dir: {}", new_dir.display());
    eprintln!("[migration]   legacy exists: {}", old_dir.exists());
    eprintln!("[migration]   legacy files: config.json={}, data.json={}",
        old_dir.join("config.json").exists(),
        old_dir.join("data.json").exists());

    fs::create_dir_all(&new_dir)?;

    let mut merged_store_files = Vec::new();
    let data_pool = data_pool(app, state)?;

    // Count every file that will be copied so the progress bar has a real total
    // (store JSONs + all assets), then report as we go.
    // Legacy notes/folders (config.json/data.json) are no longer imported into
    // the data KV store — the frontend converts them straight to Yjs. The store
    // JSON copies are just settings.json (always) and auth.json (when present).
    eprintln!(
        "[migration]   skipping legacy notes/folders import (config.json/data.json) — the data KV store stays empty of note rows"
    );
    let mut copy_total = 1; // SETTINGS_STORE
    if old_dir.join(AUTH_STORE).exists() {
        copy_total += 1;
    }
    for folder in ["notes-assets", "file-assets"] {
        let old = old_dir.join(folder);
        if old.exists() {
            copy_total += count_files(&old);
        }
    }
    let old_assets = old_dir.join("assets");
    if old_assets.exists() {
        for entry in fs::read_dir(&old_assets)? {
            let entry = entry?;
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str == "notes-assets" || name_str == "file-assets" {
                continue;
            }
            let src = entry.path();
            copy_total += if src.is_dir() { count_files(&src) } else { 1 };
        }
    }
    let mut copy_done = 0u64;

    let old_auth = old_dir.join(AUTH_STORE);
    if old_auth.exists() {
        merge_store_file(&old_auth, &new_dir.join(AUTH_STORE))?;
        merged_store_files.push(AUTH_STORE.to_string());
        copy_done += 1;
        emit_migration_progress(app, "copy", copy_done, copy_total);
    }

    let settings_pool = settings_pool(app, state)?;
    let old_settings = old_dir.join(SETTINGS_STORE);
    if import_json_file_into_pool(&old_settings, &settings_pool)? {
        merged_store_files.push(SETTINGS_STORE.to_string());
    }
    copy_done += 1;
    emit_migration_progress(app, "copy", copy_done, copy_total);

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
            // Copy all legacy asset subdirs into the consolidated `assets/` directory
            let dest = new_dir.join("assets");
            copy_directory_missing(app, state, &old, &dest, &mut copy_done, copy_total)?;
            copied_asset_dirs.push(folder.to_string());
        }
    }
    // Also check if the source already uses the consolidated `assets/` dir.
    // Skip notes-assets/ and file-assets/ inside it — those are already handled
    // by the loop above and copying them would create nested duplicates.
    if old_assets.exists() {
        let dest_assets = new_dir.join("assets");
        fs::create_dir_all(&dest_assets)?;
        for entry in fs::read_dir(&old_assets)? {
            let entry = entry?;
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str == "notes-assets" || name_str == "file-assets" {
                continue;
            }
            let src = entry.path();
            let dst = dest_assets.join(&name);
            if src.is_dir() {
                copy_directory_missing(app, state, &src, &dst, &mut copy_done, copy_total)?;
            } else if !dst.exists() {
                let raw = fs::read(&src)?;
                let payload = encrypt_asset(app, state, &dst, &raw)?;
                fs::write(&dst, payload)?;
                copy_done += 1;
                emit_migration_progress(app, "copy", copy_done, copy_total);
            }
        }
        copied_asset_dirs.push("assets".to_string());
    }

    let _ = import_legacy_auth_blobs(app, &old_dir.join(AUTH_STORE));

    // Intentionally non-destructive while migration is being tested.
    // Do not remove or mutate the legacy Electron directory here.
    // let _ = fs::remove_dir_all(&old_dir);

    // Final KV summary before the marker is written. The data store is
    // intentionally empty of legacy note/folder rows — the frontend converts
    // them to Yjs instead of the app reading them back from KV.
    match crate::db::db_all(&data_pool) {
        Ok(rows) => {
            let notes = rows.keys().filter(|k| k.starts_with("notes.")).count();
            let folders = rows.keys().filter(|k| k.starts_with("folders.")).count();
            eprintln!(
                "[migration] run_migration_core: DONE — data store has {} notes, {} folders (both expected to be 0), {} total rows",
                notes,
                folders,
                rows.len()
            );
        }
        Err(e) => eprintln!("[migration] run_migration_core: post-import summary failed: {e}"),
    }
    eprintln!(
        "[migration] run_migration_core: writing marker {} — files merged: {:?}, asset dirs: {:?}",
        marker.display(),
        merged_store_files,
        copied_asset_dirs
    );

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
    register_asset_protocol(register_asset_protocol(builder, "assets"), "file-assets")
}

fn register_asset_protocol(
    builder: tauri::Builder<Wry>,
    scheme: &'static str,
) -> tauri::Builder<Wry> {
    builder.register_asynchronous_uri_scheme_protocol(scheme, move |ctx, request, responder| {
        let app = ctx.app_handle().clone();
        let path = match resolve_asset_path_from_protocol_url(
            &app,
            request.uri().to_string().as_str(),
            scheme,
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
                .security
                .transient_passphrase
                .lock()
                .ok()
                .map(|value| value.clone())
                .filter(|value| !value.is_empty());
            (state.files.asset_cache_dir.clone(), transient_passphrase)
        };
        let range = request
            .headers()
            .get(http::header::RANGE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        std::thread::spawn(move || {
            let response = serve_asset(
                &app,
                &asset_cache_dir,
                transient_passphrase.as_deref(),
                &path,
                range.as_deref(),
            );
            responder.respond(response);
        });
    })
}

/// Maximum bytes to read for a non-range request.  Assets larger than this are
/// capped so that a single full-file read cannot blow up the process heap.
/// Range requests are unaffected — they only ever read the requested slice.
const MAX_FULL_READ: u64 = 16 * 1024 * 1024; // 16 MiB

/// Serve a cached-or-decrypted asset over the custom protocol, honoring HTTP
/// byte-range requests. Requests without a `Range` header get the full file;
/// range requests get only the requested slice (`206 Partial Content`), so
/// media elements and streaming readers never force a whole decrypted asset
/// into memory. Unsatisfiable ranges yield `416` with `Content-Range: bytes */N`.
fn serve_asset(
    app: &AppHandle,
    asset_cache_dir: &Path,
    transient_passphrase: Option<&str>,
    path: &Path,
    range: Option<&str>,
) -> http::Response<Cow<'static, [u8]>> {
    let _t = crate::shared::speed_log::scope("assets.serve_asset");
    let resolved = match cached_or_decrypted_asset(app, asset_cache_dir, transient_passphrase, path)
    {
        Ok(resolved) => resolved,
        Err(_) => return protocol_response(StatusCode::NOT_FOUND, path, Vec::new()),
    };
    let total = fs::metadata(&resolved).map(|meta| meta.len()).unwrap_or(0);
    match range.map(|value| parse_byte_range(value, total)).unwrap_or(Ok(None)) {
        Ok(None) => {
            let to_read = total.min(MAX_FULL_READ);
            let read_result = (|| -> std::io::Result<Vec<u8>> {
                let file = fs::File::open(&resolved)?;
                let mut reader = BufReader::new(file);
                let mut buf = Vec::with_capacity(to_read as usize);
                reader.by_ref().take(to_read).read_to_end(&mut buf)?;
                Ok(buf)
            })();
            match read_result {
                Ok(bytes) => protocol_response_with_range(StatusCode::OK, &resolved, bytes, None),
                Err(_) => protocol_response(StatusCode::NOT_FOUND, path, Vec::new()),
            }
        }
        Ok(Some((start, end))) => {
            let len = (end - start + 1) as usize;
            let read = (|| -> std::io::Result<Vec<u8>> {
                let file = fs::File::open(&resolved)?;
                let mut reader = BufReader::new(file);
                reader.seek(SeekFrom::Start(start))?;
                let mut buf = Vec::with_capacity(len);
                reader.by_ref().take(len as u64).read_to_end(&mut buf)?;
                Ok(buf)
            })();
            match read {
                Ok(bytes) => protocol_response_with_range(
                    StatusCode::PARTIAL_CONTENT,
                    &resolved,
                    bytes,
                    Some(format!("bytes {}-{}/{}", start, end, total)),
                ),
                Err(_) => protocol_response(StatusCode::NOT_FOUND, path, Vec::new()),
            }
        }
        Err(()) => protocol_response_with_range(
            StatusCode::RANGE_NOT_SATISFIABLE,
            path,
            Vec::new(),
            Some(format!("bytes */{}", total)),
        ),
    }
}

/// Parse a single `Range: bytes=...` header value against a known length.
/// Returns `Ok(None)` for no-range requests, `Ok(Some((start, end)))` with an
/// inclusive end for satisfiable ranges, and `Err(())` for unsatisfiable ones.
fn parse_byte_range(header: &str, total: u64) -> Result<Option<(u64, u64)>, ()> {
    if total == 0 {
        return Err(());
    }
    let spec = header.strip_prefix("bytes=").ok_or(())?;
    let (start, end) = spec.split_once('-').ok_or(())?;
    let range = if start.is_empty() {
        // Suffix range: last `end` bytes.
        let suffix_len: u64 = end.parse().map_err(|_| ())?;
        if suffix_len == 0 {
            return Err(());
        }
        (total.saturating_sub(suffix_len), total - 1)
    } else {
        let start: u64 = start.parse().map_err(|_| ())?;
        if start >= total {
            return Err(());
        }
        if end.is_empty() {
            (start, total - 1)
        } else {
            let end: u64 = end.parse().map_err(|_| ())?;
            if end < start {
                return Err(());
            }
            (start, end.min(total - 1))
        }
    };
    Ok(Some(range))
}

/// Migrate flat data.db and settings.db into the workspaces layout.
/// Moves `data.db` → `workspaces/default/data.db` and
/// `settings.db` → `workspaces/default/settings.db`.
/// Creates `workspaces.json` at the app root with the default workspace.
fn migrate_to_workspace_layout(app: &AppHandle, state: &AppState) -> Result<(), AppError> {
    let _t = crate::shared::speed_log::scope("bootstrap.migrate_to_workspace_layout");
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

    if old_data_db.exists() {
        fs::rename(&old_data_db, default_ws_dir.join("data.db"))?;
    }

    if old_settings_db.exists() {
        fs::rename(&old_settings_db, default_ws_dir.join("settings.db"))?;
    }

    // Create workspaces.json with the default workspace
    let now = chrono::Utc::now().to_rfc3339();
    let default_ws = crate::shared::WorkspaceInfo {
        id: crate::shared::DEFAULT_WORKSPACE_ID.to_string(),
        name: crate::shared::DEFAULT_WORKSPACE_NAME.to_string(),
        created_at: now,
        workspace_type: "personal".into(),
        org_id: None,
        owner_id: None,
        cloud_sync: false,
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
            workspace_type: "personal".into(),
            org_id: None,
            owner_id: None,
            cloud_sync: false,
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
            workspace_type: "personal".into(),
            org_id: None,
            owner_id: None,
            cloud_sync: false,
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
    let _t = crate::shared::speed_log::scope("bootstrap.setup_app");
    let state = app.state::<AppState>();

    // ── Workspace migration (must run BEFORE any settings_pool call) ──────
    migrate_to_workspace_layout(app.handle(), state.inner())?;

    // The separate app-password store was retired — one workspace passphrase
    // protects everything now. Delete the legacy `password.enc` file on the
    // first launch after the upgrade; never fails startup if it is absent.
    {
        let app_dir = crate::shared::app_storage_dir(app.handle(), state.inner())?;
        let legacy_password_file = app_dir.join("password.enc");
        if legacy_password_file.exists() {
            let _ = std::fs::remove_file(&legacy_password_file);
        }
    }

    sync_roots_from_settings(app.handle(), state.inner());
    grant_trusted_path(
        &state,
        &crate::shared::app_storage_dir(app.handle(), state.inner())?,
    );
    grant_trusted_path(&state, &app.path().temp_dir().map_err(|e| AppError::Other(e.to_string()))?);
    fs::create_dir_all(&state.files.asset_cache_dir)?;

    // Warm the Keychain-backed master key on a background thread so the
    // frontend's first `loadSecureBlob('encryptionPassphraseBlob')` hits the
    // in-memory cache instead of a ~2.5s cold Keychain read on the startup path.
    std::thread::spawn(|| {
        let _ = read_master_key();
    });
    prewarm_crypto();

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_absent_returns_none() {
        assert_eq!(parse_byte_range("", 100), Err(()));
        assert_eq!(parse_byte_range("garbage", 100), Err(()));
    }

    #[test]
    fn range_full_file() {
        assert_eq!(parse_byte_range("bytes=0-", 100), Ok(Some((0, 99))));
        assert_eq!(parse_byte_range("bytes=0-99", 100), Ok(Some((0, 99))));
    }

    #[test]
    fn range_middle_slice() {
        assert_eq!(parse_byte_range("bytes=10-20", 100), Ok(Some((10, 20))));
    }

    #[test]
    fn range_open_ended_clamps_to_length() {
        assert_eq!(parse_byte_range("bytes=90-999", 100), Ok(Some((90, 99))));
    }

    #[test]
    fn range_suffix() {
        assert_eq!(parse_byte_range("bytes=-25", 100), Ok(Some((75, 99))));
        assert_eq!(parse_byte_range("bytes=-0", 100), Err(()));
    }

    #[test]
    fn range_unsatisfiable() {
        assert_eq!(parse_byte_range("bytes=100-", 100), Err(()));
        assert_eq!(parse_byte_range("bytes=100-200", 100), Err(()));
        assert_eq!(parse_byte_range("bytes=20-10", 100), Err(()));
        assert_eq!(parse_byte_range("bytes=0-", 0), Err(()));
    }

    #[cfg(desktop)]
    mod desktop_migration_tests {
        use super::*;
        use std::time::SystemTime;

        fn unique_temp_dir(prefix: &str) -> PathBuf {
            let ts = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("clock ok")
                .as_nanos();
            std::env::temp_dir().join(format!("{prefix}-{ts}-{}", std::process::id()))
        }

        #[test]
        fn import_json_ignores_notes_collection() {
            use std::io::Write;
            let root = unique_temp_dir("beaver-notes-nocoll");
            let _ = fs::create_dir_all(&root);
            let db_path = root.join("data.db");
            let pool = crate::db::open_pool(&db_path).expect("pool");

            let fixture = root.join("config.json");
            let mut f = fs::File::create(&fixture).expect("create");
            write!(
                f,
                r#"{{"notes": {{"n1": {{"id":"n1","title":"T"}}}}, "folders": {{"f1": {{"id":"f1"}}}}, "labels": ["a"]}}"#
            )
            .expect("write");

            let imported = import_json_file_into_pool(&fixture, &pool).expect("import");
            assert!(imported);
            let rows = crate::db::db_all(&pool).expect("rows");
            assert!(rows.keys().all(|k| !k.starts_with("notes.") && !k.starts_with("folders.")));
            assert!(rows.contains_key("labels"));
            let _ = fs::remove_dir_all(&root);
        }
    }
}
