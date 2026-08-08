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

fn storage_aad(row_key: &str) -> String {
    format!("beaver-notes:data-store:{row_key}")
}

fn encrypt_store_row(row_key: &str, value: Value, state: &AppState) -> Result<Value, AppError> {
    let _t = crate::shared::speed_log::scope("storage.encrypt_store_row");
    let Some(key) = current_app_key(state)? else {
        return Ok(value);
    };

    let key_id = state
        .crypto
        .session
        .read()
        .map_err(AppError::from)?
        .current_items_key_id
        .clone();

    let envelope = encrypt_json_for_storage(
        &key,
        &value,
        &storage_aad(row_key),
        if key_id.is_empty() { None } else { Some(key_id.as_str()) },
    )?;
    Ok(serde_json::to_value(envelope)?)
}

fn decrypt_store_row(row_key: &str, value: Value, state: &AppState) -> Result<Value, AppError> {
    let _t = crate::shared::speed_log::scope("storage.decrypt_store_row");
    let Some(key) = current_app_key(state)? else {
        return Ok(value);
    };

    Ok(decrypt_json_from_storage(&key, &value, &storage_aad(row_key))?.unwrap_or(value))
}

fn load_store_root(
    pool: &crate::db::DbPool,
    name: &str,
    state: &AppState,
) -> Result<Value, AppError> {
    let flat = crate::db::db_all(pool)?;

    if name != DATA_STORE {
        return Ok(nested_store_value(flat));
    }

    let app_key = current_app_key(state)?;
    let mut needs_migration = false;
    let mut plain = Map::new();

    for (row_key, value) in flat {
        let is_enveloped = matches!(
            value,
            Value::Object(ref map) if map.get("ae").and_then(Value::as_u64) == Some(4)
        );

        let decrypted = if let Some(ref key) = app_key {
            decrypt_json_from_storage(key, &value, &storage_aad(&row_key))?
                .unwrap_or_else(|| value.clone())
        } else {
            value.clone()
        };

        if !is_enveloped {
            needs_migration = true;
        }

        plain.insert(row_key, decrypted);
    }

    if needs_migration {
        let mut encrypted = Map::new();
        for (row_key, value) in plain.clone() {
            encrypted.insert(row_key.clone(), encrypt_store_row(&row_key, value, state)?);
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

// ─── Commands ────────────────────────────────────────────────────────────────

/// Returns the full store as a nested JSON object.
/// Only used on startup / sync — intentionally loads everything.
/// Note content is no longer encrypted at the KV layer; Yjs blobs are
/// encrypted at rest in the note_content / yjs_snapshots tables instead.
#[tauri::command]
#[specta::specta]
pub(crate) fn storage_get_store(
    app: AppHandle,
    name: String,
    state: State<'_, AppState>,
) -> Result<RawJson, AppError> {
    let pool = pick_pool(&name, &app, &state)?;
    let root = load_store_root(&pool, &name, state.inner())?;
    Ok(root.into())
}

/// Replaces the entire store. Used by sync / import flows.
#[tauri::command]
#[specta::specta]
pub(crate) fn storage_replace(
    app: AppHandle,
    name: String,
    data: RawJson,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = pick_pool(&name, &app, &state)?;
    let mut flattened = flatten_store_value(data.0);
    if name == DATA_STORE {
        let state_inner = state.inner();
        let mut encrypted = Map::new();
        for (key, value) in flattened {
            encrypted.insert(key.clone(), encrypt_store_row(&key, value, state_inner)?);
        }
        flattened = encrypted;
    }
    crate::db::db_replace_all(&pool, flattened)?;
    if name == SETTINGS_STORE {
        invalidate_settings_cache(&state);
    }
    Ok(())
}

/// Gets a single value by dot-separated key.
/// For flat-addressable keys this is a single-row lookup; otherwise it falls
/// back to loading the full store (legacy path, rarely hit).
#[tauri::command]
#[specta::specta]
pub(crate) fn storage_get(
    app: AppHandle,
    name: String,
    key: String,
    def: RawJson,
    state: State<'_, AppState>,
) -> Result<RawJson, AppError> {
    let pool = pick_pool(&name, &app, &state)?;
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
                    decrypt_store_row(&flat_key, v, state.inner()).unwrap_or(Value::Null)
                } else {
                    v
                }
            })
            .unwrap_or(def.0);
        return Ok(value.into());
    }

    // Fallback: multi-level key — load full store and walk the tree
    let root = load_store_root(&pool, &name, state.inner())?;
    let value = get_nested_value(&root, &segments).cloned().unwrap_or(def.0);
    Ok(value.into())
}

