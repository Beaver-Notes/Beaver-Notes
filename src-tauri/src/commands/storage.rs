use serde_json::{Map, Value};
use tauri::{AppHandle, State};

use crate::shared::{RawJson, *};

// ─── Key helpers ─────────────────────────────────────────────────────────────

fn key_segments(key: &str) -> Vec<&str> {
    key.split('.')
        .filter(|segment| !segment.is_empty())
        .collect()
}

// ─── Nested-value helpers (used only for storage_get_store / storage_replace) ─

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
        // Collection namespaces are stored as individual flat rows rather than
        // a single JSON blob, so we explode them into "<namespace>.<id>" rows.
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
        if key_id.is_empty() { None } else { Some(&*key_id) },
    )?;
    Ok(serde_json::to_value(envelope)?)
}

/// Core store-load logic, parameterised by key material so it can be called
/// from both sync (state-bearing) and async (`spawn_blocking`) paths.
fn load_store_root_inner(
    pool: &crate::db::DbPool,
    name: &str,
    app_key: &Option<[u8; 32]>,
    key_id: &str,
) -> Result<Value, AppError> {
    let flat = crate::db::db_all(pool)?;

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

    if needs_migration {
        let mut encrypted = Map::new();
        for (row_key, value) in plain.clone() {
            if let Some(ref key) = app_key {
                encrypted.insert(
                    row_key.clone(),
                    encrypt_store_row_with_key(&row_key, value, key, key_id)?,
                );
            }
        }
        crate::db::db_replace_all(pool, encrypted)?;
    }

    Ok(nested_store_value(plain))
}

fn pick_pool(
    name: &str,
    app: &AppHandle,
    state: &AppState,
) -> Result<crate::db::DbPool, AppError> {
    match allowed_store_name(name)? {
        SETTINGS_STORE => Ok(settings_pool(app, state)?),
        DATA_STORE => Ok(data_pool(app, state)?),
        _ => Err(AppError::Other(format!(
            r#"[storage] blocked access to unknown store: "{name}""#
        ))),
    }
}

// ─── Flat-key helpers ─────────────────────────────────────────────────────────
//
// For simple dot-separated keys that map 1:1 to a KV row (e.g. "notes.abc123",
// "deletedIds", "migration_completed") we can go directly to the DB without
// loading the whole store into memory first.
//
// A key is "flat-addressable" when it has exactly one level (e.g. "deletedIds")
// or when its top-level prefix is a known note-like namespace ("notes",
// "folders") with a single sub-key — both of which are already stored as
// flat rows by flatten_store_value / the note store.

/// Collection namespaces whose entries are stored as individual flat rows
/// (e.g. "notes.abc123") rather than a single JSON blob under the bare key.
/// Requests for the bare key (e.g. `storage_get("notes")`) must fall through
/// to `load_store_root` so they see all the individual rows reassembled.
const COLLECTION_NAMESPACES: &[&str] = &["notes", "folders"];

fn flat_db_key(segments: &[&str]) -> Option<String> {
    match segments {
        // Single-segment key that is NOT a collection namespace → stored as-is
        // (e.g. "deletedIds", "migration_completed", "labelColors", …).
        // Collection-namespace bare keys ("notes", "folders", …) must fall
        // through to load_store_root so the caller gets the full assembled object.
        [key] if !COLLECTION_NAMESPACES.contains(key) => Some((*key).to_string()),
        // "notes.<id>", "folders.<id>" → flat rows
        ["notes", id] | ["folders", id] => {
            Some(format!("{}.{}", segments[0], id))
        }
        _ => None,
    }
}

/// Decrypt a single KV row with key material extracted up front, so the work
/// can run inside `spawn_blocking` without touching `AppState`.
/// Mirrors `decrypt_store_row` (plaintext passthrough when the key is absent).
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

// ─── Pure worker functions (state-free; run inside spawn_blocking) ───────────
//
// The async commands extract owned key material (`app_key`, `key_id`) and the
// connection pool up front, then dispatch these workers to a blocking thread so
// SQLite I/O and per-row AES never block the Tauri event loop.

