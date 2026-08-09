use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use tauri::{AppHandle, State};

use crate::shared::*;

/// Extract the current app encryption key, if encryption is active and unlocked.
/// Returns `None` only when encryption is NOT configured (blobs stored in
/// plaintext in that case). When encryption is configured but the items key is
/// not loaded (session not yet unlocked), returns `EncryptionLocked` instead of
/// silently falling back to plaintext: reading ciphertext as plaintext would
/// feed garbage to the Yjs decoder (which aborts on invalid UTF-8), and writing
/// plaintext would interleave plaintext among encrypted rows.
fn yjs_encryption_key(state: &AppState) -> Result<Option<[u8; 32]>, AppError> {
  let session = state.crypto.session.read()?;
  if !session.active {
    return Ok(None);
  }
  Ok(Some(current_app_key(state)?.ok_or(AppError::EncryptionLocked)?))
}

/// Append a single Yjs binary update for a note.  Updates are stored as
/// append-only BLOB rows so every peer's version is preserved.
/// When app encryption is active the blob is encrypted before persisting.
///
/// The update is sent as base64 rather than a JSON number array — multi-KB
/// blobs would otherwise pay a serde_json round-trip on a huge array.
#[tauri::command]
#[specta::specta]
pub(crate) fn yjs_append(
  app: AppHandle,
  note_id: String,
  update: String,
  device: String,
  state: State<'_, AppState>,
) -> Result<(), AppError> {
  let pool = data_pool(&app, &state)?;
  let key = yjs_encryption_key(&state)?;
  let update = BASE64.decode(update.trim())?;
  crate::db::yjs_append(&pool, &note_id, &update, &device, key)?;
  Ok(())
}

/// Return a cached merged Yjs state snapshot for a note when it is fresh
/// (no stored update is newer than the snapshot). Returns an empty vector when
/// the caller must replay history and re-cache it via `yjs_save_snapshot`.
/// Encoded as base64 so the IPC payload is a string, not a JSON number array.
#[tauri::command]
#[specta::specta]
pub(crate) fn yjs_get_snapshot(
  app: AppHandle,
  note_id: String,
  state: State<'_, AppState>,
) -> Result<String, AppError> {
  let pool = data_pool(&app, &state)?;
  let key = yjs_encryption_key(&state)?;
  let result = crate::db::yjs_get_snapshot(&pool, &note_id, key)?;
  Ok(BASE64.encode(result))
}

/// Return the fresh merged Yjs snapshot for many notes in a single round-trip
/// (batched SQL), avoiding N+1 IPC calls. Only requested notes that have data
/// are included in the result map. Snapshots are base64-encoded strings.
#[tauri::command]
#[specta::specta]
pub(crate) fn yjs_get_snapshots(
  app: AppHandle,
  note_ids: Vec<String>,
  state: State<'_, AppState>,
) -> Result<HashMap<String, String>, AppError> {
  let pool = data_pool(&app, &state)?;
  let key = yjs_encryption_key(&state)?;
  let result = crate::db::yjs_get_snapshots(&pool, &note_ids, key)?;
  Ok(
    result
      .into_iter()
      .map(|(id, blob)| (id, BASE64.encode(blob)))
      .collect(),
  )
}

/// Return every stored Yjs update for a note, oldest first.
/// The caller replays them into a Y.Doc to reconstruct the current state.
/// Each update is base64-encoded.
#[tauri::command]
#[specta::specta]
pub(crate) fn yjs_get_updates(
  app: AppHandle,
  note_id: String,
  state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
  let pool = data_pool(&app, &state)?;
  let key = yjs_encryption_key(&state)?;
  let rows = crate::db::yjs_get_updates(&pool, &note_id, key)?;
  Ok(rows.into_iter().map(|(_, blob)| BASE64.encode(blob)).collect())
}

/// Delete all existing updates for a note and replace them with a single
/// compressed Yjs state vector (snapshot).  Keeps the row count bounded.
/// The snapshot is sent as base64.
#[tauri::command]
#[specta::specta]
pub(crate) fn yjs_compact(
  app: AppHandle,
  note_id: String,
  snapshot: String,
  state: State<'_, AppState>,
) -> Result<(), AppError> {
  let pool = data_pool(&app, &state)?;
  let key = yjs_encryption_key(&state)?;
  let snapshot = BASE64.decode(snapshot.trim())?;
  crate::db::yjs_compact(&pool, &note_id, &snapshot, key)?;
  Ok(())
}

/// Delete every Yjs update for a note.  Called when the note itself is deleted.
#[tauri::command]
#[specta::specta]
pub(crate) fn yjs_delete(
  app: AppHandle,
  note_id: String,
  state: State<'_, AppState>,
) -> Result<(), AppError> {
  let pool = data_pool(&app, &state)?;
  crate::db::yjs_delete(&pool, &note_id)?;
  Ok(())
}
