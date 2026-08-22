//! Debug bridge — inspect raw store + workspace-doc state from the running app.
//!
//! Exposes a single `debug:dumpState` command the frontend can call to dump
//! what is actually persisted (KV rows, per-note Yjs updates, the workspace
//! meta doc) versus what the in-memory stores think. This is the ground-truth
//! tool for diagnosing migration/empty-state bugs: labels visible + notes
//! missing in the UI is usually a workspace-doc/notes-map mismatch that only
//! shows up by comparing the two layers.
//!
//! Intended for dev/diagnostics. The output is diagnostic only and never
//! contains note contents.

use std::collections::BTreeMap;

use serde_json::{json, Value};
use tauri::{AppHandle, State};
use y_octo::Doc;

use crate::shared::*;

fn kv_summary(pool: &crate::db::DbPool) -> Result<Value, AppError> {
  let rows = crate::db::db_all(pool)?;
  let mut notes = 0usize;
  let mut folders = 0usize;
  let mut labels: Vec<String> = Vec::new();
  let mut label_colors = 0usize;
  let mut deleted = 0usize;
  let mut sample_keys: Vec<String> = Vec::new();
  let mut other = BTreeMap::<String, usize>::new();

  for (key, value) in rows {
    if key.starts_with("notes.") {
      notes += 1;
      if sample_keys.len() < 10 {
        sample_keys.push(key.clone());
      }
    } else if key.starts_with("folders.") {
      folders += 1;
    } else if key == "labels" {
      if let Some(arr) = value.as_array() {
        labels = arr
          .iter()
          .filter_map(|v| v.as_str().map(|s| s.to_string()))
          .collect();
      }
    } else if key == "labelColors" {
      label_colors = value.as_object().map(|o| o.len()).unwrap_or(0);
    } else if key.starts_with("deleted") {
      deleted += 1;
    } else {
      *other.entry(key.clone()).or_insert(0) += 1;
    }
  }

  Ok(json!({
    "notes": notes,
    "folders": folders,
    "labels": labels,
    "labelColors": label_colors,
    "deletedCollections": deleted,
    "sampleNoteKeys": sample_keys,
    "otherKeyCounts": other,
  }))
}

/// Decode the workspace meta doc from `note_content` into counts of what it
/// actually contains. Returns `None` for each collection when the meta doc is
/// absent or cannot be decoded.
fn workspace_doc_summary(
  pool: &crate::db::DbPool,
  key: Option<[u8; 32]>,
) -> Result<Value, AppError> {
  let snapshot = crate::db::yjs_get_snapshot(pool, "meta", key).unwrap_or_default();
  if snapshot.is_empty() {
    return Ok(json!({ "hasMetaDoc": false }));
  }

  let mut doc = Doc::new();
  match y_octo::Update::decode_v1(&snapshot) {
    Ok(update) => {
      doc.apply_update(update).map_err(|e| AppError::Other(e.to_string()))?;
    }
    Err(e) => {
      return Ok(json!({
        "hasMetaDoc": true,
        "decodeError": e.to_string(),
        "snapshotBytes": snapshot.len(),
      }));
    }
  }

  let notes_map = doc.get_map("notes").ok();
  let folders_map = doc.get_map("folders").ok();
  let labels_array = doc.get_or_create_array("labels").ok();
  let label_colors = doc.get_map("labelColors").ok();
  let deleted_notes = doc.get_map("deletedNoteIds").ok();
  let deleted_folders = doc.get_map("deletedFolderIds").ok();

  fn any_str(value: &y_octo::Value) -> Option<String> {
    value
      .to_any()
      .map(|any| any.to_string())
  }

  let mut note_samples = Vec::new();
  if let Some(notes_map) = notes_map.as_ref() {
    for (note_key, entry) in notes_map.iter() {
      if note_samples.len() >= 5 {
        break;
      }
      let map = entry.to_map();
      note_samples.push(json!({
        "key": note_key,
        "id": map.as_ref().and_then(|m| m.get("id")).as_ref().and_then(|v| any_str(v)),
        "title": map.as_ref().and_then(|m| m.get("title")).as_ref().and_then(|v| any_str(v)),
      }));
    }
  }

  let mut labels = Vec::new();
  if let Some(labels_array) = labels_array.as_ref() {
    for v in labels_array.iter() {
      if let Some(s) = any_str(&v) {
        labels.push(s);
      }
    }
  }

  Ok(json!({
    "hasMetaDoc": true,
    "snapshotBytes": snapshot.len(),
    "notes": notes_map.as_ref().map(|m| m.len()).unwrap_or(0),
    "folders": folders_map.as_ref().map(|m| m.len()).unwrap_or(0),
    "labels": labels,
    "labelColors": label_colors.as_ref().map(|m| m.len()).unwrap_or(0),
    "deletedNotes": deleted_notes.as_ref().map(|m| m.len()).unwrap_or(0),
    "deletedFolders": deleted_folders.as_ref().map(|m| m.len()).unwrap_or(0),
    "noteSamples": note_samples,
  }))
}

