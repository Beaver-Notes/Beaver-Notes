use serde_json::{Map, Value};
use tauri::{AppHandle, State};

use crate::shared::{RawJson, *};

fn key_segments(key: &str) -> Vec<&str> {
    key.split('.')
        .filter(|segment| !segment.is_empty())
        .collect()
}

// Nested-value helpers

fn get_nested_value<'a>(value: &'a Value, segments: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for segment in segments {
        current = current.as_object()?.get(*segment)?;
    }
    Some(current)
}

fn set_nested_value(current: &mut Value, segments: &[&str], new_value: Value) {
    if segments.is_empty() {
        *current = new_value;
        return;
    }

    if !current.is_object() {
        *current = Value::Object(Map::new());
    }

    let mut node = current;
    for segment in &segments[..segments.len() - 1] {
        let object = node.as_object_mut().expect("object expected");
        node = object
            .entry((*segment).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if !node.is_object() {
            *node = Value::Object(Map::new());
        }
    }

    let object = node.as_object_mut().expect("object expected");
    object.insert(segments[segments.len() - 1].to_string(), new_value);
}

fn delete_nested_value(current: &mut Value, segments: &[&str]) -> bool {
    if segments.is_empty() {
        return false;
    }

    let Some(object) = current.as_object_mut() else {
        return false;
    };

    if segments.len() == 1 {
        return object.remove(segments[0]).is_some();
    }

    let segment = segments[0];
    let mut should_remove_child = false;
    let removed = if let Some(child) = object.get_mut(segment) {
        let removed = delete_nested_value(child, &segments[1..]);
        should_remove_child = matches!(child, Value::Object(map) if map.is_empty());
        removed
    } else {
        false
    };

    if should_remove_child {
        object.remove(segment);
    }

    removed
}

fn nested_store_value(entries: Map<String, Value>) -> Value {
    let mut root = Value::Object(Map::new());
    for (key, value) in entries {
        let segments = key_segments(&key);
        if segments.is_empty() {
            continue;
        }
        set_nested_value(&mut root, &segments, value);
    }
    root
}

fn flatten_store_value(root: Value) -> Map<String, Value> {
    let mut output = Map::new();
    let Value::Object(entries) = root else {
        return output;
    };

    for (key, value) in entries {
        // Collection namespaces live as individual flat rows: explode them.
        if COLLECTION_NAMESPACES.contains(&key.as_str()) {
            if let Value::Object(items) = value {
                for (id, item) in items {
                    output.insert(format!("{key}.{id}"), item);
                }
                continue;
            }
        }
        output.insert(key, value);
    }

    output
}

pub(crate) fn storage_aad(row_key: &str) -> String {
    format!("beaver-notes:data-store:{row_key}")
}

pub(crate) fn encrypt_store_row_with_key(
    row_key: &str,
    value: Value,
    key: &[u8; 32],
    key_id: &str,
) -> Result<Value, AppError> {
    let _t = crate::shared::speed_log::scope("storage.encrypt_store_row_with_key");
    let envelope = encrypt_json_for_storage(
        key,
        &value,
        &storage_aad(row_key),
        if key_id.is_empty() {
            None
        } else {
            Some(key_id)
        },
    )?;
    Ok(serde_json::to_value(envelope)?)
}

/// Core store-load logic, parameterised by key material so it is callable from
/// both sync (state-bearing) and async (`spawn_blocking`) paths.
fn load_store_root_inner(
    pool: &crate::db::DbPool,
    name: &str,
    app_key: &Option<[u8; 32]>,
    key_id: &str,
) -> Result<Value, AppError> {
    // Settings are always plaintext so boot can read onboardingCompleted before unlock.
    // Only data store is sealed with the content key.
    let is_data = name == DATA_STORE;
    let db_key = if is_data { *app_key } else { None };
    let flat = crate::db::db_all(pool, db_key)?;

    if name != DATA_STORE {
        return Ok(nested_store_value(flat));
    }

    let mut needs_migration = false;
    let mut plain = Map::new();
    let mut decrypted_ok = 0usize;
    let mut decrypted_failed = 0usize;

    for (row_key, value) in flat {
        let is_enveloped = matches!(
            value,
            Value::Object(ref map) if map.get("ae").and_then(Value::as_u64) == Some(4)
        );

        let decrypted = if let Some(ref key) = app_key {
            match decrypt_json_from_storage(key, &value, &storage_aad(&row_key)) {
                Ok(Some(dec)) => {
                    decrypted_ok += 1;
                    dec
                }
                Ok(None) => {
                    decrypted_failed += 1;
                    value.clone()
                }
                Err(e) => {
                    decrypted_failed += 1;
                    eprintln!(
                        "[storage] load_store_root_inner: decrypt failed for {row_key}: {e} — returning raw row"
                    );
                    value.clone()
                }
            }
        } else {
            value.clone()
        };

        if !is_enveloped {
            needs_migration = true;
        }

        plain.insert(row_key, decrypted);
    }

    if app_key.is_some() && name == DATA_STORE {
        eprintln!(
            "[storage] load_store_root_inner: store={name} rows={} decrypted_ok={} decrypted_failed={}",
            plain.len(),
            decrypted_ok,
            decrypted_failed
        );
    }

    if needs_migration && is_data {
        let mut encrypted = Map::new();
        for (row_key, value) in plain.clone() {
            if let Some(ref key) = app_key {
                encrypted.insert(
                    row_key.clone(),
                    encrypt_store_row_with_key(&row_key, value, key, key_id)?,
                );
            }
        }
        crate::db::db_replace_all(pool, encrypted, *app_key)?;
    }

    Ok(nested_store_value(plain))
}

fn pick_pool(name: &str, app: &AppHandle, state: &AppState) -> Result<crate::db::DbPool, AppError> {
    match allowed_store_name(name)? {
        SETTINGS_STORE => Ok(settings_pool(app, state)?),
        DATA_STORE => Ok(data_pool(app, state)?),
        _ => Err(AppError::Other(format!(
            r#"[storage] blocked access to unknown store: "{name}""#
        ))),
    }
}

// Flat-addressable key maps 1:1 to a KV row: single segment or notes.<id>/folders.<id>.
// Flat rows skip the whole-store load.

/// Collection namespaces whose entries are stored as individual flat rows
/// (e.g. "notes.abc123"). Requests for the bare key (`storage_get("notes")`)
/// fall through to `load_store_root` to see all rows reassembled.
const COLLECTION_NAMESPACES: &[&str] = &["notes", "folders"];

fn flat_db_key(segments: &[&str]) -> Option<String> {
    match segments {
        // Single non-collection key ("deletedIds", …) stored as-is; bare
        // collection keys ("notes", …) fall through to load_store_root.
        [key] if !COLLECTION_NAMESPACES.contains(key) => Some((*key).to_string()),
        // "notes.<id>", "folders.<id>" → flat rows
        ["notes", id] | ["folders", id] => Some(format!("{}.{}", segments[0], id)),
        _ => None,
    }
}

/// Decrypt one KV row with pre-extracted key material so the work runs inside
/// `spawn_blocking` without touching `AppState`. Plaintext passthrough when
/// the key is absent (mirrors `decrypt_store_row`).
fn decrypt_store_row_with_key(
    row_key: &str,
    value: Value,
    app_key: &Option<[u8; 32]>,
) -> Result<Value, AppError> {
    let _t = crate::shared::speed_log::scope("storage.decrypt_store_row");
    let Some(key) = app_key else {
        return Ok(value);
    };
    Ok(decrypt_json_from_storage(key, &value, &storage_aad(row_key))?.unwrap_or(value))
}

// Pure workers (state-free) for spawn_blocking: commands extract key material and pool first.
// SQLite I/O and per-row AES stay off the Tauri event loop.

/// One-time pass: whole-row-encrypt legacy notes.*/folders.* rows left with plaintext titles/metadata.
/// Idempotent, skips encrypted rows, handles mixed reads transparently.
pub(crate) fn reencrypt_legacy_store_rows(
    pool: crate::db::DbPool,
    key: [u8; 32],
    key_id: String,
) -> Result<usize, AppError> {
    let mut count = 0;
    for (row_key, value) in crate::db::db_all(&pool, Some(key))? {
        if !row_key.starts_with("notes.") && !row_key.starts_with("folders.") {
            continue;
        }
        if decrypt_json_from_storage(&key, &value, &storage_aad(&row_key))?.is_some() {
            continue;
        }
        let encrypted = encrypt_store_row_with_key(&row_key, value, &key, &key_id)?;
        crate::db::db_set(
            &pool,
            &row_key,
            &serde_json::to_string(&encrypted)?,
            Some(key),
        )?;
        count += 1;
    }
    Ok(count)
}

fn storage_get_value(
    pool: crate::db::DbPool,
    name: String,
    key: String,
    def: Value,
    app_key: Option<[u8; 32]>,
    key_id: String,
) -> Result<Value, AppError> {
    let segments = key_segments(&key);
    if segments.is_empty() {
        return Ok(def);
    }
    // Settings always plaintext: never seal/unseal with content key.
    let is_data = name == DATA_STORE;
    let db_key = if is_data { app_key } else { None };
    let decrypt_key = if is_data { app_key } else { None };

    if let Some(flat_key) = flat_db_key(&segments) {
        let raw = crate::db::db_get(&pool, &flat_key, db_key)?;
        let value = raw
            .and_then(|r| serde_json::from_str::<Value>(&r).ok())
            .map(|v| {
                if is_data {
                    decrypt_store_row_with_key(&flat_key, v, &decrypt_key).unwrap_or(Value::Null)
                } else {
                    v
                }
            })
            .unwrap_or(def);
        return Ok(value);
    }

    let root = load_store_root_inner(&pool, &name, &app_key, &key_id)?;
    Ok(get_nested_value(&root, &segments).cloned().unwrap_or(def))
}

fn storage_set_value(
    pool: crate::db::DbPool,
    name: String,
    key: String,
    value: Value,
    app_key: Option<[u8; 32]>,
    key_id: String,
) -> Result<(), AppError> {
    let segments = key_segments(&key);
    if segments.is_empty() {
        return Ok(());
    }
    let is_data = name == DATA_STORE;
    let db_key = if is_data { app_key } else { None };

    if let Some(flat_key) = flat_db_key(&segments) {
        let payload = if is_data {
            match &app_key {
                Some(k) => encrypt_store_row_with_key(&flat_key, value, k, &key_id)?,
                None => value,
            }
        } else {
            value
        };
        let serialized = serde_json::to_string(&payload)?;
        crate::db::db_set(&pool, &flat_key, &serialized, db_key)?;
        return Ok(());
    }

    let mut root = load_store_root_inner(&pool, &name, &app_key, &key_id)?;
    set_nested_value(&mut root, &segments, value);
    let mut flattened = flatten_store_value(root);
    if is_data {
        let mut encrypted = Map::new();
        for (row_key, value) in flattened {
            encrypted.insert(
                row_key.clone(),
                match &app_key {
                    Some(k) => encrypt_store_row_with_key(&row_key, value, k, &key_id)?,
                    None => value,
                },
            );
        }
        flattened = encrypted;
    }
    crate::db::db_replace_all(&pool, flattened, db_key)?;
    Ok(())
}

fn storage_delete_value(
    pool: crate::db::DbPool,
    name: String,
    key: String,
    app_key: Option<[u8; 32]>,
    key_id: String,
) -> Result<(), AppError> {
    let segments = key_segments(&key);
    if segments.is_empty() {
        return Ok(());
    }
    let is_data = name == DATA_STORE;
    let db_key = if is_data { app_key } else { None };

    if let Some(flat_key) = flat_db_key(&segments) {
        crate::db::db_delete(&pool, &flat_key)?;
        return Ok(());
    }

    let mut root = load_store_root_inner(&pool, &name, &app_key, &key_id)?;
    let _ = delete_nested_value(&mut root, &segments);
    let mut flattened = flatten_store_value(root);
    if is_data {
        let mut encrypted = Map::new();
        for (row_key, value) in flattened {
            encrypted.insert(
                row_key.clone(),
                match &app_key {
                    Some(k) => encrypt_store_row_with_key(&row_key, value, k, &key_id)?,
                    None => value,
                },
            );
        }
        flattened = encrypted;
    }
    crate::db::db_replace_all(&pool, flattened, db_key)?;
    Ok(())
}

fn storage_has_value(
    pool: crate::db::DbPool,
    name: String,
    key: String,
    app_key: Option<[u8; 32]>,
    key_id: String,
) -> Result<bool, AppError> {
    let segments = key_segments(&key);
    if segments.is_empty() {
        return Ok(false);
    }

    if let Some(flat_key) = flat_db_key(&segments) {
        return crate::db::db_has(&pool, &flat_key);
    }

    let root = load_store_root_inner(&pool, &name, &app_key, &key_id)?;
    Ok(get_nested_value(&root, &segments).is_some())
}

fn storage_replace_value(
    pool: crate::db::DbPool,
    name: String,
    data: Value,
    app_key: Option<[u8; 32]>,
    key_id: String,
) -> Result<(), AppError> {
    let is_data = name == DATA_STORE;
    let db_key = if is_data { app_key } else { None };
    let incoming = flatten_store_value(data);
    let existing = crate::db::db_all(&pool, db_key)?;

    let mut upserts = Map::new();
    let mut delete_keys: Vec<String> = Vec::new();

    if is_data {
        for (key, plain_value) in &incoming {
            let changed = match existing.get(key) {
                Some(existing_envelope) => {
                    let decrypted_existing = match &app_key {
                        Some(k) => {
                            decrypt_json_from_storage(k, existing_envelope, &storage_aad(key))?
                                .unwrap_or_else(|| existing_envelope.clone())
                        }
                        None => existing_envelope.clone(),
                    };
                    &decrypted_existing != plain_value
                }
                None => true,
            };
            if changed {
                if let Some(k) = &app_key {
                    upserts.insert(
                        key.clone(),
                        encrypt_store_row_with_key(key, plain_value.clone(), k, &key_id)?,
                    );
                }
            }
        }
    } else {
        for (key, value) in &incoming {
            let changed = match existing.get(key) {
                Some(existing_value) => existing_value != value,
                None => true,
            };
            if changed {
                upserts.insert(key.clone(), value.clone());
            }
        }
    }

    for key in existing.keys() {
        if !incoming.contains_key(key) {
            delete_keys.push(key.clone());
        }
    }

    if !upserts.is_empty() || !delete_keys.is_empty() {
        crate::db::db_apply_diff(&pool, &upserts, &delete_keys, db_key)?;
    }
    Ok(())
}

// Commands

/// Full store as nested JSON, only startup/sync (loads everything). Content not encrypted at KV layer.
/// Yjs blobs encrypted in note_content/yjs_snapshots. DB read plus decrypt on blocking thread.
#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_get_store(
    app: AppHandle,
    name: String,
    state: State<'_, AppState>,
) -> Result<RawJson, AppError> {
    let pool = pick_pool(&name, &app, &state)?;
    let app_key = current_app_key(state.inner())?;
    let key_id = state
        .inner()
        .crypto
        .session
        .read()
        .map_err(AppError::from)?
        .current_items_key_id
        .clone();
    let root =
        tokio::task::spawn_blocking(move || load_store_root_inner(&pool, &name, &app_key, &key_id))
            .await
            .map_err(|e| AppError::Other(e.to_string()))??;
    Ok(root.into())
}

