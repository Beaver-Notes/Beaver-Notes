use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use tauri::{AppHandle, Manager};
use yrs::{
    updates::{decoder::Decode, encoder::Encode},
    Doc, ReadTxn, StateVector, Transact, Update,
};

use crate::db::{self, DbPool};
use crate::shared::{AppError, AppState, current_app_key, data_pool};
use super::cloud::CloudFail;

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
    // ponytail: pure clock-range comparison — never apply-to-empty-doc. Structs
    // with unmet dependencies park in the txn pending queue and never reach
    // the state vector, so the old check called diff updates with novel clocks
    // "covered" and skipped them forever (this killed meta sync: every
    // workspace-doc diff landed fully in pending). A candidate is novel when
    // it overlaps stored clocks (extends) OR starts beyond the stored tip
    // (lower bound exceeds stored — catches non-overlapping diffs, which
    // extends() alone misses).
    let stored = StateVector::decode_v1(stored_vector).unwrap_or_default();
    for raw in candidates {
        match Update::decode_v1(raw) {
            Ok(u) => {
                if u.extends(&stored) {
                    return false;
                }
                let lower = u.state_vector_lower();
                if lower.iter().any(|(c, k)| stored.get(c) < *k) {
                    return false;
                }
            }
            // Undecodable bytes must NOT be treated as covered: an
            // authentic-but-corrupt candidate would otherwise be skipped and
            // its checkpoint advanced, losing it permanently (finding C11).
            Err(_) => return false,
        }
    }
    true
}

fn vector_key(note_id: &str) -> String {
    format!("sync:vec:{note_id}")
}

/// Best-effort one-line summary of a coverage decision, for logs. Never fails.
/// Shows stored vs incoming client clocks plus how many candidate updates
/// decoded — a covered-skip with failed=1/decoded=0 is the vacuous-truth hole.
pub(crate) fn describe_coverage(candidates: &[Vec<u8>], stored_vector: &[u8]) -> String {
    let stored = StateVector::decode_v1(stored_vector).unwrap_or_default();
    let mut stored_parts: Vec<String> =
        stored.iter().map(|(c, k)| format!("{c}:{k}")).collect();
    stored_parts.sort();
    let doc = Doc::new();
    let mut txn = doc.transact_mut();
    let (mut n_ok, mut n_err) = (0, 0);
    let (mut n_empty, mut n_apply_err) = (0, 0);
    let mut first_apply_err = String::new();
    for raw in candidates {
        match Update::decode_v1(raw) {
            Ok(u) => {
                n_ok += 1;
                if u.is_empty() {
                    n_empty += 1;
                }
                if let Err(e) = txn.apply_update(u) {
                    n_apply_err += 1;
                    if first_apply_err.is_empty() {
                        first_apply_err = e.to_string();
                    }
                }
            }
            Err(_) => n_err += 1,
        }
    }
    let mut incoming: Vec<String> =
        txn.state_vector().iter().map(|(c, k)| format!("{c}:{k}")).collect();
    incoming.sort();
    format!(
        "stored=[{}] incoming=[{}] decoded={n_ok} failed={n_err} empty={n_empty} apply_err={n_apply_err} {first_apply_err}",
        stored_parts.join(","),
        incoming.join(",")
    )
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

/// Fold a note's whole local update log into one merged row. Shared by the
/// manual `sync_compact_note` command and the scheduler's threshold pass; a
/// locked vault fails with `EncryptionLocked` and the caller retries later.
pub(crate) async fn compact_note(app: AppHandle, note_id: String) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let pool = data_pool(&app, state.inner())?;
    let key = {
        let session = state.crypto.session.read()?;
        if !session.active {
            return Err(AppError::EncryptionLocked);
        }
        current_app_key(state.inner())?.ok_or(AppError::EncryptionLocked)?
    };
    let shared = crate::shared::shared_note_keys(state.inner()).unwrap_or_default();
    let upload_pool = pool.clone();
    let upload_note_in_closure = note_id.clone();
    let upload = tokio::task::spawn_blocking(move || -> Result<Option<((Vec<u8>, u64), i64)>, AppError> {
        let rows = db::yjs_get_updates(&upload_pool, &upload_note_in_closure, Some(key))?;
        if rows.is_empty() {
            return Ok(None);
        }
        // The stored snapshot has to lead the merge: the log rows are usually
        // incremental diffs, and applying them to an empty doc parks every
        // struct in the yrs pending queue, so without the base the merged
        // update would encode an empty state and the compaction would throw
        // the note's history away.
        let mut blobs: Vec<Vec<u8>> = Vec::with_capacity(rows.len() + 1);
        let base = db::yjs_get_snapshot(&upload_pool, &upload_note_in_closure, Some(key))?;
        if !base.is_empty() {
            blobs.push(base);
        }
        blobs.extend(rows.into_iter().map(|(_, b)| b));
        let merged = merge_updates(&blobs);
        db::yjs_compact(&upload_pool, &upload_note_in_closure, &merged, Some(key))?;
        let _ = store_vector(&upload_pool, &upload_note_in_closure, &encode_vector(&[merged.clone()]));
        // `yjs_compact` deleted the old rows, but the pages they occupied only
        // reach the filesystem if auto_vacuum is on and this reclaim runs; it
        // takes no exclusive lock, so it belongs here rather than in a VACUUM.
        // A database still carrying auto_vacuum=NONE in its header makes it a
        // no-op.
        let conn = upload_pool.get().map_err(|e| AppError::Other(e.to_string()))?;
        conn.execute_batch("PRAGMA incremental_vacuum")
            .map_err(|e| AppError::Other(e.to_string()))?;
        // Sealing is post-compaction bookkeeping, so it never fails the
        // compaction either: a note that cannot be sealed simply uploads
        // nothing and keeps its server rows for the next pass.
        let upload = match seal_compaction_snapshot(&upload_pool, &key, &shared, &upload_note_in_closure, &merged) {
            Ok(sealed) => Some((sealed, last_generation(&upload_pool, &upload_note_in_closure))),
            Err(e) => {
                crate::rs_log!("[sync::merge] snapshot seal failed for {upload_note_in_closure}: {e}");
                None
            }
        };
        Ok(upload)
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))??;

    // The upload must not fail the compaction: the local merge is the
    // safety-critical half, and a server that never records the generation only
    // leaves the update rows for a later pass. Detached for the same reason the
    // scheduler compacts off-tick — no network I/O inside the DB closure, and no
    // caller waiting on it.
    if let Some(((sealed, snapshot_ts), last_generation)) = upload {
        let upload_pool = pool.clone();
        let upload_note = note_id.clone();
        tauri::async_runtime::spawn(async move {
            upload_compaction_snapshot(
                upload_pool,
                upload_note,
                last_generation.saturating_add(1),
                snapshot_ts,
                sealed,
            )
            .await;
        });
    }
    Ok(())
}

