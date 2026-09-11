//! yrs-backed CRDT merge + per-note state vectors (Phase 2).
//!
//! Updates stay opaque blobs everywhere else; only this module parses them
//! as Yjs — and only after the envelope decrypt in the pull paths, so
//! non-envelope bytes never reach the decoder (E2EE fail-closed).

// Implementation lands in Step 4; tests first (TDD).

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use tauri::{AppHandle, Manager};
use yrs::{
    updates::{decoder::Decode, encoder::Encode},
    Doc, ReadTxn, StateVector, Transact, Update,
};

use crate::db::{self, DbPool};
use crate::shared::{AppError, AppState, current_app_key, data_pool};

/// Merge updates into one compact update. Dupes collapse; undecodable or
/// unintegrable items are skipped, never fatal (fail-closed pull paths rely
/// on this: one bad blob must not poison the note).
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

/// State vector covering `updates`, v1-encoded. Empty input → empty vector.
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

/// One compact delta: the part of `all` a peer at `remote_vector` is
/// missing. Unparseable vector → full state (fallback, never an error).
/// The caller splits the single item only if it exceeds the 5MB push cap
/// (reuse `chunk_notes` caps); just append it otherwise.
pub fn diff_updates(all: &[Vec<u8>], remote_vector: &[u8]) -> Vec<Vec<u8>> {
    let sv = StateVector::decode_v1(remote_vector).unwrap_or_default();
    let doc = Doc::new();
    let mut txn = doc.transact_mut();
    for raw in all {
        if let Ok(u) = Update::decode_v1(raw) {
            let _ = txn.apply_update(u);
        }
    }
    vec![txn.encode_diff_v1(&sv)]
}

/// True when `candidates` add nothing beyond `stored_vector`: every
/// (client, clock) they cover is already integrated. Lets pull paths drop
/// replayed/duplicated deliveries before touching SQLite; unknown vector →
/// false (keep everything, cursors stay the fallback).
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

pub(crate) fn load_vector(pool: &DbPool, note_id: &str) -> Option<Vec<u8>> {
    db::db_get(pool, &vector_key(note_id), None)
        .ok()
        .flatten()
        .and_then(|s| BASE64.decode(s.trim()).ok())
}

pub(crate) fn store_vector(pool: &DbPool, note_id: &str, vector: &[u8]) -> Result<(), AppError> {
    db::db_set(pool, &vector_key(note_id), &BASE64.encode(vector), None)
}

/// Recompute the stored vector from all rows for `note_id`. Best-effort in
/// pull paths (a stale vector only costs extra bytes next cycle; cursors
/// stay authoritative), so callers log-and-continue on error.
pub(crate) fn refresh_vector(
    pool: &DbPool,
    note_id: &str,
    key: Option<[u8; 32]>,
) -> Result<(), AppError> {
    let rows = db::yjs_get_updates(pool, note_id, key)?;
    let blobs: Vec<Vec<u8>> = rows.into_iter().map(|(_, b)| b).collect();
    store_vector(pool, note_id, &encode_vector(&blobs))
}

/// Compact a note's rows into one merged row via `merge_updates` — the
/// Rust-side replacement for the JS-observe `Y.mergeUpdates` round-trip
/// (`useNoteYjs.js` flush path). JS callers switch to this command instead
/// of shipping rows/snapshots over IPC; no caller restructuring needed.
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

    use super::{diff_updates, encode_vector, merge_updates};

    /// Build a real update: fresh Doc, insert `text` at 0, full-state encode.
    /// Each call is a distinct client, so two seeds merge like two devices.
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
        assert_eq!(merged_once, merged_twice); // dupes collapse
        assert!(!encode_vector(&[merged_once]).is_empty());
    }

    #[test]
    fn diff_returns_only_missing() {
        let a = seed_update("one");
        let b = seed_update("two");
        let v = encode_vector(std::slice::from_ref(&a));
        let missing = diff_updates(&[a.clone(), b.clone()], &v);
        assert_eq!(missing.len(), 1);
        // Semantic equality: merging the delta onto `a` == merging both.
        assert_eq!(
            merge_updates(&[a.clone(), missing[0].clone()]),
            merge_updates(&[a, b])
        );
    }

    #[test]
    fn corrupt_items_skipped_not_fatal() {
        let a = seed_update("hello");
        let merged = merge_updates(&[b"definitely not a yjs update".to_vec(), a.clone()]);
        assert_eq!(merged, merge_updates(std::slice::from_ref(&a)));
        // Garbage vector falls back to full diff, never errors.
        let missing = diff_updates(std::slice::from_ref(&a), b"garbage-vector");
        assert_eq!(merge_updates(&missing), merge_updates(std::slice::from_ref(&a)));
        // `Decode` import is load-bearing: vectors must actually parse.
        assert!(StateVector::decode_v1(&encode_vector(&[a])).is_ok());
    }
}
