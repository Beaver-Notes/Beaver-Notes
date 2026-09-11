use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::merge::{covered_by_vector, load_vector, refresh_vector};
use crate::db::{self, DbPool};
use crate::shared::{
    SyncEnvelope, PROTOCOL_VERSION, SYNC_PAYLOAD_VERSION, aead_decrypt_bytes, aead_decrypt_json,
    aead_encrypt_bytes, assert_path_access, current_app_key, data_pool, decrypt_yjs_blob,
    generate_key_id, AppError, AppState,
};

/// Wire format (mirrors JS `YJS_UPDATE_EXT` + `FILENAME_SEP` in `sync-yjs.js`):
/// `{noteId}~~{device}~~{ts}[~~{seq}].yjs.json` + snapshots
/// `{doc}~~snapshot~~{device}~~{ts}.yjs.json`. `BeaverNotesSync/commits` mirrors
/// JS `SYNC_ROOT_DIR`/`COMMITS_DIR`.
const UPDATE_EXT: &str = ".yjs.json";
const SEP: &str = "~~";
const SYNC_ROOT: &str = "BeaverNotesSync";
const COMMITS_DIR: &str = "commits";

const DEVICE_ID_KEY: &str = "sync:local:device-id";

#[derive(Clone, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalStats {
    pub(crate) pulled: u64,
    pub(crate) pushed: u64,
    pub(crate) pending_icloud: u64,
}

#[derive(Serialize, Deserialize, Clone, Copy, Default)]
struct ReadCursor {
    ts: u64,
    seq: u64,
}

/// Parsed sync filename (mirrors JS `parseSyncFilename` in `sync-yjs.js`):
/// update `{note}~~{device}~~{ts}[~~{seq}]`, snapshot `{doc}~~snapshot~~{device}~~{ts}`.
/// Legacy 3-part updates default `seq` to 0.
pub struct ParsedCommit {
    pub note: String,
    pub device: String,
    pub ts: u64,
    pub seq: u64,
    pub is_snapshot: bool,
}

/// Parse update, legacy 3-part (seq=0), and snapshot names. Anything else
/// (`notes.json`, wrong ext, empty segments, path separators) → None.
pub fn parse_sync_filename(name: &str) -> Option<ParsedCommit> {
    if name.contains('/') || name.contains('\\') {
        return None;
    }
    let stem = name.strip_suffix(UPDATE_EXT)?;
    let parts: Vec<&str> = stem.split(SEP).collect();
    match parts.len() {
        3 => {
            let (note, device, ts) = (parts[0], parts[1], parts[2]);
            if note.is_empty() || device.is_empty() {
                return None;
            }
            Some(ParsedCommit {
                note: note.to_string(),
                device: device.to_string(),
                ts: ts.parse().ok()?,
                seq: 0,
                is_snapshot: false,
            })
        }
        4 if parts[1] == "snapshot" => {
            let (doc, device, ts) = (parts[0], parts[2], parts[3]);
            if doc.is_empty() || device.is_empty() {
                return None;
            }
            Some(ParsedCommit {
                note: doc.to_string(),
                device: device.to_string(),
                ts: ts.parse().ok()?,
                seq: 0,
                is_snapshot: true,
            })
        }
        4 => {
            let (note, device, ts, seq) = (parts[0], parts[1], parts[2], parts[3]);
            if note.is_empty() || device.is_empty() {
                return None;
            }
            Some(ParsedCommit {
                note: note.to_string(),
                device: device.to_string(),
                ts: ts.parse().ok()?,
                seq: seq.parse().ok()?,
                is_snapshot: false,
            })
        }
        _ => None,
    }
}

/// Legacy tuple wrapper (kept for `cloud.rs`): updates incl. 3-part → Some,
/// snapshots and anything else → None (cloud skips snapshots via `~~snapshot~~`).
pub fn parse_commit_filename(name: &str) -> Option<(String, String, u64, u64)> {
    let p = parse_sync_filename(name)?;
    if p.is_snapshot {
        return None;
    }
    Some((p.note, p.device, p.ts, p.seq))
}

fn ckpt_key(note_id: &str) -> String {
    format!("sync:local:ckpt:{note_id}")
}

