use serde_json::{Map, Value};
use tauri::{AppHandle, State};

use crate::shared::*;

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

fn load_store_root(pool: &crate::db::DbPool) -> Result<Value, String> {
    Ok(nested_store_value(crate::db::db_all(pool)?))
}

fn pick_pool<'a>(
    name: &str,
    app: &AppHandle,
    state: &'a AppState,
) -> Result<&'a crate::db::DbPool, String> {
    match allowed_store_name(name)? {
        SETTINGS_STORE => settings_pool(app, state),
        DATA_STORE => data_pool(app, state),
        _ => Err(format!(
            r#"[storage] blocked access to unknown store: "{name}""#
        )),
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
// "notes-content") with a single sub-key — both of which are already stored as
// flat rows by flatten_store_value / the note store.

/// Collection namespaces whose entries are stored as individual flat rows
/// (e.g. "notes.abc123") rather than a single JSON blob under the bare key.
/// Requests for the bare key (e.g. `storage_get("notes")`) must fall through
/// to `load_store_root` so they see all the individual rows reassembled.
const COLLECTION_NAMESPACES: &[&str] = &["notes", "notes-content", "folders"];

fn flat_db_key(segments: &[&str]) -> Option<String> {
    match segments {
        // Single-segment key that is NOT a collection namespace → stored as-is
        // (e.g. "deletedIds", "migration_completed", "labelColors", …).
        // Collection-namespace bare keys ("notes", "folders", …) must fall
        // through to load_store_root so the caller gets the full assembled object.
        [key] if !COLLECTION_NAMESPACES.contains(key) => Some((*key).to_string()),
        // "notes.<id>", "notes-content.<id>", "folders.<id>" → flat rows
        ["notes", id] | ["notes-content", id] | ["folders", id] => {
            Some(format!("{}.{}", segments[0], id))
        }
        _ => None,
    }
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Returns the full store as a nested JSON object.
/// Only used on startup / sync — intentionally loads everything.
#[tauri::command]
pub(crate) fn storage_get_store(
    app: AppHandle,
    name: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let pool = pick_pool(&name, &app, &state)?;
    Ok(load_store_root(pool)?)
}

/// Replaces the entire store. Used by sync / import flows.
#[tauri::command]
pub(crate) fn storage_replace(
    app: AppHandle,
    name: String,
    data: Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = pick_pool(&name, &app, &state)?;
    crate::db::db_replace_all(pool, flatten_store_value(data))?;
    Ok(())
}

/// Gets a single value by dot-separated key.
/// For flat-addressable keys this is a single-row lookup; otherwise it falls
/// back to loading the full store (legacy path, rarely hit).
#[tauri::command]
pub(crate) fn storage_get(
    app: AppHandle,
    name: String,
    key: String,
    def: Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let pool = pick_pool(&name, &app, &state)?;
    let segments = key_segments(&key);
    if segments.is_empty() {
        return Ok(def);
    }

    if let Some(flat_key) = flat_db_key(&segments) {
        let raw = crate::db::db_get(pool, &flat_key)?;
        return Ok(raw
            .and_then(|r| serde_json::from_str::<Value>(&r).ok())
            .unwrap_or(def));
    }

    // Fallback: multi-level key — load full store and walk the tree
    let root = load_store_root(pool)?;
    Ok(get_nested_value(&root, &segments).cloned().unwrap_or(def))
}

/// Sets a single value by dot-separated key.
/// For flat-addressable keys this is a single INSERT OR REPLACE; otherwise it
/// falls back to the load-modify-rewrite path.
#[tauri::command]
pub(crate) fn storage_set(
    app: AppHandle,
    name: String,
    key: String,
    value: Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = pick_pool(&name, &app, &state)?;
    let segments = key_segments(&key);
    if segments.is_empty() {
        return Ok(());
    }

    if let Some(flat_key) = flat_db_key(&segments) {
        let serialized = serde_json::to_string(&value).map_err(to_error)?;
        return crate::db::db_set(pool, &flat_key, &serialized);
    }

    // Fallback: multi-level key — load, mutate, rewrite
    let mut root = load_store_root(pool)?;
    set_nested_value(&mut root, &segments, value);
    crate::db::db_replace_all(pool, flatten_store_value(root))?;
    Ok(())
}

/// Deletes a single value by dot-separated key.
/// For flat-addressable keys this is a single DELETE; otherwise falls back to
/// the load-modify-rewrite path.
#[tauri::command]
pub(crate) fn storage_delete(
    app: AppHandle,
    name: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = pick_pool(&name, &app, &state)?;
    let segments = key_segments(&key);
    if segments.is_empty() {
        return Ok(());
    }

    if let Some(flat_key) = flat_db_key(&segments) {
        return crate::db::db_delete(pool, &flat_key);
    }

    // Fallback: multi-level key — load, mutate, rewrite
    let mut root = load_store_root(pool)?;
    let _ = delete_nested_value(&mut root, &segments);
    crate::db::db_replace_all(pool, flatten_store_value(root))?;
    Ok(())
}

/// Checks whether a key exists.
/// For flat-addressable keys this is a single COUNT query; otherwise falls back.
#[tauri::command]
pub(crate) fn storage_has(
    app: AppHandle,
    name: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let pool = pick_pool(&name, &app, &state)?;
    let segments = key_segments(&key);
    if segments.is_empty() {
        return Ok(false);
    }

    if let Some(flat_key) = flat_db_key(&segments) {
        return crate::db::db_has(pool, &flat_key);
    }

    // Fallback: multi-level key
    let root = load_store_root(pool)?;
    Ok(get_nested_value(&root, &segments).is_some())
}

#[tauri::command]
pub(crate) fn storage_clear(
    app: AppHandle,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = pick_pool(&name, &app, &state)?;
    crate::db::db_clear(pool)?;
    Ok(())
}
