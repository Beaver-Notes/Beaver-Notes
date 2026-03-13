use serde_json::{Map, Value};
use tauri::{AppHandle, State};

use crate::shared::*;

fn key_segments(key: &str) -> Vec<&str> {
    key.split('.')
        .filter(|segment| !segment.is_empty())
        .collect()
}

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
        if key == "notes" {
            if let Value::Object(notes) = value {
                for (id, note) in notes {
                    output.insert(format!("notes.{id}"), note);
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

#[tauri::command]
pub(crate) fn storage_get_store(
    app: AppHandle,
    name: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let pool = pick_pool(&name, &app, &state)?;
    Ok(load_store_root(pool)?)
}

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

#[tauri::command]
pub(crate) fn storage_get(
    app: AppHandle,
    name: String,
    key: String,
    def: Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let pool = pick_pool(&name, &app, &state)?;
    let root = load_store_root(pool)?;
    let segments = key_segments(&key);
    if segments.is_empty() {
        return Ok(def);
    }
    Ok(get_nested_value(&root, &segments).cloned().unwrap_or(def))
}

#[tauri::command]
pub(crate) fn storage_set(
    app: AppHandle,
    name: String,
    key: String,
    value: Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = pick_pool(&name, &app, &state)?;
    let mut root = load_store_root(pool)?;
    let segments = key_segments(&key);
    if segments.is_empty() {
        return Ok(());
    }
    set_nested_value(&mut root, &segments, value);
    crate::db::db_replace_all(pool, flatten_store_value(root))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn storage_delete(
    app: AppHandle,
    name: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = pick_pool(&name, &app, &state)?;
    let mut root = load_store_root(pool)?;
    let segments = key_segments(&key);
    if segments.is_empty() {
        return Ok(());
    }
    let _ = delete_nested_value(&mut root, &segments);
    crate::db::db_replace_all(pool, flatten_store_value(root))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn storage_has(
    app: AppHandle,
    name: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let pool = pick_pool(&name, &app, &state)?;
    let root = load_store_root(pool)?;
    let segments = key_segments(&key);
    if segments.is_empty() {
        return Ok(false);
    }
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
