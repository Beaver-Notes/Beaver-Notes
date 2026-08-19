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
    // Encryption is mandatory — there is no plaintext mode. `active` is set by
    // the startup init (a manifest is always created), so reaching this state
    // is a startup/init bug and must fail closed rather than write plaintext.
    return Err(AppError::EncryptionLocked);
  }
  Ok(Some(current_app_key(state)?.ok_or(AppError::EncryptionLocked)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn state_with(active: bool, key: Option<[u8; 32]>) -> AppState {
        let state = AppState::new(PathBuf::new(), PathBuf::new(), None);
        {
            let mut session = state.crypto.session.write().expect("session");
            session.active = active;
            session.app_data_key = key;
        }
        state
    }

    #[test]
    fn locked_when_encryption_not_configured() {
        // Encryption is mandatory: a session that never became active must fail
        // closed (no plaintext) — the startup init guarantees `active` is set
        // before any note is read or written.
        let state = state_with(false, None);
        assert!(matches!(
            yjs_encryption_key(&state),
            Err(AppError::EncryptionLocked)
        ));
    }

    #[test]
    fn returns_key_when_active_and_unlocked() {
        let state = state_with(true, Some([7u8; 32]));
        assert_eq!(yjs_encryption_key(&state).unwrap(), Some([7u8; 32]));
    }

    #[test]
    fn locked_when_active_but_key_absent() {
        let state = state_with(true, None);
        assert!(matches!(
            yjs_encryption_key(&state),
            Err(AppError::EncryptionLocked)
        ));
    }
}

/// Append a single Yjs binary update for a note.  Updates are stored as
/// append-only BLOB rows so every peer's version is preserved.
/// When app encryption is active the blob is encrypted before persisting.
/// Dispatched to a blocking thread so AES + SQLite never block the event loop.
/// The update crosses IPC as base64 (Tauri invoke is JSON-only; base64 is
/// ~3x smaller than the JSON number-array encoding this replaced).
#[tauri::command]
#[specta::specta]
pub(crate) async fn yjs_append(
  app: AppHandle,
  note_id: String,
  update: String,
  device: String,
  state: State<'_, AppState>,
) -> Result<(), AppError> {
  let update = BASE64.decode(update)?;
  let pool = data_pool(&app, &state)?;
  let key = yjs_encryption_key(&state)?;
  tokio::task::spawn_blocking(move || crate::db::yjs_append(&pool, &note_id, &update, &device, key))
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

/// Append multiple Yjs binary updates in a single IPC call.
/// All updates are inserted inside one SQLite transaction.
#[tauri::command]
#[specta::specta]
pub(crate) async fn yjs_append_batch(
    app: AppHandle,
    note_ids: Vec<String>,
    updates: Vec<String>,
    devices: Vec<String>,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    let updates = updates
        .into_iter()
        .map(|u| BASE64.decode(u))
        .collect::<Result<Vec<_>, _>>()?;
    let pool = data_pool(&app, &state)?;
    let key = yjs_encryption_key(&state)?;
    tokio::task::spawn_blocking(move || crate::db::yjs_append_batch(&pool, &note_ids, &updates, &devices, key))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

/// Return a cached merged Yjs state snapshot for a note when it is fresh
/// (no stored update is newer than the snapshot). Returns an empty string when
/// the caller must replay history and re-cache it via `yjs_save_snapshot`.
/// Dispatched to a blocking thread: the stale path replays and decrypts the
/// whole update history, which must not block the event loop.
#[tauri::command]
#[specta::specta]
pub(crate) async fn yjs_get_snapshot(
  app: AppHandle,
  note_id: String,
  state: State<'_, AppState>,
) -> Result<String, AppError> {
  let pool = data_pool(&app, &state)?;
  let key = yjs_encryption_key(&state)?;
  let result = tokio::task::spawn_blocking(move || crate::db::yjs_get_snapshot(&pool, &note_id, key))
    .await
    .map_err(|e| AppError::Other(e.to_string()))??;
  Ok(BASE64.encode(result))
}

/// Return the fresh merged Yjs snapshot for many notes in a single round-trip
/// (batched SQL), avoiding N+1 IPC calls. Only requested notes that have data
/// are included in the result map.
/// Dispatched to a blocking thread (rayon parallel decrypt inside).
#[tauri::command]
#[specta::specta]
pub(crate) async fn yjs_get_snapshots(
  app: AppHandle,
  note_ids: Vec<String>,
  state: State<'_, AppState>,
) -> Result<HashMap<String, String>, AppError> {
  let pool = data_pool(&app, &state)?;
  let key = yjs_encryption_key(&state)?;
  let result = tokio::task::spawn_blocking(move || crate::db::yjs_get_snapshots(&pool, &note_ids, key))
    .await
    .map_err(|e| AppError::Other(e.to_string()))??;
  Ok(result.into_iter().map(|(id, blob)| (id, BASE64.encode(blob))).collect())
}

/// Return every stored Yjs update for a note, oldest first.
/// The caller replays them into a Y.Doc to reconstruct the current state.
#[tauri::command]
#[specta::specta]
pub(crate) async fn yjs_get_updates(
  app: AppHandle,
  note_id: String,
  state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
  let pool = data_pool(&app, &state)?;
  let key = yjs_encryption_key(&state)?;
  tokio::task::spawn_blocking(move || {
    let rows = crate::db::yjs_get_updates(&pool, &note_id, key)?;
    Ok::<_, AppError>(rows.into_iter().map(|(_, blob)| BASE64.encode(blob)).collect())
  })
  .await
  .map_err(|e| AppError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn yjs_get_state_vector(
  app: AppHandle,
  note_id: String,
  state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
  let pool = data_pool(&app, &state)?;
  let key = yjs_encryption_key(&state)?;
  let result = tokio::task::spawn_blocking(move || crate::db::yjs_get_state_vector(&pool, &note_id, key))
    .await
    .map_err(|e| AppError::Other(e.to_string()))??;
  Ok(result.map(serde_json::to_value).transpose()?.unwrap_or_default())
}

/// Delete all existing updates for a note and replace them with a single
/// compressed Yjs state vector (snapshot).  Keeps the row count bounded.
/// Dispatched to a blocking thread: rewrites every row + encrypts a multi-MB
/// blob on note switch.
#[tauri::command]
#[specta::specta]
pub(crate) async fn yjs_compact(
  app: AppHandle,
  note_id: String,
  snapshot: String,
  state: State<'_, AppState>,
) -> Result<(), AppError> {
  let snapshot = BASE64.decode(snapshot)?;
  let pool = data_pool(&app, &state)?;
  let key = yjs_encryption_key(&state)?;
  tokio::task::spawn_blocking(move || crate::db::yjs_compact(&pool, &note_id, &snapshot, key))
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

/// Read all updates for a note, merge them into a single snapshot via y-octo,
/// replace the old rows with one compacted row, and keep the snapshot cache in
/// sync — all in a single SQLite transaction.
#[tauri::command]
#[specta::specta]
pub(crate) async fn yjs_compact_batch(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: String,
) -> Result<(), AppError> {
    let pool = data_pool(&app, &state)?;
    let key = yjs_encryption_key(&state)?;
    tokio::task::spawn_blocking(move || crate::db::yjs_compact_batch(&pool, &note_id, key))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

/// Delete every Yjs update for a note.  Called when the note itself is deleted.
#[tauri::command]
#[specta::specta]
pub(crate) async fn yjs_delete(
  app: AppHandle,
  note_id: String,
  state: State<'_, AppState>,
) -> Result<(), AppError> {
  let pool = data_pool(&app, &state)?;
  tokio::task::spawn_blocking(move || crate::db::yjs_delete(&pool, &note_id))
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}
