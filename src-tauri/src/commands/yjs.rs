use tauri::{AppHandle, State};

use crate::shared::*;

/// Extract the current app encryption key, if encryption is active and unlocked.
/// Returns `None` when encryption is not configured or is locked (blobs stored
/// in plaintext in that case).
fn yjs_encryption_key(state: &AppState) -> Result<Option<[u8; 32]>, String> {
  let session = state.crypto.read().map_err(to_error)?;
  if !session.active {
    return Ok(None);
  }
  Ok(session.app_data_key)
}

/// Append a single Yjs binary update for a note.  Updates are stored as
/// append-only BLOB rows so every peer's version is preserved.
/// When app encryption is active the blob is encrypted before persisting.
#[tauri::command]
pub(crate) fn yjs_append(
  app: AppHandle,
  note_id: String,
  update: Vec<u8>,
  device: String,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let pool = data_pool(&app, &state)?;
  let key = yjs_encryption_key(&state)?;
  crate::db::yjs_append(&pool, &note_id, &update, &device, key)
}

/// Return a cached merged Yjs state snapshot for a note when it is fresh
/// (no stored update is newer than the snapshot). Returns an empty vector when
/// the caller must replay history and re-cache it via `yjs_save_snapshot`.
#[tauri::command]
pub(crate) fn yjs_get_snapshot(
  app: AppHandle,
  note_id: String,
  state: State<'_, AppState>,
) -> Result<Vec<u8>, String> {
  let pool = data_pool(&app, &state)?;
  let key = yjs_encryption_key(&state)?;
  crate::db::yjs_get_snapshot(&pool, &note_id, key)
}

/// Return every stored Yjs update for a note, oldest first.
/// The caller replays them into a Y.Doc to reconstruct the current state.
#[tauri::command]
pub(crate) fn yjs_get_updates(
  app: AppHandle,
  note_id: String,
  state: State<'_, AppState>,
) -> Result<Vec<Vec<u8>>, String> {
  let pool = data_pool(&app, &state)?;
  let key = yjs_encryption_key(&state)?;
  let rows = crate::db::yjs_get_updates(&pool, &note_id, key)?;
  Ok(rows.into_iter().map(|(_, blob)| blob).collect())
}

/// Delete all existing updates for a note and replace them with a single
/// compressed Yjs state vector (snapshot).  Keeps the row count bounded.
#[tauri::command]
pub(crate) fn yjs_compact(
  app: AppHandle,
  note_id: String,
  snapshot: Vec<u8>,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let pool = data_pool(&app, &state)?;
  let key = yjs_encryption_key(&state)?;
  crate::db::yjs_compact(&pool, &note_id, &snapshot, key)
}

/// Delete every Yjs update for a note.  Called when the note itself is deleted.
#[tauri::command]
pub(crate) fn yjs_delete(
  app: AppHandle,
  note_id: String,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let pool = data_pool(&app, &state)?;
  crate::db::yjs_delete(&pool, &note_id)
}
