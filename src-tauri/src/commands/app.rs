use std::path::Path;

use serde_json::json;
#[allow(unused_imports)]
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
#[specta::specta]
pub(crate) fn app_info(app: AppHandle) -> Result<AppInfo, AppError> {
    Ok(AppInfo {
        name: app.package_info().name.clone(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
#[specta::specta]
pub(crate) fn app_directory(app: AppHandle, state: State<'_, AppState>) -> Result<String, AppError> {
    Ok(app_storage_dir(&app, state.inner())?
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub(crate) async fn migration_run(app: AppHandle) -> Result<LegacyMigrationResult, AppError> {
    #[cfg(desktop)]
    {
        // I/O + asset-encryption heavy; run on a blocking thread (state is
        // re-derived from the AppHandle — managed state is Send + Sync).
        let app = app.clone();
        tokio::task::spawn_blocking(move || {
            let state = app.state::<AppState>();
            run_legacy_store_data_migration(&app, state.inner())
        })
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
    }

    #[cfg(not(desktop))]
    {
        Err(AppError::Other("Legacy migration is only available on desktop".into()))
    }
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub(crate) async fn migration_run_with_path(
    app: AppHandle,
    path: String,
) -> Result<LegacyMigrationResult, AppError> {
    #[cfg(desktop)]
    {
        let app = app.clone();
        tokio::task::spawn_blocking(move || {
            let state = app.state::<AppState>();
            run_legacy_store_data_migration_from_path(&app, state.inner(), &path)
        })
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
    }

    #[cfg(not(desktop))]
    {
        Err(AppError::Other("Legacy migration is only available on desktop".into()))
    }
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
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

/// Prefix of a `file://`-origin localStorage key inside the LevelDB write log:
/// `_file://\0` origin marker plus a `\x01` flag byte (Chromium writes origin
/// and key as one string). Non-file origins are ignored.
const FILE_ORIGIN_PREFIX: &[u8] = b"_file://\0\x01";

/// LevelDB write-ahead log block size in bytes. Records never straddle blocks;
/// the writer zero-fills the tail of a block and resumes at the next boundary.
const LEVELDB_BLOCK_SIZE: usize = 32768;

fn next_wal_block_boundary(i: usize) -> usize {
    (i / LEVELDB_BLOCK_SIZE + 1) * LEVELDB_BLOCK_SIZE
}

/// Chromium stores each localStorage value as a serialized record starting
/// with a `\x01` marker; the string follows it.
const VALUE_MARKER: u8 = 0x01;

/// Parse a Chromium localStorage LevelDB write-ahead log into the final map of
/// `file://`-origin preference key/value pairs.
///
/// The log is a sequence of records framed by `checksum(4) | length(2, LE) |
/// type(1)` headers followed by `length` payload bytes. Each payload is a
/// LevelDB WriteBatch: `seq(8) | count(4, LE)` then `count` entries of the
/// form `type(1) | key_len(varint) | key | [value_len(varint) | value]`.
/// Entries with type 0 are deletions; everything else is a write. Keys for the
/// `file://` origin are `_file://\0\x01<preference>` and values are
/// `\x01<preference-value>`. `META:*`/non-file-origin entries are ignored.
/// Best-effort: malformed frames, truncated batches, and oversized counts are
/// skipped.
fn parse_localstorage_wal_bytes(data: &[u8]) -> serde_json::Map<String, serde_json::Value> {
    use serde_json::Map;
    let mut out = Map::new();
    let mut fragment: Vec<u8> = Vec::new();
    let mut i = 0usize;
    while i + 7 <= data.len() {
        // 7-byte record header; the checksum is not verified.
        let len = u16::from_le_bytes([data[i + 4], data[i + 5]]) as usize;
        let record_type = data[i + 6];
        let payload = &data[i + 7..];
        if len > payload.len() {
            // Truncated frame — partially-written final record. Skip to the next
            // block boundary so earlier records are kept; past EOF the loop ends.
            i = next_wal_block_boundary(i);
            continue;
        }
        match record_type {
            0 => {
                // kZeroType — writer pads the rest of the block; advance to the
                // boundary so the next block's first record is not desynced.
                i = next_wal_block_boundary(i);
                continue;
            }
            1 => parse_write_batch(&mut out, &payload[..len]),
            2 => {
                fragment.clear();
                fragment.extend_from_slice(&payload[..len]);
            }
            3 => fragment.extend_from_slice(&payload[..len]),
            4 => {
                fragment.extend_from_slice(&payload[..len]);
                parse_write_batch(&mut out, &fragment);
                fragment.clear();
            }
            _ => {}
        }
        i += 7 + len;
    }
    out
}

fn parse_write_batch(out: &mut serde_json::Map<String, serde_json::Value>, batch: &[u8]) {
    use serde_json::Value;
    if batch.len() < 12 {
        return;
    }
    let count = u32::from_le_bytes([batch[8], batch[9], batch[10], batch[11]]) as usize;
    if count > 100_000 {
        return;
    }
    let mut p = 12usize;
    for _ in 0..count {
        if p >= batch.len() {
            return;
        }
        let entry_type = batch[p];
        p += 1;
        let Some((key_len, key_start)) = wal_varint(batch, p) else { return };
        let key_end = key_start + key_len;
        if key_end > batch.len() {
            return;
        }
        let key = &batch[key_start..key_end];
        p = key_end;

        if entry_type == 0 {
            if let Some(name) = pref_name(key) {
                out.remove(name);
            }
            continue;
        }

        let Some((value_len, value_start)) = wal_varint(batch, key_end) else { return };
        let value_end = value_start + value_len;
        if value_end > batch.len() {
            return;
        }
        p = value_end;
        if let Some(name) = pref_name(key) {
            let raw = &batch[value_start..value_end];
            let bytes = raw.strip_prefix(&[VALUE_MARKER]).unwrap_or(raw);
            out.insert(
                name.to_owned(),
                Value::String(String::from_utf8_lossy(bytes).into_owned()),
            );
        }
    }
}

fn pref_name<'a>(key: &'a [u8]) -> Option<&'a str> {
    let name = key.strip_prefix(FILE_ORIGIN_PREFIX)?;
    Some(std::str::from_utf8(name).unwrap_or_default())
}

/// LevelDB varint: 7 bits per byte, LSB-first, high bit = more bytes.
/// Returns `(value, next_index)`.
fn wal_varint(data: &[u8], mut i: usize) -> Option<(usize, usize)> {
    let mut value = 0usize;
    let mut shift = 0u32;
    while i < data.len() {
        let byte = data[i];
        i += 1;
        value |= usize::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some((value, i));
        }
        shift += 7;
        if shift >= usize::BITS {
            return None;
        }
    }
    None
}

fn parse_localstorage_wal(log_path: &Path) -> Result<serde_json::Map<String, serde_json::Value>, AppError> {
    let data = std::fs::read(log_path).map_err(|e| AppError::Other(e.to_string()))?;
    Ok(parse_localstorage_wal_bytes(&data))
}

/// Scan every LevelDB write log under `<dir>/Local Storage/leveldb`, merging
/// the file-origin preferences they contain. Runs on a blocking thread.
#[cfg(desktop)]
fn read_legacy_preferences_blocking(dir: String) -> Result<serde_json::Value, AppError> {
    let base = std::path::PathBuf::from(&dir);
    let leveldb = base.join("Local Storage/leveldb");
    let mut prefs = serde_json::Map::new();
    if let Ok(entries) = std::fs::read_dir(&leveldb) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy().to_string();
            if !(name_str.ends_with(".log") || name_str.ends_with(".ldb")) {
                continue;
            }
            if let Ok(prefs_map) = parse_localstorage_wal(&entry.path()) {
                for (k, v) in prefs_map {
                    if v.as_str().map(|s| !s.is_empty()).unwrap_or(false) {
                        prefs.insert(k, v);
                    }
                }
            }
        }
    }
    Ok(serde_json::Value::Object(prefs))
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn migration_read_legacy_preferences(
    dir: String,
) -> Result<serde_json::Value, AppError> {
    #[cfg(desktop)]
    {
        // Directory scan + per-log parsing is I/O heavy; keep off the event loop.
        tokio::task::spawn_blocking(move || read_legacy_preferences_blocking(dir))
            .await
            .map_err(|e| AppError::Other(e.to_string()))?
    }

    #[cfg(not(desktop))]
    {
        let _ = dir;
        Ok(serde_json::Value::Object(serde_json::Map::new()))
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) fn show_notification(app: AppHandle, title: String, body: String) -> Result<(), AppError> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
#[specta::specta]
pub(crate) fn set_spellcheck(app: AppHandle, enabled: bool) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
            .emit("spellcheck-changed", json!({ "enabled": enabled }))
            .map_err(|e| AppError::Other(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn set_zoom(app: AppHandle, state: State<AppState>, level: f64) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.set_zoom(level).map_err(|e| AppError::Other(e.to_string()))?;
    }
    *state.ui.zoom_level.lock()? = level;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn get_zoom(state: State<AppState>) -> Result<f64, AppError> {
    Ok(*state.ui.zoom_level.lock()?)
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub(crate) fn get_reduced_motion(state: State<AppState>) -> Result<bool, AppError> {
    Ok(*state.ui.reduced_motion.lock()?)
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub(crate) fn get_high_contrast(state: State<AppState>) -> Result<bool, AppError> {
    Ok(*state.ui.high_contrast.lock()?)
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub(crate) fn update_menu(app: AppHandle, context: serde_json::Value) -> Result<(), AppError> {
    #[cfg(desktop)]
    {
        crate::menu::rebuild_menu(&app, &crate::menu::menu_context_from_value(&context))
    }

    #[cfg(not(desktop))]
    {
        let _ = (app, context);
        Ok(())
    }
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub(crate) fn helper_relaunch(app: AppHandle) -> Result<(), AppError> {
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub(crate) fn helper_is_dark_theme(app: AppHandle) -> Result<bool, AppError> {
    let theme = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .and_then(|window| window.theme().ok())
        .unwrap_or(Theme::Light);
    Ok(matches!(theme, Theme::Dark))
}

#[tauri::command]
#[specta::specta]
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
            // popup_menu_at expects window-relative physical pixels (GdkWindow
            // origin, incl. CSD decorations): multiply by DPR, subtract the
            // window's outer position.
            let window_pos = window.outer_position().map_err(|e| AppError::Other(e.to_string()))?;
            let dpr = window.scale_factor().map_err(|e| AppError::Other(e.to_string()))?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf, time::SystemTime};

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let ts = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock ok")
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{ts}-{}", std::process::id()))
    }

    /// Build one LevelDB log record (`checksum | length | type=full |
    /// WriteBatch`) mirroring Chromium's on-disk localStorage layout.
    fn build_record(entries: &[(bool, &[u8], &[u8])]) -> Vec<u8> {
        let mut batch = Vec::new();
        batch.extend_from_slice(&[0; 8]); // sequence number
        batch.extend_from_slice(&(entries.len() as u32).to_le_bytes());
        for (is_delete, key, value) in entries {
            batch.push(if *is_delete { 0 } else { 1 });
            batch.push(key.len() as u8);
            batch.extend_from_slice(key);
            if !is_delete {
                batch.push(value.len() as u8);
                batch.extend_from_slice(value);
            }
        }
        let mut record = Vec::new();
        record.extend_from_slice(&[0; 4]); // checksum (not verified)
        record.extend_from_slice(&(batch.len() as u16).to_le_bytes());
        record.push(1); // kFullType
        record.extend_from_slice(&batch);
        record
    }

    #[test]
    fn parses_chromium_localstorage_wal() {
        let root = unique_temp_dir("beaver-notes-ls");
        let _ = fs::create_dir_all(&root.join("Local Storage/leveldb"));
        let log = root.join("Local Storage/leveldb/000003.log");
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&build_record(&[
            (false, b"_file://\0\x01selected-font", b"\x01Arimo"),
            (false, b"_file://\0\x01theme", b"\x01dark"),
            (false, b"_file://\0\x01color-scheme", b"\x01light"),
            // Non-file origin (dev server) must be ignored.
            (false, b"_http://localhost:5173\0\x01zoomLevel", b"\x011"),
            // META record must be ignored.
            (false, b"META:file://", b"\x08\x00"),
        ]));
        bytes.extend_from_slice(&build_record(&[
            (true, b"_file://\0\x01theme", b""),
            (false, b"_file://\0\x01color-scheme", b"\x01pink"),
        ]));
        fs::write(&log, &bytes).expect("write wal");

        let result = parse_localstorage_wal(&log).expect("parse");
        assert_eq!(result.get("selected-font"), Some(&serde_json::Value::String("Arimo".into())));
        // Later write overrides the earlier one.
        assert_eq!(result.get("color-scheme"), Some(&serde_json::Value::String("pink".into())));
        // Deletion entry removes the key.
        assert!(result.get("theme").is_none());
        // Non-file:// origins and META records are ignored.
        assert!(result.get("zoomLevel").is_none());
        let _ = fs::remove_dir_all(&root);
    }

    /// WAL with a record in block 1, a type-0 record right before a block
    /// boundary, and a record in block 2.
    fn build_multi_block_wal() -> Vec<u8> {
        let block_size = super::LEVELDB_BLOCK_SIZE;
        let mut bytes = Vec::new();
        // Block 1: one real record, then zero-padding up to the boundary.
        bytes.extend_from_slice(&build_record(&[(
            false,
            b"_file://\0\x01first",
            b"\x01value-1",
        )]));
        while bytes.len() < block_size - 7 {
            bytes.push(0);
        }
        assert_eq!(bytes.len(), block_size - 7);
        // kZeroType record header: checksum(4) | length(2, LE)=0 | type(1)=0.
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.push(0);
        assert_eq!(bytes.len(), block_size);
        // Block 2: a second record, starting exactly at the boundary.
        bytes.extend_from_slice(&build_record(&[(
            false,
            b"_file://\0\x01second",
            b"\x01value-2",
        )]));
        bytes
    }

    #[test]
    fn parses_records_across_wal_block_boundaries() {
        let bytes = build_multi_block_wal();
        let result = parse_localstorage_wal_bytes(&bytes);
        // First record (block 1) is kept...
        assert_eq!(
            result.get("first"),
            Some(&serde_json::Value::String("value-1".into()))
        );
        // ...and the record in block 2 is not lost to the zero record.
        assert_eq!(
            result.get("second"),
            Some(&serde_json::Value::String("value-2".into()))
        );
    }

    #[test]
    fn keeps_records_before_truncated_final_record() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&build_record(&[(
            false,
            b"_file://\0\x01first",
            b"\x01value-1",
        )]));
        // A final record whose header claims a payload that was never written.
        bytes.extend_from_slice(&[0; 4]); // checksum
        bytes.extend_from_slice(&100u16.to_le_bytes()); // length = 100
        bytes.push(1); // kFullType
        bytes.extend_from_slice(b"short"); // only 5 payload bytes present

        let result = parse_localstorage_wal_bytes(&bytes);
        assert_eq!(
            result.get("first"),
            Some(&serde_json::Value::String("value-1".into()))
        );
    }
}