/// Replace entire store (sync/import). Only changed rows re-encrypted and written, avoids AES-GCM and I/O. Blocking thread.
#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_replace(
    app: AppHandle,
    name: String,
    data: RawJson,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = pick_pool(&name, &app, &state)?;
    let is_settings = name == SETTINGS_STORE;
    let app_key = current_app_key(state.inner())?;
    let key_id = state
        .inner()
        .crypto
        .session
        .read()
        .map_err(AppError::from)?
        .current_items_key_id
        .clone();

    tokio::task::spawn_blocking(move || storage_replace_value(pool, name, data.0, app_key, key_id))
        .await
        .map_err(|e| AppError::Other(e.to_string()))??;

    if is_settings {
        invalidate_settings_cache(state.inner());
    }
    Ok(())
}

/// Get one value by dot-separated key: single-row lookup for flat keys, else full-store load (legacy).
/// Runs off main thread: collection fallback reads and decrypts entire KV table.
#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_get(
    app: AppHandle,
    name: String,
    key: String,
    def: RawJson,
    state: State<'_, AppState>,
) -> Result<RawJson, AppError> {
    let pool = pick_pool(&name, &app, &state)?;
    let app_key = current_app_key(state.inner())?;
    let key_id = state
        .inner()
        .crypto
        .session
        .read()
        .map_err(AppError::from)?
        .current_items_key_id
        .clone();

    let value = tokio::task::spawn_blocking(move || {
        storage_get_value(pool, name, key, def.0, app_key, key_id)
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))??;
    Ok(value.into())
}