fn pushed_key(note_id: &str) -> String {
    format!("sync:local:pushed:{note_id}")
}

fn wseq_key(note_id: &str) -> String {
    format!("sync:local:wseq:{note_id}")
}

fn load_cursor(pool: &DbPool, note_id: &str) -> (u64, u64) {
    db::db_get(pool, &ckpt_key(note_id), None)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<ReadCursor>(&s).ok())
        .map(|c| (c.ts, c.seq))
        .unwrap_or((0, 0))
}

fn store_cursor(pool: &DbPool, note_id: &str, ts: u64, seq: u64) -> Result<(), AppError> {
    db::db_set(
        pool,
        &ckpt_key(note_id),
        &serde_json::to_string(&ReadCursor { ts, seq })?,
        None,
    )
}

/// Stable device id for `~~` filenames. Task 6 moves this beside key material;
/// until then a kv-persisted id replaces the JS `localStorage` deviceId.
fn local_device_id(pool: &DbPool) -> Result<String, AppError> {
    if let Some(id) = db::db_get(pool, DEVICE_ID_KEY, None)? {
        if !id.trim().is_empty() {
            return Ok(id);
        }
    }
    let id = generate_key_id();
    db::db_set(pool, DEVICE_ID_KEY, &id, None)?;
    Ok(id)
}

/// Fail-closed envelope decrypt (mirrors JS `decryptJSON` + AAD
/// `{noteId}-{ts}`, snapshot variant `{docId}-snapshot-{ts}`). Only v4/v5
/// envelopes; plaintext or unknown versions → None, never appended.
fn decrypt_commit(
    key: &[u8; 32],
    raw: &[u8],
    file_note: &str,
    ts: u64,
    is_snapshot: bool,
) -> Option<(String, String, Vec<u8>)> {
    let env: serde_json::Value = serde_json::from_slice(raw).ok()?;
    let v = env.get("v")?.as_u64()? as u8;
    let aad = if is_snapshot {
        format!("{file_note}-snapshot-{ts}")
    } else {
        format!("{file_note}-{ts}")
    };
    if v == SYNC_PAYLOAD_VERSION {
        let update = aead_decrypt_bytes(key, env.get("iv")?.as_str()?, env.get("enc")?.as_str()?, &aad).ok()?;
        let meta = env.get("meta")?;
        let device = meta.get("device")?.as_str()?;
        let note = meta
            .get("noteId")
            .and_then(|n| n.as_str())
            .filter(|n| !n.is_empty())
            .unwrap_or(file_note);
        Some((note.to_string(), device.to_string(), update))
    } else if v == PROTOCOL_VERSION {
        let legacy = SyncEnvelope {
            v,
            iv: env.get("iv")?.as_str()?.to_string(),
            enc: env.get("enc")?.as_str()?.to_string(),
        };
        let value = aead_decrypt_json(key, &legacy, &aad).ok()?;
        let device = value.get("device")?.as_str()?;
        let note = value
            .get("noteId")
            .and_then(|n| n.as_str())
            .filter(|n| !n.is_empty())
            .unwrap_or(file_note);
        let bytes: Vec<u8> = value
            .get("update")?
            .as_array()?
            .iter()
            .filter_map(|n| n.as_u64().map(|u| u as u8))
            .collect();
        Some((note.to_string(), device.to_string(), bytes))
    } else {
        None
    }
}

fn resolve_commits_dir(folder_id: &str) -> Result<PathBuf, AppError> {
    if folder_id.starts_with("scoped:") {
        // Scoped-storage handles have no filesystem path; the JS
        // prefetchSyncDir warm path owns them until the scheduler task wires
        // native warm through the plugin. Explicit error beats silent no-op.
        return Err(AppError::Other(
            "sync: scoped-storage folders sync via JS prefetch; pass a filesystem sync path".into(),
        ));
    }
    let base = PathBuf::from(folder_id);
    // Accept the user-selected sync folder or the commits dir itself.
    if base.file_name().is_some_and(|n| n == COMMITS_DIR) {
        Ok(base)
    } else {
        Ok(base.join(SYNC_ROOT).join(COMMITS_DIR))
    }
}

