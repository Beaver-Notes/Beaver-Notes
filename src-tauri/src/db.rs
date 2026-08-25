use std::{collections::HashMap, path::Path};

use rayon::prelude::*;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, OptionalExtension};
use serde_json::{Map, Value};
use y_octo::{Doc, StateVector, Update};

use crate::shared::{decrypt_yjs_blob, encrypt_yjs_blob, is_encrypted_yjs_blob, AppError};

pub(crate) type DbPool = Pool<SqliteConnectionManager>;

/// Schema version — increment when tables/indexes change.
/// Must stay in sync with `SCHEMA_VERSION` in the migration function below.
pub(crate) const SCHEMA_VERSION: i64 = 1;

/// DDL for every schema version. Each entry runs all statements from version N
/// to N+1. Add new migrations here and bump `SCHEMA_VERSION` above.
fn migrate(conn: &rusqlite::Connection, from: i64) -> Result<(), AppError> {
    // Version 0 → 1: baseline tables (runs for both fresh and existing DBs).
    if from < 1 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS kv (
              key   TEXT PRIMARY KEY NOT NULL,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS note_content (
              id         INTEGER PRIMARY KEY AUTOINCREMENT,
              note_id    TEXT NOT NULL,
              data       BLOB NOT NULL,
              device     TEXT NOT NULL DEFAULT '',
              created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_note_content_note_id
              ON note_content(note_id);
            CREATE TABLE IF NOT EXISTS yjs_snapshots (
              note_id    TEXT PRIMARY KEY NOT NULL,
              data       BLOB NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_kv_notes_prefix
              ON kv(key);",
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
    }

    // Future migrations go here, e.g.:
    // if from < 2 {
    //     conn.execute_batch("ALTER TABLE kv ADD COLUMN created_at INTEGER; ...")
    //         .map_err(|e| e.to_string())?;
    // }

    Ok(())
}

pub(crate) fn open_pool(path: &Path) -> Result<DbPool, AppError> {
    let _t = crate::shared::speed_log::scope("db.open_pool");
    std::fs::create_dir_all(path.parent().unwrap_or(path))?;
    let manager = SqliteConnectionManager::file(path).with_flags(
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_CREATE,
    );
    let pool = Pool::builder()
        .max_size(4)
        .build(manager)
        .map_err(|e| AppError::Other(e.to_string()))?;
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
        PRAGMA case_sensitive_like = OFF;
        PRAGMA synchronous=NORMAL;
        PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| AppError::Other(e.to_string()))?;

    // Run schema migration
    let current: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap_or(0);
    if current < SCHEMA_VERSION {
        migrate(&conn, current).map_err(|e| AppError::Other(format!("migration v{current}→{SCHEMA_VERSION}: {e}")))?;
        conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
            .map_err(|e| AppError::Other(e.to_string()))?;
    }

    Ok(pool)
}

// ─── Basic KV operations ─────────────────────────────────────────────────────

pub(crate) fn db_get(pool: &DbPool, key: &str) -> Result<Option<String>, AppError> {
    let _t = crate::shared::speed_log::scope("db.db_get");
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    conn.query_row("SELECT value FROM kv WHERE key = ?1", params![key], |row| {
        row.get(0)
    })
    .optional()
    .map_err(|e| AppError::Other(e.to_string()))
}

pub(crate) fn db_set(pool: &DbPool, key: &str, value: &str) -> Result<(), AppError> {
    let _t = crate::shared::speed_log::scope("db.db_set");
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    conn.execute(
        "INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

pub(crate) fn db_has(pool: &DbPool, key: &str) -> Result<bool, AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM kv WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(count > 0)
}

pub(crate) fn db_delete(pool: &DbPool, key: &str) -> Result<(), AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    conn.execute("DELETE FROM kv WHERE key = ?1", params![key])
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

pub(crate) fn db_clear(pool: &DbPool) -> Result<(), AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    conn.execute("DELETE FROM kv", [])
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

pub(crate) fn db_all(pool: &DbPool) -> Result<Map<String, Value>, AppError> {
    let _t = crate::shared::speed_log::scope("db.db_all");
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM kv")
        .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let raw: String = row.get(1)?;
            let value = serde_json::from_str(&raw).unwrap_or(Value::String(raw));
            Ok((key, value))
        })
        .map_err(|e| AppError::Other(e.to_string()))?;

    let mut map = Map::new();
    for row in rows {
        let (key, value) = row.map_err(|e| AppError::Other(e.to_string()))?;
        map.insert(key, value);
    }
    Ok(map)
}