/// One-time pass: whole-row-encrypt legacy `notes.*` / `folders.*` rows that
/// the migration wrote with only their note content encrypted (or not at all),
/// leaving titles and folder metadata as plaintext JSON on disk. Idempotent —
/// rows that already decrypt as whole-row envelopes are skipped, and the read
/// path handles mixed plaintext/encrypted rows transparently, so a partial pass
/// is safe.
pub(crate) fn reencrypt_legacy_store_rows(
    pool: crate::db::DbPool,
    key: [u8; 32],
    key_id: String,
) -> Result<usize, AppError> {
    let mut count = 0;
    for (row_key, value) in crate::db::db_all(&pool)? {
        if !row_key.starts_with("notes.") && !row_key.starts_with("folders.") {
            continue;
        }
        if decrypt_json_from_storage(&key, &value, &storage_aad(&row_key))?.is_some() {
            continue;
        }
        let encrypted = encrypt_store_row_with_key(&row_key, value, &key, &key_id)?;
        crate::db::db_set(&pool, &row_key, &serde_json::to_string(&encrypted)?)?;
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

    if let Some(flat_key) = flat_db_key(&segments) {
        let raw = crate::db::db_get(&pool, &flat_key)?;
        let value = raw
            .and_then(|r| serde_json::from_str::<Value>(&r).ok())
            .map(|v| {
                if name == DATA_STORE {
                    decrypt_store_row_with_key(&flat_key, v, &app_key).unwrap_or(Value::Null)
                } else {
                    v
                }
            })
            .unwrap_or(def);
        return Ok(value);
    }

    // Fallback: multi-level key — load full store and walk the tree
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

    if let Some(flat_key) = flat_db_key(&segments) {
        let payload = if name == DATA_STORE {
            match &app_key {
                Some(k) => encrypt_store_row_with_key(&flat_key, value, k, &key_id)?,
                None => value,
            }
        } else {
            value
        };
        let serialized = serde_json::to_string(&payload)?;
        crate::db::db_set(&pool, &flat_key, &serialized)?;
        return Ok(());
    }

    // Fallback: multi-level key — load, mutate, rewrite
    let mut root = load_store_root_inner(&pool, &name, &app_key, &key_id)?;
    set_nested_value(&mut root, &segments, value);
    let mut flattened = flatten_store_value(root);
    if name == DATA_STORE {
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
    crate::db::db_replace_all(&pool, flattened)?;
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

    if let Some(flat_key) = flat_db_key(&segments) {
        crate::db::db_delete(&pool, &flat_key)?;
        return Ok(());
    }

    // Fallback: multi-level key — load, mutate, rewrite
    let mut root = load_store_root_inner(&pool, &name, &app_key, &key_id)?;
    let _ = delete_nested_value(&mut root, &segments);
    let mut flattened = flatten_store_value(root);
    if name == DATA_STORE {
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
    crate::db::db_replace_all(&pool, flattened)?;
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
        return Ok(crate::db::db_has(&pool, &flat_key)?);
    }

    // Fallback: multi-level key
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
    let incoming = flatten_store_value(data);
    let existing = crate::db::db_all(&pool)?;

    let mut upserts = Map::new();
    let mut delete_keys: Vec<String> = Vec::new();

    if name == DATA_STORE {
        for (key, plain_value) in &incoming {
            let changed = match existing.get(key) {
                Some(existing_envelope) => {
                    let decrypted_existing = match &app_key {
                        Some(k) => decrypt_json_from_storage(k, existing_envelope, &storage_aad(key))?
                            .unwrap_or_else(|| existing_envelope.clone()),
                        None => existing_envelope.clone(),
                    };
                    &decrypted_existing != plain_value
                }
                None => true, // new row
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
        crate::db::db_apply_diff(&pool, &upserts, &delete_keys)?;
    }
    Ok(())
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Returns the full store as a nested JSON object.
/// Only used on startup / sync — intentionally loads everything.
/// Note content is no longer encrypted at the KV layer; Yjs blobs are
/// encrypted at rest in the note_content / yjs_snapshots tables instead.
///
/// The heavy lifting (DB read + per-row decryption) is dispatched to a
/// blocking thread pool so the Tauri event loop stays responsive.
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
    let root = tokio::task::spawn_blocking(move || load_store_root_inner(&pool, &name, &app_key, &key_id))
        .await
        .map_err(|e| AppError::Other(e.to_string()))??;
    Ok(root.into())
}

/// Replaces the entire store. Used by sync / import flows.
///
/// Optimised path: only rows whose content actually changed are re-encrypted
/// and written.  Unchanged rows keep their existing DB envelope, avoiding
/// expensive AES-GCM re-encryption and reducing I/O.
///
/// Heavy lifting (full-table read + per-row compare/decrypt/encrypt) is
/// dispatched to a blocking thread so the Tauri event loop stays responsive.
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

/// Gets a single value by dot-separated key.
/// For flat-addressable keys this is a single-row lookup; otherwise it falls
/// back to loading the full store (legacy path, rarely hit).
///
/// Runs off the main thread: the collection-namespace fallback ("notes",
/// "folders") reads and decrypts the entire KV table, which must not block the
/// Tauri event loop.
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

    let value =
        tokio::task::spawn_blocking(move || storage_get_value(pool, name, key, def.0, app_key, key_id))
            .await
            .map_err(|e| AppError::Other(e.to_string()))??;
    Ok(value.into())
}

/// Whole-row-encrypt legacy `notes.*` / `folders.*` rows left plaintext by the
/// migration. Idempotent; call after the app key is loaded.
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

/// Sets a single value by dot-separated key.
/// For flat-addressable keys this is a single INSERT OR REPLACE; otherwise it
/// falls back to the load-modify-rewrite path.
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

    tokio::task::spawn_blocking(move || storage_set_value(pool, name, key, value.0, app_key, key_id))
        .await
        .map_err(|e| AppError::Other(e.to_string()))??;

    if is_settings {
        invalidate_settings_cache(state.inner());
    }
    Ok(())
}

/// Deletes a single value by dot-separated key.
/// For flat-addressable keys this is a single DELETE; otherwise falls back to
/// the load-modify-rewrite path.
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

/// Checks whether a key exists.
/// For flat-addressable keys this is a single COUNT query; otherwise falls back.
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

        crate::db::db_replace_all(&pool, plain).expect("seed plaintext");

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
        assert_eq!(notes.get("note-1").and_then(Value::as_object).is_some(), true);
        assert_eq!(
            notes
                .get("note-1")
                .and_then(Value::as_object)
                .and_then(|m| m.get("title"))
                .and_then(Value::as_str),
            Some("Secret title")
        );

        let raw = crate::db::db_all(&pool).expect("raw store");
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
        let encrypted =
            encrypt_store_row_with_key("notes.note-2", value.clone(), app_key.as_ref().unwrap(), "kid2")
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

        // Legacy migration shape: note content encrypted inline, metadata (and
        // the whole folder row) plaintext.
        let mut plain = Map::new();
        plain.insert(
            "notes.note-1".to_string(),
            json!({"id": "note-1", "title": "Secret title", "folderId": "f1"}),
        );
        plain.insert(
            "folders.f1".to_string(),
            json!({"id": "f1", "name": "Private"}),
        );
        crate::db::db_replace_all(&pool, plain).expect("seed");

        let key = [9u8; 32];
        let key_id = "kid3";

        let count = reencrypt_legacy_store_rows(pool.clone(), key, key_id.to_string())
            .expect("reencrypt");
        assert_eq!(count, 2);

        let raw = crate::db::db_all(&pool).expect("raw");
        for row_key in ["notes.note-1", "folders.f1"] {
            let row = raw.get(row_key).expect("row");
            assert_eq!(
                row.as_object().and_then(|o| o.get("ae")).and_then(Value::as_u64),
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
