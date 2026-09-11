use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use tauri::{AppHandle, Manager};
use yrs::{
    updates::{decoder::Decode, encoder::Encode},
    Doc, ReadTxn, StateVector, Transact, Update,
};

use crate::db::{self, DbPool};
use crate::shared::{AppError, AppState, current_app_key, data_pool};

pub fn merge_updates(updates: &[Vec<u8>]) -> Vec<u8> {
    let doc = Doc::new();
    let mut txn = doc.transact_mut();
    for raw in updates {
        if let Ok(u) = Update::decode_v1(raw) {
            let _ = txn.apply_update(u);
        }
    }
    txn.encode_state_as_update_v1(&StateVector::default())
}

pub fn encode_vector(updates: &[Vec<u8>]) -> Vec<u8> {
    let doc = Doc::new();
    let mut txn = doc.transact_mut();
    for raw in updates {
        if let Ok(u) = Update::decode_v1(raw) {
            let _ = txn.apply_update(u);
        }
    }
    txn.state_vector().encode_v1()
}

pub(crate) fn covered_by_vector(candidates: &[Vec<u8>], stored_vector: &[u8]) -> bool {
    let stored = StateVector::decode_v1(stored_vector).unwrap_or_default();
    let doc = Doc::new();
    let mut txn = doc.transact_mut();
    for raw in candidates {
        if let Ok(u) = Update::decode_v1(raw) {
            let _ = txn.apply_update(u);
        }
    }
    txn.state_vector()
        .iter()
        .all(|(client, clock)| stored.get(client) >= *clock)
}

fn vector_key(note_id: &str) -> String {
    format!("sync:vec:{note_id}")
}

pub(crate) fn snapshot_covers_rows(snapshot: &[u8], rows: &[Vec<u8>]) -> bool {
    let rows_sv = {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        for raw in rows {
            match Update::decode_v1(raw) {
                Ok(u) => {
                    if txn.apply_update(u).is_err() {
                        return false;
                    }
                }
                Err(_) => return false,
            }
        }
        txn.state_vector()
    };
    let snap_sv = {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        match Update::decode_v1(snapshot) {
            Ok(u) => {
                if txn.apply_update(u).is_err() {
                    return false;
                }
            }
            Err(_) => return false,
        }
        txn.state_vector()
    };
    rows_sv
        .iter()
        .all(|(client, clock)| snap_sv.get(client) >= *clock)
}

pub(crate) fn load_vector(pool: &DbPool, note_id: &str) -> Option<Vec<u8>> {
    db::db_get(pool, &vector_key(note_id), None)
        .ok()
        .flatten()
        .and_then(|s| BASE64.decode(s.trim()).ok())
}

pub(crate) fn store_vector(pool: &DbPool, note_id: &str, vector: &[u8]) -> Result<(), AppError> {
    db::db_set(pool, &vector_key(note_id), &BASE64.encode(vector), None)
}

pub(crate) fn refresh_vector(
    pool: &DbPool,
    note_id: &str,
    key: Option<[u8; 32]>,
) -> Result<(), AppError> {
    let rows = db::yjs_get_updates(pool, note_id, key)?;
    let blobs: Vec<Vec<u8>> = rows.into_iter().map(|(_, b)| b).collect();
    store_vector(pool, note_id, &encode_vector(&blobs))
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn sync_compact_note(app: AppHandle, note_id: String) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let pool = data_pool(&app, state.inner())?;
    let key = {
        let session = state.crypto.session.read()?;
        if !session.active {
            return Err(AppError::EncryptionLocked);
        }
        current_app_key(state.inner())?.ok_or(AppError::EncryptionLocked)?
    };
    tokio::task::spawn_blocking(move || {
        let rows = db::yjs_get_updates(&pool, &note_id, Some(key))?;
        if rows.is_empty() {
            return Ok(());
        }
        let blobs: Vec<Vec<u8>> = rows.into_iter().map(|(_, b)| b).collect();
        let merged = merge_updates(&blobs);
        db::yjs_compact(&pool, &note_id, &merged, Some(key))?;
        let _ = store_vector(&pool, &note_id, &encode_vector(&[merged]));
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use yrs::{Doc, ReadTxn, StateVector, Text, Transact};
    use yrs::updates::decoder::Decode;

    use super::{encode_vector, merge_updates};

    fn seed_update(text: &str) -> Vec<u8> {
        let doc = Doc::new();
        let t = doc.get_or_insert_text("t");
        let mut txn = doc.transact_mut();
        t.insert(&mut txn, 0, text);
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    #[test]
    fn merge_is_idempotent_and_vector_grows() {
        let a = seed_update("hello");
        let merged_once = merge_updates(&[a.clone(), a.clone()]);
        let merged_twice = merge_updates(&[merged_once.clone(), a.clone()]);
        assert_eq!(merged_once, merged_twice);
        assert!(!encode_vector(&[merged_once]).is_empty());
    }

    #[test]
    fn corrupt_items_skipped_not_fatal() {
        let a = seed_update("hello");
        let merged = merge_updates(&[b"definitely not a yjs update".to_vec(), a.clone()]);
        assert_eq!(merged, merge_updates(std::slice::from_ref(&a)));

        assert!(StateVector::decode_v1(&encode_vector(&[a])).is_ok());
    }
}