/// Sets a single value by dot-separated key.
/// For flat-addressable keys this is a single INSERT OR REPLACE; otherwise it
/// falls back to the load-modify-rewrite path.
#[tauri::command]
#[specta::specta]
pub(crate) fn storage_set(
    app: AppHandle,
    name: String,
    key: String,
    value: RawJson,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = pick_pool(&name, &app, &state)?;
    let segments = key_segments(&key);
    if segments.is_empty() {
        return Ok(());
    }

    if let Some(flat_key) = flat_db_key(&segments) {
        let payload = if name == DATA_STORE {
            encrypt_store_row(&flat_key, value.0.clone(), state.inner())?
        } else {
            value.0.clone()
        };
        let serialized = serde_json::to_string(&payload)?;
        crate::db::db_set(&pool, &flat_key, &serialized)?;
        if name == SETTINGS_STORE {
            invalidate_settings_cache(&state);
        }
        return Ok(());
    }

    // Fallback: multi-level key — load, mutate, rewrite
    let mut root = load_store_root(&pool, &name, state.inner())?;
    set_nested_value(&mut root, &segments, value.0);
    let mut flattened = flatten_store_value(root);
    if name == DATA_STORE {
        let state_inner = state.inner();
        let mut encrypted = Map::new();
        for (key, value) in flattened {
            encrypted.insert(key.clone(), encrypt_store_row(&key, value, state_inner)?);
        }
        flattened = encrypted;
    }
    crate::db::db_replace_all(&pool, flattened)?;
    if name == SETTINGS_STORE {
        invalidate_settings_cache(&state);
    }
    Ok(())
}

/// Deletes a single value by dot-separated key.
/// For flat-addressable keys this is a single DELETE; otherwise falls back to
/// the load-modify-rewrite path.
#[tauri::command]
#[specta::specta]
pub(crate) fn storage_delete(
    app: AppHandle,
    name: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = pick_pool(&name, &app, &state)?;
    let segments = key_segments(&key);
    if segments.is_empty() {
        return Ok(());
    }

    if let Some(flat_key) = flat_db_key(&segments) {
        crate::db::db_delete(&pool, &flat_key)?;
        if name == SETTINGS_STORE {
            invalidate_settings_cache(&state);
        }
        return Ok(());
    }

    // Fallback: multi-level key — load, mutate, rewrite
    let mut root = load_store_root(&pool, &name, state.inner())?;
    let _ = delete_nested_value(&mut root, &segments);
    let mut flattened = flatten_store_value(root);
    if name == DATA_STORE {
        let state_inner = state.inner();
        let mut encrypted = Map::new();
        for (key, value) in flattened {
            encrypted.insert(key.clone(), encrypt_store_row(&key, value, state_inner)?);
        }
        flattened = encrypted;
    }
    crate::db::db_replace_all(&pool, flattened)?;
    if name == SETTINGS_STORE {
        invalidate_settings_cache(&state);
    }
    Ok(())
}

/// Checks whether a key exists.
/// For flat-addressable keys this is a single COUNT query; otherwise falls back.
#[tauri::command]
#[specta::specta]
pub(crate) fn storage_has(
    app: AppHandle,
    name: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let pool = pick_pool(&name, &app, &state)?;
    let segments = key_segments(&key);
    if segments.is_empty() {
        return Ok(false);
    }

    if let Some(flat_key) = flat_db_key(&segments) {
        return Ok(crate::db::db_has(&pool, &flat_key)?);
    }

    // Fallback: multi-level key
    let root = load_store_root(&pool, &name, state.inner())?;
    Ok(get_nested_value(&root, &segments).is_some())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn storage_clear(
    app: AppHandle,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = pick_pool(&name, &app, &state)?;
    crate::db::db_clear(&pool)?;
    Ok(())
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

        let root_value = load_store_root(&pool, DATA_STORE, &state).expect("load root");
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
        let encrypted = encrypt_store_row("notes.note-2", value.clone(), &state).expect("enc");
        assert_eq!(encrypted.get("ae").and_then(Value::as_u64), Some(4));

        let decrypted = decrypt_store_row("notes.note-2", encrypted, &state).expect("dec");
        assert_eq!(decrypted, value);
    }
}