/// Seal a merged state into the snapshot envelope the server is expected to
/// hand back: `bootstrap_from_snapshots` decrypts exactly this shape, so an
/// unsealed object would be unreadable to every other device. Same key
/// choice and AAD the seeding path uses (`bootstrap.rs`).
fn seal_compaction_snapshot(
    pool: &DbPool,
    key: &[u8; 32],
    shared: &std::collections::HashMap<String, Vec<[u8; 32]>>,
    note_id: &str,
    merged: &[u8],
) -> Result<(Vec<u8>, u64), AppError> {
    let ts = chrono::Utc::now().timestamp_millis().max(0) as u64;
    let device = super::local::get_or_create_device_id(pool)?;
    let (seal, version) = super::bootstrap::snapshot_seal(key, shared, note_id);
    let sealed =
        super::bootstrap::seed_snapshot_envelope_versioned(&seal, version, &device, note_id, ts, merged)?;
    Ok((sealed, ts))
}

fn generation_key(note_id: &str) -> String {
    format!("sync:gen:{note_id}")
}

/// Last generation this client published for a note; 0 when it never has.
/// The server derives its own next generation as `recorded + 1`
/// (Beaver-Sync `jobs/yjs-gc.js:141`), so the client numbers from the same
/// local record rather than a counter the two sides could disagree about: a
/// mismatched generation publishes a key the GC never matches.
fn last_generation(pool: &DbPool, note_id: &str) -> i64 {
    db::db_get(pool, &generation_key(note_id), None)
        .ok()
        .flatten()
        .and_then(|s| s.trim().parse::<i64>().ok())
        .unwrap_or(0)
}

fn store_generation(pool: &DbPool, note_id: &str, generation: i64) {
    let _ = db::db_set(pool, &generation_key(note_id), &generation.to_string(), None);
}

fn fail_str(e: &CloudFail) -> String {
    match e {
        CloudFail::Typed(t) => t.status_str().to_string(),
        CloudFail::Unauthorized => "unauthorized".to_string(),
        CloudFail::Fatal(err) => err.to_string(),
    }
}