pub(crate) fn db_replace_all(pool: &DbPool, data: Map<String, Value>) -> Result<(), AppError> {
    let mut conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let tx = conn.transaction().map_err(|e| AppError::Other(e.to_string()))?;
    tx.execute("DELETE FROM kv", [])
        .map_err(|e| AppError::Other(e.to_string()))?;

    {
        let mut stmt = tx
            .prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)")
            .map_err(|e| AppError::Other(e.to_string()))?;
        for (key, value) in data {
            let serialized = serde_json::to_string(&value)?;
            stmt.execute(params![key, serialized])
                .map_err(|e| AppError::Other(e.to_string()))?;
        }
    }

    tx.commit().map_err(|e| AppError::Other(e.to_string()))
}

/// Apply a targeted diff: insert/update only rows in `upserts`, delete keys
/// in `deletes`.  Runs in a single transaction so the store is never in an
/// inconsistent intermediate state.
pub(crate) fn db_apply_diff(
    pool: &DbPool,
    upserts: &Map<String, Value>,
    deletes: &[String],
) -> Result<(), AppError> {
    let _t = crate::shared::speed_log::scope("db.db_apply_diff");
    let mut conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let tx = conn.transaction().map_err(|e| AppError::Other(e.to_string()))?;

    if !deletes.is_empty() {
        let placeholders = deletes.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("DELETE FROM kv WHERE key IN ({placeholders})");
        let params: Vec<&dyn rusqlite::types::ToSql> =
            deletes.iter().map(|k| k as &dyn rusqlite::types::ToSql).collect();
        tx.execute(&sql, params.as_slice())
            .map_err(|e| AppError::Other(e.to_string()))?;
    }

    if !upserts.is_empty() {
        let mut stmt = tx
            .prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)")
            .map_err(|e| AppError::Other(e.to_string()))?;
        for (key, value) in upserts {
            let serialized = serde_json::to_string(value)?;
            stmt.execute(params![key, serialized])
                .map_err(|e| AppError::Other(e.to_string()))?;
        }
    }

    tx.commit().map_err(|e| AppError::Other(e.to_string()))
}

// ─── Yjs note-content helpers ─────────────────────────────────────────────────