/// Whole-row-encrypt legacy plaintext `notes.*` / `folders.*` rows.
/// Idempotent; call after the app key is loaded.
#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_reencrypt_legacy_rows(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    let pool = pick_pool(DATA_STORE, &app, &state)?;
    let app_key = current_app_key(state.inner())?
        .ok_or_else(|| AppError::Other("App encryption is locked.".into()))?;
    let key_id = state
        .inner()
        .crypto
        .session
        .read()
        .map_err(AppError::from)?
        .current_items_key_id
        .clone();

    tokio::task::spawn_blocking(move || reencrypt_legacy_store_rows(pool, app_key, key_id))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

/// One-time repair: settings.db rows that were sealed with the content key
/// (added by the kv-sealing refactor) are decrypted and rewritten plaintext
/// so boot can read `onboardingCompleted` before unlock. Idempotent.
pub(crate) fn repair_sealed_settings(
    pool: crate::db::DbPool,
    key: [u8; 32],
) -> Result<usize, AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM kv")
        .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            let k: String = row.get(0)?;
            let v = {
                if let Ok(b) = row.get::<_, Vec<u8>>(1) {
                    b
                } else {
                    row.get::<_, String>(1)?.into_bytes()
                }
            };
            Ok((k, v))
        })
        .map_err(|e| AppError::Other(e.to_string()))?
        .collect::<Result<Vec<(String, Vec<u8>)>, _>>()
        .map_err(|e| AppError::Other(e.to_string()))?;
    drop(stmt);
    drop(conn);
    let mut fixed = 0;
    for (k, stored) in rows {
        if !crate::shared::is_encrypted_yjs_blob(&stored) {
            continue;
        }
        // Decrypt with the content key, then rewrite plaintext (enc_key=None).
        let plain = crate::shared::decrypt_yjs_blob(&key, &stored)?;
        let text = String::from_utf8(plain).map_err(|e| AppError::Other(e.to_string()))?;
        crate::db::db_set(&pool, &k, &text, None)?;
        fixed += 1;
    }
    if fixed > 0 {
        eprintln!("[storage] repair_sealed_settings: fixed {fixed} rows");
    }
    Ok(fixed)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_repair_settings(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    let pool = pick_pool(SETTINGS_STORE, &app, &state)?;
    let app_key = current_app_key(state.inner())?
        .ok_or_else(|| AppError::Other("App encryption is locked.".into()))?;
    tokio::task::spawn_blocking(move || repair_sealed_settings(pool, app_key))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

/// Set one value by dot-separated key: single INSERT OR REPLACE for
/// flat-addressable keys, otherwise the load-modify-rewrite path.
#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_set(
    app: AppHandle,
    name: String,
    key: String,
    value: RawJson,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = pick_pool(&name, &app, &state)?;
    let is_settings = name == SETTINGS_STORE;
    let app_key = current_app_key(state.inner())?;
    let key_id = state
        .inner()
        .crypto
        .session
        .read()
        .map_err(AppError::from)?
        .current_items_key_id
        .clone();

    tokio::task::spawn_blocking(move || {
        storage_set_value(pool, name, key, value.0, app_key, key_id)
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))??;

    if is_settings {
        invalidate_settings_cache(state.inner());
    }
    Ok(())
}