/// Tell the server a compaction happened, so its GC job can retire the
/// update rows the merged snapshot supersedes and net the storage quota
/// down. A single promote call (`routes/sync-state.js` /snapshot-promote)
/// records the per-note snapshot generation on a live workspace; the old
/// claim -> snapshot -> complete chain only matched a never-initialized
/// workspace and 409'd on an already-initialized one, so no generation
/// was ever recorded and the GC refund never fired. Best-effort by
/// design: every failure is logged and swallowed. Promote is owner-only
/// on the server, so a non-owner device logs the 403 once and then skips
/// (`OWNER_ONLY_FORBIDDEN` in scheduler.rs) until the identity changes.
async fn upload_compaction_snapshot(
    pool: DbPool,
    note_id: String,
    generation: i64,
    snapshot_ts: u64,
    sealed: Vec<u8>,
) {
    if super::scheduler::owner_only_forbidden() {
        return;
    }
    let Some((workspace_id, server_url, token)) = super::scheduler::cloud_identity() else {
        crate::rs_log!(
            "[sync::merge] snapshot upload skipped for {note_id}: cloud identity unavailable"
        );
        return;
    };
    let Ok(client) = super::remote::CloudClient::new(&server_url, &token) else {
        crate::rs_log!(
            "[sync::merge] snapshot upload skipped for {note_id}: http client unavailable"
        );
        return;
    };
    let promoted: serde_json::Value = match client
        .post_json(
            "/sync/snapshot-promote",
            &serde_json::json!({
                "workspaceId": workspace_id,
                "noteId": note_id,
                "generation": generation,
                "snapshotTs": snapshot_ts,
                "data": BASE64.encode(&sealed),
            }),
        )
        .await
    {
        Ok(promoted) => promoted,
        Err(e) => {
            crate::rs_log!(
                "[sync::merge] snapshot promote failed for {note_id} (generation {generation}): {}",
                fail_str(&e)
            );
            return;
        }
    };
    // Persist the server's authoritative generation. The server may
    // already be ahead when another device compacted first, so storing
    // the recorded value (not the requested one) keeps the next
    // compaction advancing from the true server state.
    let recorded = promoted
        .get("generation")
        .and_then(|g| g.as_i64())
        .unwrap_or(generation);
    store_generation(&pool, &note_id, recorded);
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn sync_compact_note(app: AppHandle, note_id: String) -> Result<(), AppError> {
    compact_note(app, note_id).await
}
#[cfg(test)]
mod tests {
    use yrs::{Doc, ReadTxn, StateVector, Text, Transact};
    use yrs::updates::decoder::Decode;
    use yrs::updates::encoder::Encode;

    use base64::Engine as _;
    use super::{covered_by_vector, encode_vector, merge_updates, BASE64};

    fn seed_update(text: &str) -> Vec<u8> {
        let doc = Doc::new();
        let t = doc.get_or_insert_text("t");
        let mut txn = doc.transact_mut();
        t.insert(&mut txn, 0, text);
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    /// JS↔Rust wire contract: a yjs (JS) update must decode, integrate, and
    /// re-emit through yrs with zero clock loss or gain. Fixture generated by
    /// yjs 13.x with a Text/Map/XmlFragment note doc; regen it with node if
    /// the doc shape changes.
    #[test]
    fn interop_js_update_survives_yrs_merge() {
        let raw = include_str!("fixtures/js_update.b64");
        let js_update = BASE64.decode(raw.trim()).expect("fixture is valid base64");
        assert!(!js_update.is_empty());

        let js_vector = encode_vector(&[js_update.clone()]);
        let merged = merge_updates(&[js_update.clone()]);
        assert!(!merged.is_empty());
        assert!(covered_by_vector(&[merged.clone()], &js_vector));
        assert!(covered_by_vector(&[js_update.clone()], &encode_vector(&[merged.clone()])));

        let title = "Contract title ✓ unicode — naïve café".as_bytes();
        assert!(merged.windows(title.len()).any(|w| w == title));
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

    /// C11: an authentic-but-corrupt candidate (bytes that decrypt fine but are
    /// not a valid yjs update) must not be treated as already covered, or the
    /// pull skips it and advances the checkpoint, losing it forever.
    #[test]
    fn undecodable_candidate_is_not_covered() {
        let stored = encode_vector(&[seed_update("hello")]);
        assert!(!covered_by_vector(
            &[b"authentic but corrupt bytes".to_vec()],
            &stored
        ));
        // A valid, already-covered update still reports covered.
        let update = seed_update("world");
        assert!(covered_by_vector(
            std::slice::from_ref(&update),
            &encode_vector(std::slice::from_ref(&update))
        ));
    }

    /// Regression: an incremental diff whose base structs are missing from an
    /// empty doc parks fully in the txn pending queue. The old apply-to-empty-
    /// doc check read that as "covered" and skipped novel clocks forever
    /// (this killed meta sync). Clock-range comparison must report NOT covered.
    #[test]
    fn incremental_diff_with_missing_base_is_not_covered() {
        let doc = Doc::new();
        let t = doc.get_or_insert_text("t");
        {
            let mut txn = doc.transact_mut();
            t.insert(&mut txn, 0, "hello");
        }
        let sv_after_hello = doc.transact().state_vector().encode_v1();
        {
            let mut txn = doc.transact_mut();
            t.insert(&mut txn, 5, " world");
        }
        let inc = doc
            .transact()
            .encode_state_as_update_v1(
                &StateVector::decode_v1(&sv_after_hello).unwrap(),
            );
        assert!(!covered_by_vector(
            std::slice::from_ref(&inc),
            &StateVector::default().encode_v1()
        ));
    }
}