fn write_file_sync(dir: &Path, name: &str, bytes: &[u8]) -> std::io::Result<()> {
    // Task 6 upgrades this to atomic tmp+rename; direct write + fsync for v1.
    let mut f = fs::File::create(dir.join(name))?;
    f.write_all(bytes)?;
    f.sync_all()?;
    Ok(())
}

fn run_cycle(app: &AppHandle, folder_id: &str) -> Result<LocalStats, AppError> {
    let state = app.state::<AppState>();
    let pool = data_pool(app, state.inner())?;
    // Fail closed when locked, mirroring commands::yjs `yjs_encryption_key`.
    let key = current_app_key(state.inner())?.ok_or(AppError::EncryptionLocked)?;

    let base = PathBuf::from(folder_id);
    assert_path_access(app, state.inner(), &base, "sync")?;
    let dir = resolve_commits_dir(folder_id)?;
    fs::create_dir_all(&dir)?;
    assert_path_access(app, state.inner(), &dir, "sync")?;

    let device = local_device_id(&pool)?;
    let mut stats = LocalStats::default();
    let mut pulled_notes: Vec<String> = Vec::new();

    // Pull: single read_dir, parse ~~ names, skip own device + at/below
    // per-note checkpoint, apply oldest-first. Snapshots (seq 0) decrypt with
    // the snapshot AAD variant and append via the same yjs_append path.
    let mut incoming: Vec<(String, u64, u64, bool, String)> = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let name = entry?.file_name().to_string_lossy().to_string();
        let Some(p) = parse_sync_filename(&name) else {
            continue;
        };
        if p.device == device {
            continue;
        }
        let (cts, cseq) = load_cursor(&pool, &p.note);
        if (p.ts, p.seq) <= (cts, cseq) {
            continue;
        }
        incoming.push((p.note, p.ts, p.seq, p.is_snapshot, name));
    }
    incoming.sort_by_key(|e| (e.1, e.2));
    for (note, ts, seq, is_snapshot, name) in incoming {
        let raw = match fs::read(dir.join(&name)) {
            Ok(b) => b,
            // Evicted iCloud placeholder or raced delete: skip this tick, retry next.
            Err(_) => {
                stats.pending_icloud += 1;
                continue;
            }
        };
        let Some((note_id, from_device, update)) =
            decrypt_commit(&key, &raw, &note, ts, is_snapshot)
        else {
            continue;
        };
        // Re-check under the envelope note id (normally == filename note) so a
        // mismatched file can never append the same update twice.
        let (cts, cseq) = load_cursor(&pool, &note_id);
        if (ts, seq) <= (cts, cseq) {
            continue;
        }
        // Vector gate: content our `sync:vec:{note}` already covers (replayed
        // file, rewritten same-ts commit) skips the append; the cursor still
        // advances so the file is never re-read. No vector → append as usual.
        if let Some(stored) = load_vector(&pool, &note_id) {
            if covered_by_vector(std::slice::from_ref(&update), &stored) {
                store_cursor(&pool, &note_id, ts, seq)?;
                continue;
            }
        }
        db::yjs_append(&pool, &note_id, &update, &from_device, Some(key))?;
        store_cursor(&pool, &note_id, ts, seq)?;
        stats.pulled += 1;
        pulled_notes.push(note_id);
    }
    // Vectors refresh once per touched note (not per file) after append.
    pulled_notes.sort();
    pulled_notes.dedup();
    for note in &pulled_notes {
        if let Err(e) = refresh_vector(&pool, note, Some(key)) {
            crate::rs_log!("[sync::local] vector refresh skipped: {e}");
        }
    }

    // Push: rows newer than the per-note pushed cursor, one ~~ file each.
    let notes: Vec<String> = {
        let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
        let mut stmt = conn
            .prepare("SELECT DISTINCT note_id FROM note_content")
            .map_err(|e| AppError::Other(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| AppError::Other(e.to_string()))?;
        let notes: Result<Vec<String>, _> = rows.collect();
        notes.map_err(|e| AppError::Other(e.to_string()))?
    };
    let now_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    for note in notes {
        // v1 assumes app-generated ids (UUIDs): no ~~ or separators, so the
        // filename round-trips. Skip anything else rather than escape the dir.
        if note.contains(SEP) || note.contains('/') || note.contains('\\') {
            crate::rs_log!("[sync::local] skipping note id unsafe for ~~ filenames");
            continue;
        }
        let mut since: i64 = db::db_get(&pool, &pushed_key(&note), None)?
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let rows: Vec<(i64, Vec<u8>)> = {
            let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
            let mut stmt = conn
                .prepare("SELECT id, data FROM note_content WHERE note_id = ?1 AND id > ?2 ORDER BY id ASC")
                .map_err(|e| AppError::Other(e.to_string()))?;
            let mapped = stmt
                .query_map(rusqlite::params![note, since], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .map_err(|e| AppError::Other(e.to_string()))?;
            let rows: Result<Vec<(i64, Vec<u8>)>, _> = mapped.collect();
            rows.map_err(|e| AppError::Other(e.to_string()))?
        };
        for (id, stored) in rows {
            let update = match decrypt_yjs_blob(&key, &stored) {
                Ok(u) => u,
                Err(e) => {
                    crate::rs_log!("[sync::local] skipping undecryptable row: {e}");
                    continue;
                }
            };
            if update.is_empty() {
                since = id;
                continue;
            }
            let wseq: u64 = db::db_get(&pool, &wseq_key(&note), None)?
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            let seq = wseq.wrapping_add(1);
            let aad = format!("{note}-{now_ms}");
            let meta = serde_json::json!({
                "device": device,
                "ts": now_ms as i64,
                "sequence": seq as i64,
                "noteId": note,
            });
            let (iv, enc) = aead_encrypt_bytes(&key, &update, &aad)?;
            let envelope = serde_json::json!({
                "v": SYNC_PAYLOAD_VERSION,
                "meta": meta,
                "iv": iv,
                "enc": enc,
            });
            let name = format!("{note}{SEP}{device}{SEP}{now_ms}{SEP}{seq}{UPDATE_EXT}");
            match write_file_sync(&dir, &name, serde_json::to_string(&envelope)?.as_bytes()) {
                Ok(()) => {
                    db::db_set(&pool, &wseq_key(&note), &seq.to_string(), None)?;
                    since = id;
                    stats.pushed += 1;
                }
                // Disk/iCloud pressure: keep the cursor, retry next tick.
                Err(_) => {
                    stats.pending_icloud += 1;
                    break;
                }
            }
        }
        db::db_set(&pool, &pushed_key(&note), &since.to_string(), None)?;
    }

    Ok(stats)
}

/// One local-folder sync cycle: pull new `~~` commits into SQLite, push dirty
/// rows as new `~~` files + fsync, advance per-note checkpoints. iCloud
/// placeholders that fail to read are counted as `pendingIcloud` and retried
/// next tick; the cycle never blocks on downloads.
#[tauri::command]
#[specta::specta]
pub(crate) async fn sync_local_cycle(
    app: AppHandle,
    folder_id: String,
) -> Result<LocalStats, AppError> {
    tokio::task::spawn_blocking(move || run_cycle(&app, &folder_id))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

#[cfg(test)]
mod tests {
    #[test]
    fn parse_commit_filename() {
        let p = super::parse_commit_filename("abc~~dev1~~1700000000~~7.yjs.json").unwrap();
        assert_eq!(p.0, "abc");
        assert_eq!(p.1, "dev1");
        assert_eq!(p.2, 1700000000);
        assert_eq!(p.3, 7);
        assert!(super::parse_commit_filename("notes.json").is_none());
    }

    #[test]
    fn parse_legacy_3part_defaults_seq_0() {
        let p = super::parse_sync_filename("abc~~dev1~~1700000000.yjs.json").unwrap();
        assert_eq!(p.note, "abc");
        assert_eq!(p.device, "dev1");
        assert_eq!(p.ts, 1700000000);
        assert_eq!(p.seq, 0);
        assert!(!p.is_snapshot);
    }

    #[test]
    fn parse_snapshot_flag() {
        let p =
            super::parse_sync_filename("abc~~snapshot~~dev1~~1700000000.yjs.json").unwrap();
        assert_eq!(p.note, "abc");
        assert_eq!(p.device, "dev1");
        assert_eq!(p.ts, 1700000000);
        assert!(p.is_snapshot);
        assert!(super::parse_sync_filename("notes.json").is_none());
    }
}
