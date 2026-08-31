use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use tauri::{AppHandle, State};

use crate::shared::*;

/// Current app encryption key. `None` only when encryption is NOT configured
/// (blobs stored plaintext). When configured but locked, returns
/// `EncryptionLocked` instead of silently falling back to plaintext: reading
/// ciphertext as plaintext feeds garbage to the Yjs decoder, and writing would
/// interleave plaintext among encrypted rows.
fn yjs_encryption_key(state: &AppState) -> Result<Option<[u8; 32]>, AppError> {
    let session = state.crypto.session.read()?;
    if !session.active {
        // Encryption is mandatory (startup init always creates a manifest and sets
        // `active`); reaching this state is a startup bug — fail closed.
        return Err(AppError::EncryptionLocked);
    }
    Ok(Some(
        current_app_key(state)?.ok_or(AppError::EncryptionLocked)?,
    ))
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
        // Mandatory encryption: a never-active session must fail closed —
        // startup init guarantees `active` before any note read/write.
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

/// Append one Yjs binary update for a note as an append-only BLOB row (every
/// peer's version preserved), encrypted when app encryption is active. Runs on
/// a blocking thread; the update crosses IPC as base64 (~3x smaller than the
/// JSON number-array encoding it replaced).
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
    tokio::task::spawn_blocking(move || {
        crate::db::yjs_append(&pool, &note_id, &update, &device, key)
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

/// Append multiple Yjs updates in one IPC call, inside a single SQLite transaction.
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
    tokio::task::spawn_blocking(move || {
        crate::db::yjs_append_batch(&pool, &note_ids, &updates, &devices, key)
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

/// Cached merged Yjs state snapshot when fresh (no stored update newer).
/// Empty string means the caller must replay history and re-cache via
/// `yjs_save_snapshot`. Blocking thread: the stale path replays the whole
/// update history.
#[tauri::command]
#[specta::specta]
pub(crate) async fn yjs_get_snapshot(
    app: AppHandle,
    note_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let pool = data_pool(&app, &state)?;
    let key = yjs_encryption_key(&state)?;
    let result =
        tokio::task::spawn_blocking(move || crate::db::yjs_get_snapshot(&pool, &note_id, key))
            .await
            .map_err(|e| AppError::Other(e.to_string()))??;
    Ok(BASE64.encode(result))
}

/// Fresh merged snapshots for many notes in one round-trip (batched SQL,
/// no N+1 IPC); only notes with data are included. Blocking thread with
/// rayon parallel decrypt inside.
#[tauri::command]
#[specta::specta]
pub(crate) async fn yjs_get_snapshots(
    app: AppHandle,
    note_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<HashMap<String, String>, AppError> {
    let pool = data_pool(&app, &state)?;
    let key = yjs_encryption_key(&state)?;
    let result =
        tokio::task::spawn_blocking(move || crate::db::yjs_get_snapshots(&pool, &note_ids, key))
            .await
            .map_err(|e| AppError::Other(e.to_string()))??;
    Ok(result
        .into_iter()
        .map(|(id, blob)| (id, BASE64.encode(blob)))
        .collect())
}

/// Every stored update for a note, oldest first, for replaying into a Y.Doc.
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
        Ok::<_, AppError>(
            rows.into_iter()
                .map(|(_, blob)| BASE64.encode(blob))
                .collect(),
        )
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
    let result =
        tokio::task::spawn_blocking(move || crate::db::yjs_get_state_vector(&pool, &note_id, key))
            .await
            .map_err(|e| AppError::Other(e.to_string()))??;
    Ok(result
        .map(serde_json::to_value)
        .transpose()?
        .unwrap_or(serde_json::json!({})))
}

/// Replace all updates for a note with a single compressed snapshot,
/// keeping the row count bounded. Blocking thread: rewrites every row and
/// encrypts a multi-MB blob on note switch.
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

/// Merge all updates into one snapshot (y-octo), replace the rows, sync the
/// snapshot cache — all in a single SQLite transaction.
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