/// Delete one value by dot-separated key: single DELETE for flat-addressable
/// keys, otherwise the load-modify-rewrite path.
#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_delete(
    app: AppHandle,
    name: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = pick_pool(&name, &app, &state)?;
    let is_settings = name == SETTINGS_STORE;
    let app_key = current_app_key(state.inner())?;
    let key_id = state
        .inner()
        .crypto
        .session
        .read()
        .map_err(AppError::from)?
        .current_items_key_id
        .clone();

    tokio::task::spawn_blocking(move || storage_delete_value(pool, name, key, app_key, key_id))
        .await
        .map_err(|e| AppError::Other(e.to_string()))??;

    if is_settings {
        invalidate_settings_cache(state.inner());
    }
    Ok(())
}

/// Whether a key exists (COUNT for flat-addressable keys, otherwise fallback).
#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_has(
    app: AppHandle,
    name: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let pool = pick_pool(&name, &app, &state)?;
    let app_key = current_app_key(state.inner())?;
    let key_id = state
        .inner()
        .crypto
        .session
        .read()
        .map_err(AppError::from)?
        .current_items_key_id
        .clone();

    tokio::task::spawn_blocking(move || storage_has_value(pool, name, key, app_key, key_id))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn storage_clear(
    app: AppHandle,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = pick_pool(&name, &app, &state)?;
    tokio::task::spawn_blocking(move || crate::db::db_clear(&pool))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{fs, path::PathBuf, time::SystemTime};

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let ts = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock ok")
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{ts}-{}", std::process::id()))
    }

    #[test]
    fn load_store_root_migrates_plaintext_data_store_rows() {
        let root = unique_temp_dir("beaver-notes-kv-test");
        let _ = fs::create_dir_all(&root);
        let db_path = root.join("data.db");
        let pool = crate::db::open_pool(&db_path).expect("pool");
        let state = AppState::new(root.clone(), root.clone(), Some(root.clone()));

        {
            let mut session = state.crypto.session.write().expect("session");
            session.app_data_key = Some([7u8; 32]);
            session.current_items_key_id = "kid1".to_string();
            session.active = true;
        }

        let mut plain = Map::new();
        plain.insert(
            "notes.note-1".to_string(),
            json!({
                "id": "note-1",
                "title": "Secret title",
                "labels": ["alpha"],
                "content": {"type": "doc", "content": []}
            }),
        );
        plain.insert("labels".to_string(), json!(["alpha"]));
        plain.insert("labelColors".to_string(), json!({"alpha": "#112233"}));

        crate::db::db_replace_all(&pool, plain, None).expect("seed plaintext");

        let app_key = current_app_key(&state).expect("app key");
        let key_id = state
            .crypto
            .session
            .read()
            .expect("session")
            .current_items_key_id
            .clone();
        let root_value =
            load_store_root_inner(&pool, DATA_STORE, &app_key, &key_id).expect("load root");
        let notes = root_value.get("notes").expect("notes root");
        assert_eq!(
            notes.get("note-1").and_then(Value::as_object).is_some(),
            true
        );
        assert_eq!(
            notes
                .get("note-1")
                .and_then(Value::as_object)
                .and_then(|m| m.get("title"))
                .and_then(Value::as_str),
            Some("Secret title")
        );

        let raw = crate::db::db_all(&pool, app_key).expect("raw store");
        let encrypted_note = raw
            .get("notes.note-1")
            .and_then(Value::as_object)
            .expect("encrypted note row");
        assert_eq!(encrypted_note.get("ae").and_then(Value::as_u64), Some(4));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn store_row_round_trip_encrypts_and_decrypts() {
        let state = AppState::new(PathBuf::new(), PathBuf::new(), None);
        {
            let mut session = state.crypto.session.write().expect("session");
            session.app_data_key = Some([8u8; 32]);
            session.current_items_key_id = "kid2".to_string();
            session.active = true;
        }

        let value = json!({"id": "note-2", "title": "Round trip"});
        let app_key = current_app_key(&state).expect("app key");
        let encrypted = encrypt_store_row_with_key(
            "notes.note-2",
            value.clone(),
            app_key.as_ref().unwrap(),
            "kid2",
        )
        .expect("enc");
        assert_eq!(encrypted.get("ae").and_then(Value::as_u64), Some(4));

        let decrypted =
            decrypt_store_row_with_key("notes.note-2", encrypted, &app_key).expect("dec");
        assert_eq!(decrypted, value);
    }

    #[test]
    fn reencrypt_legacy_rows_encrypts_plaintext_metadata_and_is_idempotent() {
        let root = unique_temp_dir("beaver-notes-reencrypt");
        let _ = fs::create_dir_all(&root);
        let db_path = root.join("data.db");
        let pool = crate::db::open_pool(&db_path).expect("pool");

        // Legacy migration shape: content encrypted inline, metadata (and the
        // whole folder row) plaintext.
        let mut plain = Map::new();
        plain.insert(
            "notes.note-1".to_string(),
            json!({"id": "note-1", "title": "Secret title", "folderId": "f1"}),
        );
        plain.insert(
            "folders.f1".to_string(),
            json!({"id": "f1", "name": "Private"}),
        );
        crate::db::db_replace_all(&pool, plain, None).expect("seed");

        let key = [9u8; 32];
        let key_id = "kid3";

        let count =
            reencrypt_legacy_store_rows(pool.clone(), key, key_id.to_string()).expect("reencrypt");
        assert_eq!(count, 2);

        let raw = crate::db::db_all(&pool, Some(key)).expect("raw");
        for row_key in ["notes.note-1", "folders.f1"] {
            let row = raw.get(row_key).expect("row");
            assert_eq!(
                row.as_object()
                    .and_then(|o| o.get("ae"))
                    .and_then(Value::as_u64),
                Some(4),
                "{row_key} should be whole-row encrypted"
            );
            // The decrypted content is unchanged.
            let decrypted = decrypt_json_from_storage(&key, row, &storage_aad(row_key))
                .expect("decrypt")
                .expect("envelope");
            assert!(decrypted.get("title").is_some() || decrypted.get("name").is_some());
        }

        // Second pass is a no-op.
        let second = reencrypt_legacy_store_rows(pool.clone(), key, key_id.to_string())
            .expect("reencrypt 2");
        assert_eq!(second, 0);

        let _ = fs::remove_dir_all(&root);
    }
}