/// Append a Yjs binary update for a note. The raw update is kept (append-only
/// so every peer's version is preserved). The snapshot cache is NOT folded here:
/// rebuilding it on every write would cost a full decrypt + CRDT merge +
/// re-encrypt of the whole note state per keystroke-flush. Instead
/// `yjs_get_snapshot` rebuilds lazily only when it detects the cached snapshot
/// is stale (any update newer than the snapshot's `updated_at`), so steady-state
/// writes stay O(1) while reads remain O(1) when the snapshot is fresh.
///
/// When `key` is `Some`, the stored blob is encrypted at rest.
pub(crate) fn yjs_append(
    pool: &DbPool,
    note_id: &str,
    blob: &[u8],
    device: &str,
    key: Option<[u8; 32]>,
) -> Result<(), AppError> {
    let _t = crate::shared::speed_log::scope("db.yjs_append");
    // Encrypt the blob for storage (no-op when key is None).
    let stored = match key {
        Some(k) => encrypt_yjs_blob(&k, blob)?,
        None => blob.to_vec(),
    };
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    conn.execute(
        "INSERT INTO note_content (note_id, data, device, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![note_id, stored, device, chrono::Utc::now().timestamp_millis()],
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

/// Return all Yjs updates for a note, ordered by insertion.
/// Kept for backwards compatibility / migration; prefer `yjs_get_snapshot`.
/// When `key` is `Some`, each blob is decrypted before returning.
pub(crate) fn yjs_get_updates(
    pool: &DbPool,
    note_id: &str,
    key: Option<[u8; 32]>,
) -> Result<Vec<(i64, Vec<u8>)>, AppError> {
    let _t = crate::shared::speed_log::scope("db.yjs_get_updates");
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let mut stmt = conn
        .prepare("SELECT id, data FROM note_content WHERE note_id = ?1 ORDER BY id ASC")
        .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = stmt
        .query_map(rusqlite::params![note_id], |row| {
            let id: i64 = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            Ok((id, blob))
        })
        .map_err(|e| AppError::Other(e.to_string()))?;
    let mut result = Vec::new();
    for row in rows {
        let (id, blob) = match row {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[yjs_get_updates] skipping corrupt row: {e}");
                continue;
            }
        };
        match key {
            Some(k) => match decrypt_yjs_blob(&k, &blob) {
                Ok(d) => result.push((id, d)),
                Err(e) => {
                    eprintln!("[yjs_get_updates] skipping undecryptable row {id}: {e}");
                }
            },
            None if is_encrypted_yjs_blob(&blob) => {
                // Encrypted at rest but no key is available: fail closed so the
                // ciphertext is never handed to the Yjs decoder (which aborts on
                // invalid UTF-8) or built into a partial snapshot that would
                // shadow the encrypted rows.
                return Err(AppError::EncryptionLocked);
            }
            None => result.push((id, blob)),
        }
    }
    Ok(result)
}

/// Return a single merged Yjs state snapshot for a note, computed with the
/// `y-octo` CRDT engine (wire-compatible with the JS `yjs` library). The result is
/// cached in `yjs_snapshots`, so reads are O(1) as long as the cached snapshot
/// is fresh (no update newer than it). When the cache is stale — an update was
/// appended since the snapshot was written — it is rebuilt from history once and
/// re-cached. When `key` is `Some`, the snapshot is decrypted before return.
pub(crate) fn yjs_get_snapshot(
    pool: &DbPool,
    note_id: &str,
    key: Option<[u8; 32]>,
) -> Result<Vec<u8>, AppError> {
    let _t = crate::shared::speed_log::scope("db.yjs_get_snapshot");
    if let Some((cached, cached_updated_at)) = read_snapshot(pool, note_id)? {
        if !cached.is_empty() && !snapshot_is_stale(pool, note_id, cached_updated_at)? {
            return match key {
                Some(k) => Ok(decrypt_yjs_blob(&k, &cached)?),
                None if is_encrypted_yjs_blob(&cached) => Err(AppError::EncryptionLocked),
                None => Ok(cached),
            };
        }
    }
    let rows = yjs_get_updates(pool, note_id, key)?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    // Defense in depth: `yjs_get_updates` fails closed on encrypted rows without
    // a key, but never hand ciphertext to the Yjs decoder regardless.
    if key.is_none() && rows.iter().any(|(_, blob)| is_encrypted_yjs_blob(blob)) {
        return Err(AppError::EncryptionLocked);
    }
    let mut doc = Doc::new();
    for (_, blob) in rows {
        let update = Update::decode_v1(&blob).map_err(|e| AppError::Other(e.to_string()))?;
        doc.apply_update(update).map_err(|e| AppError::Other(e.to_string()))?;
    }
    let snapshot = doc
        .encode_state_as_update_v1(&StateVector::default())
        .map_err(|e| AppError::Other(e.to_string()))?;
    // Store the snapshot encrypted (write_snapshot handles encryption internally).
    write_snapshot(pool, note_id, &snapshot, key)?;
    Ok(snapshot)
}

/// Return the current Yjs state vector for a note as a JSON object
/// mapping client IDs to their highest clock values.  Returns `None` when
/// the note has no stored data (empty state vector).
pub(crate) fn yjs_get_state_vector(
    pool: &DbPool,
    note_id: &str,
    key: Option<[u8; 32]>,
) -> Result<Option<std::collections::HashMap<String, i64>>, AppError> {
    let _t = crate::shared::speed_log::scope("db.yjs_get_state_vector");
    let rows = yjs_get_updates(pool, note_id, key)?;
    if rows.is_empty() {
        return Ok(None);
    }
    let mut doc = Doc::new();
    for (_, blob) in rows {
        let update = Update::decode_v1(&blob).map_err(|e| AppError::Other(e.to_string()))?;
        doc.apply_update(update).map_err(|e| AppError::Other(e.to_string()))?;
    }
    let sv = doc.get_state_vector();
    let mut map = std::collections::HashMap::new();
    for (client, clock) in sv.iter() {
        map.insert(client.to_string(), *clock as i64);
    }
    Ok(Some(map))
}

/// Return the fresh merged Yjs snapshot for many notes in a single pass
/// (one SQL query for the snapshot cache, one for the latest update timestamp),
/// avoiding the N+1 IPC/SQL round-trips of calling `yjs_get_snapshot` per note.
/// Notes whose cache is stale or missing are rebuilt individually via
/// `yjs_get_snapshot` (rare). When `key` is `Some`, snapshots are decrypted.
pub(crate) fn yjs_get_snapshots(
    pool: &DbPool,
    note_ids: &[String],
    key: Option<[u8; 32]>,
) -> Result<HashMap<String, Vec<u8>>, AppError> {
    let _t = crate::shared::speed_log::scope("db.yjs_get_snapshots");
    let mut result = HashMap::new();
    if note_ids.is_empty() {
        return Ok(result);
    }
    let placeholders = note_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT note_id, data, updated_at FROM yjs_snapshots WHERE note_id IN ({placeholders})"
        ))
        .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(note_ids.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| AppError::Other(e.to_string()))?;
    let snapshots = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Other(e.to_string()))?;

    // Determine which notes have stale or missing snapshots. A note is "stale"
    // when ANY content row — plaintext or encrypted — is newer than the
    // snapshot, or when no snapshot exists at all. Encrypted rows must count:
    // sync-pulled updates are persisted encrypted (yjs_append_batch), so
    // ignoring them would serve forever-stale snapshots on devices that join
    // a vault and receive their content exclusively via sync.
    let stale_query = format!(
        "SELECT DISTINCT nc.note_id FROM note_content nc \
         LEFT JOIN yjs_snapshots ys ON nc.note_id = ys.note_id \
         WHERE nc.note_id IN ({placeholders}) \
           AND (ys.note_id IS NULL OR nc.created_at > ys.updated_at)"
    );
    let mut stmt = conn
        .prepare(&stale_query)
        .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(note_ids.iter()), |row| {
            Ok(row.get::<_, String>(0)?)
        })
        .map_err(|e| AppError::Other(e.to_string()))?;
    let stale_notes: std::collections::HashSet<String> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Other(e.to_string()))?
        .into_iter()
        .collect();

    // Decrypt all cached snapshots in parallel. AES-GCM is independent per
    // blob, so this scales with cores; on a 100+ note vault this is the bulk
    // of the `yjs_get_snapshots` cost.
    let decrypted: Vec<(String, Vec<u8>)> = snapshots
        .par_iter()
        .filter(|(note_id, data, _updated_at)| {
            !data.is_empty() && !stale_notes.contains(note_id) && (key.is_some() || !is_encrypted_yjs_blob(data))
        })
        .map(|(note_id, data, _)| {
            let bytes = match key {
                Some(k) => decrypt_yjs_blob(&k, data)?,
                None => data.clone(),
            };
            Ok((note_id.clone(), bytes))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    for (note_id, bytes) in decrypted {
        result.insert(note_id, bytes);
    }

    // Rebuild stale/missing snapshots individually (rare). A note whose data is
    // encrypted but whose key is unavailable is skipped so one locked note never
    // fails the whole batch.
    for id in note_ids {
        if result.contains_key(id) {
            continue;
        }
        match yjs_get_snapshot(pool, id, key) {
            Ok(snapshot) if !snapshot.is_empty() => {
                result.insert(id.clone(), snapshot);
            }
            Ok(_) => {}
            Err(AppError::EncryptionLocked) => {
                eprintln!("[yjs_get_snapshots] skipping locked note {id}");
            }
            Err(e) => return Err(e),
        }
    }
    Ok(result)
}

/// Replace all updates for a note with a single compressed snapshot, and keep
/// the merged `yjs_snapshots` cache in sync with it. When `key` is `Some`,
/// the stored snapshot is encrypted.
pub(crate) fn yjs_compact(
    pool: &DbPool,
    note_id: &str,
    snapshot: &[u8],
    key: Option<[u8; 32]>,
) -> Result<(), AppError> {
    let _t = crate::shared::speed_log::scope("db.yjs_compact");
    // Encrypt the snapshot for storage.
    let stored = match key {
        Some(k) => encrypt_yjs_blob(&k, snapshot)?,
        None => snapshot.to_vec(),
    };
    let mut conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let tx = conn.transaction().map_err(|e| AppError::Other(e.to_string()))?;
    tx.execute(
        "DELETE FROM note_content WHERE note_id = ?1",
        rusqlite::params![note_id],
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    tx.execute(
        "INSERT INTO note_content (note_id, data, device, created_at) VALUES (?1, ?2, '', ?3)",
        rusqlite::params![note_id, stored, chrono::Utc::now().timestamp_millis()],
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    tx.commit().map_err(|e| AppError::Other(e.to_string()))?;
    write_snapshot(pool, note_id, snapshot, key)?;
    Ok(())
}

/// Read every stored update for `note_id`, merge them into a single snapshot
/// using the `y-octo` CRDT engine, replace the old rows with one compacted
/// row, and keep the `yjs_snapshots` cache in sync — all inside a single
/// SQLite transaction so the database is never in an inconsistent state.
/// When `key` is `Some`, both the stored snapshot and the single row are
/// encrypted at rest.
pub(crate) fn yjs_compact_batch(
    pool: &DbPool,
    note_id: &str,
    key: Option<[u8; 32]>,
) -> Result<(), AppError> {
    let _t = crate::shared::speed_log::scope("db.yjs_compact_batch");
    let rows = yjs_get_updates(pool, note_id, key)?;
    if rows.is_empty() {
        return Ok(());
    }
    let mut doc = Doc::new();
    for (_, blob) in &rows {
        let update = Update::decode_v1(blob).map_err(|e| AppError::Other(e.to_string()))?;
        doc.apply_update(update)
            .map_err(|e| AppError::Other(e.to_string()))?;
    }
    let snapshot = doc
        .encode_state_as_update_v1(&StateVector::default())
        .map_err(|e| AppError::Other(e.to_string()))?;
    // Encrypt the snapshot for storage.
    let stored = match key {
        Some(k) => encrypt_yjs_blob(&k, &snapshot)?,
        None => snapshot.to_vec(),
    };
    let mut conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let tx = conn.transaction().map_err(|e| AppError::Other(e.to_string()))?;
    tx.execute(
        "DELETE FROM note_content WHERE note_id = ?1",
        rusqlite::params![note_id],
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    tx.execute(
        "INSERT INTO note_content (note_id, data, device, created_at) VALUES (?1, ?2, '', ?3)",
        rusqlite::params![note_id, stored, chrono::Utc::now().timestamp_millis()],
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    tx.commit()
        .map_err(|e| AppError::Other(e.to_string()))?;
    // Update the snapshot cache.
    write_snapshot(pool, note_id, &snapshot, key)?;
    Ok(())
}

/// Append multiple Yjs binary updates for different notes in a single SQLite
/// transaction. Each entry in the parallel arrays is inserted into `note_content`.
/// Returns the number of rows inserted.
pub(crate) fn yjs_append_batch(
    pool: &DbPool,
    note_ids: &[String],
    updates: &[Vec<u8>],
    devices: &[String],
    key: Option<[u8; 32]>,
) -> Result<usize, AppError> {
    let _t = crate::shared::speed_log::scope("db.yjs_append_batch");
    if note_ids.len() != updates.len() || note_ids.len() != devices.len() {
        return Err(AppError::Other("yjs_append_batch: array length mismatch".into()));
    }
    let mut conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let tx = conn.transaction().map_err(|e| AppError::Other(e.to_string()))?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO note_content (note_id, data, device, created_at) VALUES (?1, ?2, ?3, ?4)",
            )
            .map_err(|e| AppError::Other(e.to_string()))?;
        let now = chrono::Utc::now().timestamp_millis();
        for i in 0..note_ids.len() {
            let stored = match key {
                Some(k) => encrypt_yjs_blob(&k, &updates[i])?,
                None => updates[i].clone(),
            };
            stmt.execute(rusqlite::params![
                note_ids[i],
                stored,
                devices[i],
                now,
            ])
            .map_err(|e| AppError::Other(e.to_string()))?;
        }
    }
    tx.commit().map_err(|e| AppError::Other(e.to_string()))?;
    Ok(updates.len())
}

/// Delete all Yjs updates for a note. Called when the note itself is deleted.
pub(crate) fn yjs_delete(pool: &DbPool, note_id: &str) -> Result<(), AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    conn.execute(
        "DELETE FROM note_content WHERE note_id = ?1",
        rusqlite::params![note_id],
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    conn.execute(
        "DELETE FROM yjs_snapshots WHERE note_id = ?1",
        rusqlite::params![note_id],
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

// ─── Yjs snapshot cache helpers (y-octo-backed) ────────────────────────────────

fn read_snapshot(pool: &DbPool, note_id: &str) -> Result<Option<(Vec<u8>, i64)>, AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let mut stmt = conn
        .prepare("SELECT data, updated_at FROM yjs_snapshots WHERE note_id = ?1")
        .map_err(|e| AppError::Other(e.to_string()))?;
    let row = stmt
        .query_row(rusqlite::params![note_id], |r| {
            Ok((r.get::<_, Vec<u8>>(0)?, r.get::<_, i64>(1)?))
        })
        .optional()
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(row)
}

/// True when any stored update for `note_id` is newer than the cached snapshot
/// (`updated_at`), meaning the snapshot must be rebuilt before it can be served.
/// Both plaintext and encrypted rows count: sync-pulled updates are stored
/// encrypted, and excluding them made snapshots permanently stale on devices
/// whose content arrives exclusively via sync.
fn snapshot_is_stale(pool: &DbPool, note_id: &str, snapshot_updated_at: i64) -> Result<bool, AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let latest: Option<Option<i64>> = conn
        .query_row(
            "SELECT MAX(created_at) FROM note_content WHERE note_id = ?1",
            rusqlite::params![note_id],
            |r| r.get::<_, Option<i64>>(0),
        )
        .optional()
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(latest.flatten().is_some_and(|latest| latest > snapshot_updated_at))
}

fn write_snapshot(
    pool: &DbPool,
    note_id: &str,
    data: &[u8],
    key: Option<[u8; 32]>,
) -> Result<(), AppError> {
    let stored = match key {
        Some(k) => encrypt_yjs_blob(&k, data)?,
        None => data.to_vec(),
    };
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    conn.execute(
        "INSERT INTO yjs_snapshots (note_id, data, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(note_id) DO UPDATE SET data = ?2, updated_at = ?3",
        rusqlite::params![note_id, stored, chrono::Utc::now().timestamp_millis()],
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf, time::SystemTime};

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let ts = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock ok")
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{ts}-{}", std::process::id()))
    }

    #[test]
    fn open_pool_sets_busy_timeout() {
        let root = unique_temp_dir("beaver-notes-db-test");
        let _ = fs::create_dir_all(&root);
        let db_path = root.join("data.db");
        let pool = open_pool(&db_path).expect("pool");
        let conn = pool.get().expect("conn");
        let timeout: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .expect("pragma");
        assert_eq!(timeout, 5000, "busy_timeout must be set to avoid SQLITE_BUSY");
        let _ = fs::remove_dir_all(&root);
    }

    fn test_pool(prefix: &str) -> (DbPool, PathBuf) {
        let root = unique_temp_dir(prefix);
        let _ = fs::create_dir_all(&root);
        let pool = open_pool(&root.join("data.db")).expect("pool");
        (pool, root)
    }

    /// A row written plaintext (key unavailable at write time) must be returned
    /// as-is when later read with a key — decrypt passes non-magic blobs through.
    #[test]
    fn plaintext_row_readable_with_key() {
        let (pool, root) = test_pool("beaver-notes-db-plain-read");
        let original = b"plain yjs update bytes".to_vec();
        yjs_append(&pool, "n1", &original, "devA", None).expect("append");
        let rows = yjs_get_updates(&pool, "n1", Some([1u8; 32])).expect("read");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].1, original);
        let _ = fs::remove_dir_all(&root);
    }

    /// A row written encrypted round-trips with the same key, is stored under
    /// the BNY1 magic, and fails closed (never yields ciphertext) without a key.
    #[test]
    fn encrypted_row_roundtrips_and_fails_closed_without_key() {
        let (pool, root) = test_pool("beaver-notes-db-enc-roundtrip");
        let original = b"secret yjs update bytes".to_vec();
        yjs_append(&pool, "n1", &original, "devA", Some([2u8; 32])).expect("append");

        let conn = pool.get().expect("conn");
        let stored: Vec<u8> = conn
            .query_row("SELECT data FROM note_content WHERE note_id = 'n1'", [], |r| r.get(0))
            .expect("row");
        assert!(is_encrypted_yjs_blob(&stored), "row must carry BNY1 magic at rest");

        let rows = yjs_get_updates(&pool, "n1", Some([2u8; 32])).expect("read");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].1, original);

        // Without the key the row cannot be produced; the call must fail closed
        // rather than return ciphertext or silently drop content.
        assert!(matches!(
            yjs_get_updates(&pool, "n1", None),
            Err(AppError::EncryptionLocked)
        ));
        let _ = fs::remove_dir_all(&root);
    }

    /// Plaintext and encrypted rows for the same note coexist and both come
    /// back intact when read with a key (key adopted after some rows were
    /// written — the vault-join timing).
    #[test]
    fn mixed_plaintext_and_encrypted_rows_coexist() {
        let (pool, root) = test_pool("beaver-notes-db-mixed");
        let first = b"pre-key local update".to_vec();
        let second = b"post-key synced update".to_vec();
        yjs_append(&pool, "n1", &first, "devB", None).expect("append plain");
        yjs_append(&pool, "n1", &second, "devB", Some([3u8; 32])).expect("append enc");

        let rows = yjs_get_updates(&pool, "n1", Some([3u8; 32])).expect("read");
        assert_eq!(rows.len(), 2, "both rows must survive a keyed read");
        assert_eq!(rows[0].1, first);
        assert_eq!(rows[1].1, second);
        let _ = fs::remove_dir_all(&root);
    }

    /// Regression: updates persisted ENCRYPTED by the sync engine after a
    /// snapshot was cached must invalidate that snapshot. Ignoring encrypted
    /// rows made restarts serve the pre-sync (empty) meta snapshot forever.
    #[test]
    fn encrypted_rows_invalidate_cached_snapshot() {
        let (pool, root) = test_pool("beaver-notes-db-stale-enc");
        let key = [4u8; 32];
        write_snapshot(&pool, "meta", b"cached state", Some(key)).expect("cache snapshot");
        let cached_at = latest_snapshot_updated_at(&pool, "meta");

        // Simulate sync pulling a later update (encrypted, newer than the cache).
        std::thread::sleep(std::time::Duration::from_millis(15));
        yjs_append(&pool, "meta", b"second synced update", "devB", Some(key)).expect("append");

        assert!(
            snapshot_is_stale(&pool, "meta", cached_at).expect("stale"),
            "encrypted rows newer than the snapshot must mark it stale"
        );

        // Plaintext rows must keep counting too (pre-existing contract).
        write_snapshot(&pool, "n2", b"cached state", Some(key)).expect("cache snapshot 2");
        let cached_at2 = latest_snapshot_updated_at(&pool, "n2");
        std::thread::sleep(std::time::Duration::from_millis(15));
        yjs_append(&pool, "n2", b"local update", "devA", None).expect("append plain");
        assert!(snapshot_is_stale(&pool, "n2", cached_at2).expect("stale plain"));
        let _ = fs::remove_dir_all(&root);
    }

    fn latest_snapshot_updated_at(pool: &DbPool, note_id: &str) -> i64 {
        let conn = pool.get().expect("conn");
        conn.query_row(
            "SELECT updated_at FROM yjs_snapshots WHERE note_id = ?1",
            rusqlite::params![note_id],
            |r| r.get(0),
        )
        .expect("snapshot row")
    }
}