fn yjs_table_summary(pool: &crate::db::DbPool) -> Result<Value, AppError> {
  let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
  let mut note_ids = BTreeMap::<String, (usize, usize)>::new();
  {
    let mut stmt = conn
      .prepare("SELECT note_id, length(data) FROM note_content ORDER BY id")
      .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = stmt
      .query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
      })
      .map_err(|e| AppError::Other(e.to_string()))?;
    for row in rows {
      let (note_id, len) = row.map_err(|e| AppError::Other(e.to_string()))?;
      let entry = note_ids.entry(note_id).or_insert((0, 0));
      entry.0 += 1;
      entry.1 += len as usize;
    }
  }

  let mut snapshots = BTreeMap::<String, usize>::new();
  {
    let mut stmt = conn
      .prepare("SELECT note_id, length(data) FROM yjs_snapshots")
      .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = stmt
      .query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
      })
      .map_err(|e| AppError::Other(e.to_string()))?;
    for row in rows {
      let (note_id, len) = row.map_err(|e| AppError::Other(e.to_string()))?;
      snapshots.insert(note_id, len as usize);
    }
  }

  let notes_with_updates: Vec<Value> = note_ids
    .iter()
    .filter(|(k, _)| k.as_str() != "meta")
    .take(10)
    .map(|(k, (count, bytes))| {
      json!({ "noteId": k, "updates": count, "totalBytes": bytes })
    })
    .collect();

  Ok(json!({
    "noteIdsWithUpdates": note_ids.len(),
    "noteSamples": notes_with_updates,
    "metaDoc": note_ids.get("meta").map(|(count, bytes)| json!({ "updates": count, "totalBytes": bytes })),
    "snapshots": snapshots,
  }))
}

#[tauri::command]
#[specta::specta]
pub(crate) fn debug_dump_state(
  app: AppHandle,
  state: State<'_, AppState>,
) -> Result<Value, AppError> {
  let data_pool = data_pool(&app, &state)?;
  let settings_pool = settings_pool(&app, &state)?;

  // Attempt to read the app key so the workspace doc can be decoded. During
  // onboarding encryption may not be configured yet — that is fine, the
  // snapshot will just be reported as undecodable.
  let app_key = state
    .crypto
    .session
    .read()
    .ok()
    .filter(|s| s.active)
    .and_then(|_| current_app_key(&state).ok().flatten());

  let mut settings_flags = BTreeMap::<String, Value>::new();
  for flag in [
    "onboardingCompleted",
    "migration_completed",
    "yjs_content_sync_v2",
    "preview_backfill_done",
    "yjs_migrated",
  ] {
    if let Ok(Some(raw)) = crate::db::db_get(&settings_pool, flag) {
      settings_flags.insert(flag.to_string(), json!(raw));
    }
  }

  Ok(json!({
    "dataStore": kv_summary(&data_pool)?,
    "workspaceDoc": workspace_doc_summary(&data_pool, app_key)?,
    "yjs": yjs_table_summary(&data_pool)?,
    "settingsFlags": settings_flags,
  }))
}
