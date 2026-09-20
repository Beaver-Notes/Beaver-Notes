use std::{collections::HashMap, path::Path};

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rayon::prelude::*;
use rusqlite::{params, OptionalExtension};
use serde_json::{Map, Value};
use y_octo::{Doc, StateVector, Update};

use crate::shared::{
    decrypt_yjs_blob, encrypt_yjs_blob, is_encrypted_yjs_blob, ActivityEntry, AppError,
};

pub(crate) type DbPool = Pool<SqliteConnectionManager>;

pub(crate) const SCHEMA_VERSION: i64 = 4;

// ponytail: fixed per-note cap; a note edited for years would otherwise grow
// this table without bound. 200 entries is far more than any UI scroll-back
// needs; if product ever wants full history, page it out to a separate store
// instead of raising the constant.
pub(crate) const ACTIVITY_LOG_MAX_PER_NOTE: usize = 200;

fn migrate(conn: &rusqlite::Connection, from: i64) -> Result<(), AppError> {

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

    // Explicit note-deletion tombstones drive cloud asset pruning. The old
    // device-local liveness inference (`SELECT DISTINCT note_id FROM
    // note_content`) is unsafe against the account-global asset listing: a
    // note this device has not pulled yet looked "dead" and its peer-uploaded
    // assets got deleted. Workspace-scoped asset keys plus these explicit
    // records are the only thing allowed to trigger a remote delete.
    if from < 2 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS deleted_notes (
              note_id      TEXT NOT NULL,
              workspace_id TEXT NOT NULL DEFAULT '',
              deleted_at   INTEGER NOT NULL,
              PRIMARY KEY (note_id, workspace_id)
            );",
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
    }

    // Snapshot freshness watermark. `created_at`/`updated_at` are wall-clock
    // milliseconds, so an append in the same millisecond as a snapshot write
    // was masked by the cached snapshot indefinitely. `src_rowid` records the
    // highest `note_content.id` a snapshot covers; `note_content.id` is
    // AUTOINCREMENT and monotonic, so any later append is always detected
    // (finding C3). Existing rows default to 0 and are rebuilt once.
    if from < 3 {
        conn.execute_batch(
            "ALTER TABLE yjs_snapshots ADD COLUMN src_rowid INTEGER NOT NULL DEFAULT 0;",
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
    }

    // Durable per-note edit/activity log. Plaintext columns: the workspace DB
    // is already encrypted at rest; entries are not secret beyond what the note
    // body already protects (plan §2.2).
    if from < 4 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS activity_log (
              id          TEXT PRIMARY KEY NOT NULL,
              note_id     TEXT NOT NULL,
              actor_id    TEXT,
              actor_label TEXT NOT NULL DEFAULT '',
              kind        TEXT NOT NULL,
              summary     TEXT NOT NULL DEFAULT '',
              at          INTEGER NOT NULL,
              anchor_hint TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_activity_log_note_at
              ON activity_log(note_id, at DESC);",
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
    }

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

    let current: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap_or(0);
    if current < SCHEMA_VERSION {
        migrate(&conn, current)
            .map_err(|e| AppError::Other(format!("migration v{current}→{SCHEMA_VERSION}: {e}")))?;
        conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
            .map_err(|e| AppError::Other(e.to_string()))?;
    }

    Ok(pool)
}

/// Re-encrypt a stored blob from `old_key` to `new_key`. Returns `None` for
/// plaintext rows and for rows that no longer decrypt with `old_key` (already
/// migrated, or foreign), so a retry after a partial failure converges.
fn reencrypt_blob(old_key: &[u8; 32], new_key: &[u8; 32], stored: &[u8]) -> Option<Vec<u8>> {
    if !is_encrypted_yjs_blob(stored) {
        return None;
    }
    let plain = decrypt_yjs_blob(old_key, stored).ok()?;
    encrypt_yjs_blob(new_key, &plain).ok()
}

/// Rows are read in key-ordered batches so peak memory stays bounded no matter
/// how large the database is, while the whole pass still runs in one IMMEDIATE
/// transaction: `synchronous = NORMAL` makes that a single fsync, and an
/// immediate transaction takes the write lock up front instead of losing the
/// lock-upgrade race against a concurrent writer (sync append, autosave).
pub(crate) fn reencrypt_payloads_for_key(
    pool: &DbPool,
    old_key: &[u8; 32],
    new_key: &[u8; 32],
) -> Result<u64, AppError> {
    if old_key == new_key {
        return Ok(0);
    }
    const BATCH: i64 = 1000;
    let err = |e: rusqlite::Error| AppError::Other(e.to_string());
    let mut conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    let mut migrated = 0u64;

    let mut last_rowid = i64::MIN;
    loop {
        let rows: Vec<(i64, Vec<u8>)> = {
            let mut stmt = tx
                .prepare("SELECT rowid, value FROM kv WHERE rowid > ?1 ORDER BY rowid LIMIT ?2")
                .map_err(err)?;
            let mapped = stmt
                .query_map(params![last_rowid, BATCH], |r| {
                    Ok((r.get::<_, i64>(0)?, kv_bytes(r, 1)?))
                })
                .map_err(err)?;
            mapped.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?
        };
        if rows.is_empty() {
            break;
        }
        last_rowid = rows[rows.len() - 1].0;
        let mut update = tx
            .prepare("UPDATE kv SET value = ?1 WHERE rowid = ?2")
            .map_err(err)?;
        for (rowid, stored) in &rows {
            if let Some(next) = reencrypt_blob(old_key, new_key, stored) {
                update.execute(params![next, rowid]).map_err(err)?;
                migrated += 1;
            }
        }
    }

    let mut last_id = i64::MIN;
    loop {
        let rows: Vec<(i64, Vec<u8>)> = {
            let mut stmt = tx
                .prepare(
                    "SELECT id, data FROM note_content WHERE id > ?1 ORDER BY id LIMIT ?2",
                )
                .map_err(err)?;
            let mapped = stmt
                .query_map(params![last_id, BATCH], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?))
                })
                .map_err(err)?;
            mapped.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?
        };
        if rows.is_empty() {
            break;
        }
        last_id = rows[rows.len() - 1].0;
        let mut update = tx
            .prepare("UPDATE note_content SET data = ?1 WHERE id = ?2")
            .map_err(err)?;
        for (id, stored) in &rows {
            if let Some(next) = reencrypt_blob(old_key, new_key, stored) {
                update.execute(params![next, id]).map_err(err)?;
                migrated += 1;
            }
        }
    }

    let mut last_note_id = String::new();
    loop {
        let rows: Vec<(String, Vec<u8>)> = {
            let mut stmt = tx
                .prepare(
                    "SELECT note_id, data FROM yjs_snapshots \
                     WHERE note_id > ?1 ORDER BY note_id LIMIT ?2",
                )
                .map_err(err)?;
            let mapped = stmt
                .query_map(params![last_note_id, BATCH], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
                })
                .map_err(err)?;
            mapped.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?
        };
        if rows.is_empty() {
            break;
        }
        last_note_id = rows[rows.len() - 1].0.clone();
        let mut update = tx
            .prepare("UPDATE yjs_snapshots SET data = ?1 WHERE note_id = ?2")
            .map_err(err)?;
        for (note_id, stored) in &rows {
            if let Some(next) = reencrypt_blob(old_key, new_key, stored) {
                update.execute(params![next, note_id]).map_err(err)?;
                migrated += 1;
            }
        }
    }

    tx.commit().map_err(err)?;
    Ok(migrated)
}

fn seal_kv_value(value: &str, enc_key: Option<[u8; 32]>) -> Result<Vec<u8>, AppError> {
    match enc_key {
        Some(k) => encrypt_yjs_blob(&k, value.as_bytes()),
        None => Ok(value.as_bytes().to_vec()),
    }
}

fn open_kv_value(stored: Vec<u8>, enc_key: Option<[u8; 32]>) -> Result<String, AppError> {
    let plain = match enc_key {
        Some(k) => decrypt_yjs_blob(&k, &stored)?,
        None if is_encrypted_yjs_blob(&stored) => return Err(AppError::EncryptionLocked),
        None => stored,
    };
    String::from_utf8(plain)
        .map_err(|e| AppError::Other(format!("kv value is not valid utf-8: {e}")))
}

fn kv_bytes(row: &rusqlite::Row, idx: usize) -> rusqlite::Result<Vec<u8>> {

    if let Ok(b) = row.get::<_, Vec<u8>>(idx) {
        return Ok(b);
    }
    let s = row.get::<_, String>(idx)?;
    Ok(s.into_bytes())
}

pub(crate) fn db_get(
    pool: &DbPool,
    key: &str,
    enc_key: Option<[u8; 32]>,
) -> Result<Option<String>, AppError> {
    let _t = crate::shared::speed_log::scope("db.db_get");
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let stored: Option<Vec<u8>> = conn
        .query_row("SELECT value FROM kv WHERE key = ?1", params![key], |row| {
            kv_bytes(row, 0)
        })
        .optional()
        .map_err(|e| AppError::Other(e.to_string()))?;
    stored.map(|s| open_kv_value(s, enc_key)).transpose()
}

pub(crate) fn db_set(
    pool: &DbPool,
    key: &str,
    value: &str,
    enc_key: Option<[u8; 32]>,
) -> Result<(), AppError> {
    let _t = crate::shared::speed_log::scope("db.db_set");
    let stored = seal_kv_value(value, enc_key)?;
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    conn.execute(
        "INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)",
        params![key, stored],
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

/// Delete every transport push cursor so the next sync cycle re-publishes all
/// locally stored rows under the active key. Invoked from the key-migration
/// path (vault join / rotation): rows migrated to the adopted key were
/// considered already published by the old cursor, so peers holding only the
/// new key never received them. It is one-shot by construction — only a key
/// change runs the migration. Pull state (`:ckpt:` checkpoints and `:seen:`
/// consume markers) is deliberately left intact to avoid a re-pull.
pub(crate) fn reset_transport_push_cursors(pool: &DbPool) -> Result<u64, AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let deleted = conn
        .execute(
            "DELETE FROM kv WHERE key LIKE 'sync:local:pushed:%' \
                OR key LIKE 'sync:local:wseq:%' \
                OR key LIKE 'sync:cloud:pushed:%' \
                OR key LIKE 'sync:cloud:wseq:%'",
            [],
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(deleted as u64)
}

pub(crate) fn db_clear(pool: &DbPool) -> Result<(), AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;

    conn.execute("DELETE FROM kv", [])
        .map_err(|e| AppError::Other(e.to_string()))?;
    let _ = conn.execute("DELETE FROM note_content", []);
    let _ = conn.execute("DELETE FROM yjs_snapshots", []);
    let _ = conn.execute("DELETE FROM deleted_notes", []);
    let _ = conn.execute("DELETE FROM activity_log", []);
    Ok(())
}

pub(crate) fn db_all(
    pool: &DbPool,
    enc_key: Option<[u8; 32]>,
) -> Result<Map<String, Value>, AppError> {
    let _t = crate::shared::speed_log::scope("db.db_all");
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM kv")
        .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let stored = kv_bytes(row, 1)?;
            Ok((key, stored))
        })
        .map_err(|e| AppError::Other(e.to_string()))?;

    let mut map = Map::new();
    for row in rows {
        let (key, stored) = row.map_err(|e| AppError::Other(e.to_string()))?;
        let raw = open_kv_value(stored, enc_key)?;
        let value = serde_json::from_str(&raw).unwrap_or(Value::String(raw));
        map.insert(key, value);
    }
    Ok(map)
}

pub(crate) fn db_replace_all(
    pool: &DbPool,
    data: Map<String, Value>,
    enc_key: Option<[u8; 32]>,
) -> Result<(), AppError> {
    let mut conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let tx = conn
        .transaction()
        .map_err(|e| AppError::Other(e.to_string()))?;
    tx.execute("DELETE FROM kv", [])
        .map_err(|e| AppError::Other(e.to_string()))?;

    {
        let mut stmt = tx
            .prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)")
            .map_err(|e| AppError::Other(e.to_string()))?;
        for (key, value) in data {
            let serialized = serde_json::to_string(&value)?;
            let stored = seal_kv_value(&serialized, enc_key)?;
            stmt.execute(params![key, stored])
                .map_err(|e| AppError::Other(e.to_string()))?;
        }
    }

    tx.commit().map_err(|e| AppError::Other(e.to_string()))
}

pub(crate) fn db_apply_diff(
    pool: &DbPool,
    upserts: &Map<String, Value>,
    deletes: &[String],
    enc_key: Option<[u8; 32]>,
) -> Result<(), AppError> {
    let _t = crate::shared::speed_log::scope("db.db_apply_diff");
    let mut conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let tx = conn
        .transaction()
        .map_err(|e| AppError::Other(e.to_string()))?;

    if !deletes.is_empty() {
        let placeholders = deletes.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("DELETE FROM kv WHERE key IN ({placeholders})");
        let params: Vec<&dyn rusqlite::types::ToSql> = deletes
            .iter()
            .map(|k| k as &dyn rusqlite::types::ToSql)
            .collect();
        tx.execute(&sql, params.as_slice())
            .map_err(|e| AppError::Other(e.to_string()))?;
    }

    if !upserts.is_empty() {
        let mut stmt = tx
            .prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)")
            .map_err(|e| AppError::Other(e.to_string()))?;
        for (key, value) in upserts {
            let serialized = serde_json::to_string(value)?;
            let stored = seal_kv_value(&serialized, enc_key)?;
            stmt.execute(params![key, stored])
                .map_err(|e| AppError::Other(e.to_string()))?;
        }
    }

    tx.commit().map_err(|e| AppError::Other(e.to_string()))
}

pub(crate) fn yjs_append(
    pool: &DbPool,
    note_id: &str,
    blob: &[u8],
    device: &str,
    key: Option<[u8; 32]>,
) -> Result<(), AppError> {
    let _t = crate::shared::speed_log::scope("db.yjs_append");
    let stored = match key {
        Some(k) => encrypt_yjs_blob(&k, blob)?,
        None => blob.to_vec(),
    };
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    conn.execute(
        "INSERT INTO note_content (note_id, data, device, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![
            note_id,
            stored,
            device,
            chrono::Utc::now().timestamp_millis()
        ],
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

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
                crate::rs_log!("[yjs_get_updates] skipping corrupt row: {e}");
                continue;
            }
        };
        match key {
            Some(k) => match decrypt_yjs_blob(&k, &blob) {
                Ok(d) => result.push((id, d)),
                Err(e) => {
                    crate::rs_log!("[yjs_get_updates] skipping undecryptable row {id}: {e}");
                }
            },
            None if is_encrypted_yjs_blob(&blob) => {

                return Err(AppError::EncryptionLocked);
            }
            None => result.push((id, blob)),
        }
    }
    Ok(result)
}

pub(crate) fn yjs_get_snapshot(
    pool: &DbPool,
    note_id: &str,
    key: Option<[u8; 32]>,
) -> Result<Vec<u8>, AppError> {
    let _t = crate::shared::speed_log::scope("db.yjs_get_snapshot");
    if let Some((cached, cached_src_rowid)) = read_snapshot(pool, note_id)? {
        if !cached.is_empty() && !snapshot_is_stale(pool, note_id, cached_src_rowid)? {
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

    if key.is_none() && rows.iter().any(|(_, blob)| is_encrypted_yjs_blob(blob)) {
        return Err(AppError::EncryptionLocked);
    }
    // Highest row id the rebuilt snapshot covers; `rows` is id-ascending.
    let src_rowid = rows.last().map(|(id, _)| *id).unwrap_or(0);
    let mut doc = Doc::new();
    for (_, blob) in rows {
        let update = Update::decode_v1(&blob).map_err(|e| AppError::Other(e.to_string()))?;
        doc.apply_update(update)
            .map_err(|e| AppError::Other(e.to_string()))?;
    }
    let snapshot = doc
        .encode_state_as_update_v1(&StateVector::default())
        .map_err(|e| AppError::Other(e.to_string()))?;

    write_snapshot(pool, note_id, &snapshot, src_rowid, key)?;
    Ok(snapshot)
}

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
        doc.apply_update(update)
            .map_err(|e| AppError::Other(e.to_string()))?;
    }
    let sv = doc.get_state_vector();
    let mut map = std::collections::HashMap::new();
    for (client, clock) in sv.iter() {
        map.insert(client.to_string(), *clock as i64);
    }
    Ok(Some(map))
}

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
            "SELECT note_id, data, src_rowid FROM yjs_snapshots WHERE note_id IN ({placeholders})"
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

    let stale_query = format!(
        "SELECT DISTINCT nc.note_id FROM note_content nc \
         LEFT JOIN yjs_snapshots ys ON nc.note_id = ys.note_id \
         WHERE nc.note_id IN ({placeholders}) \
           AND (ys.note_id IS NULL OR nc.id > ys.src_rowid)"
    );
    let mut stmt = conn
        .prepare(&stale_query)
        .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(note_ids.iter()), |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| AppError::Other(e.to_string()))?;
    let stale_notes: std::collections::HashSet<String> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Other(e.to_string()))?
        .into_iter()
        .collect();

    let decrypted: Vec<(String, Vec<u8>)> = snapshots
        .par_iter()
        .filter(|(note_id, data, _updated_at)| {
            !data.is_empty()
                && !stale_notes.contains(note_id)
                && (key.is_some() || !is_encrypted_yjs_blob(data))
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
                crate::rs_log!("[yjs_get_snapshots] skipping locked note {id}");
            }
            Err(e) => return Err(e),
        }
    }
    Ok(result)
}

/// Read a note's rows inside an already-open transaction. Mirrors
/// `yjs_get_updates` (undecodable rows are skipped with a log; encrypted rows
/// with no key fail closed), but runs on the caller's connection so a
/// compaction sees a consistent snapshot while holding the write lock.
fn read_updates_in_tx(
    tx: &rusqlite::Transaction,
    note_id: &str,
    key: Option<[u8; 32]>,
) -> Result<Vec<(i64, Vec<u8>)>, AppError> {
    let mut stmt = tx
        .prepare("SELECT id, data FROM note_content WHERE note_id = ?1 ORDER BY id ASC")
        .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = stmt
        .query_map(rusqlite::params![note_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
        })
        .map_err(|e| AppError::Other(e.to_string()))?;
    let mut result = Vec::new();
    for row in rows {
        let (id, blob) = match row {
            Ok(v) => v,
            Err(e) => {
                crate::rs_log!("[yjs_compact] skipping corrupt row: {e}");
                continue;
            }
        };
        match key {
            Some(k) => match decrypt_yjs_blob(&k, &blob) {
                Ok(d) => result.push((id, d)),
                Err(e) => {
                    crate::rs_log!("[yjs_compact] skipping undecryptable row {id}: {e}");
                }
            },
            None if is_encrypted_yjs_blob(&blob) => return Err(AppError::EncryptionLocked),
            None => result.push((id, blob)),
        }
    }
    Ok(result)
}

/// Write the merged snapshot row inside the caller's transaction, so the
/// snapshot and the compacted `note_content` row commit (or roll back) together.
fn write_snapshot_in_tx(
    tx: &rusqlite::Transaction,
    note_id: &str,
    data: &[u8],
    src_rowid: i64,
    key: Option<[u8; 32]>,
) -> Result<(), AppError> {
    let stored = match key {
        Some(k) => encrypt_yjs_blob(&k, data)?,
        None => data.to_vec(),
    };
    tx.execute(
        "INSERT INTO yjs_snapshots (note_id, data, updated_at, src_rowid) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(note_id) DO UPDATE SET data = ?2, updated_at = ?3, src_rowid = ?4",
        rusqlite::params![
            note_id,
            stored,
            chrono::Utc::now().timestamp_millis(),
            src_rowid
        ],
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

/// Replace every `note_content` row for a note with one encrypted snapshot,
/// inside the caller's write transaction.
fn replace_rows_in_tx(
    tx: &rusqlite::Transaction,
    note_id: &str,
    snapshot: &[u8],
    key: Option<[u8; 32]>,
) -> Result<(), AppError> {
    let stored = match key {
        Some(k) => encrypt_yjs_blob(&k, snapshot)?,
        None => snapshot.to_vec(),
    };
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
    // The snapshot now covers exactly the single replacement row; record its
    // monotonic row id so freshness never depends on wall-clock ms (C3).
    let src_rowid: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(id), 0) FROM note_content WHERE note_id = ?1",
            rusqlite::params![note_id],
            |r| r.get(0),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
    write_snapshot_in_tx(tx, note_id, snapshot, src_rowid, key)
}

/// Guard a compaction read against concurrent appends. The count check refuses
/// when any stored row failed to decode (an undecryptable row must never be
/// silently erased); the coverage check refuses when the snapshot predates a
/// row that landed after it was built. Callers run this *inside* the IMMEDIATE
/// transaction so no append can slip between validate and DELETE.
fn validate_compaction(
    rows: &[(i64, Vec<u8>)],
    stored_count: i64,
    note_id: &str,
    snapshot: &[u8],
) -> Result<(), AppError> {
    if rows.len() as i64 != stored_count {
        return Err(AppError::Other(format!(
            "yjs_compact: {note_id} stores {stored_count} rows but only {} decoded — refusing to compact",
            rows.len()
        )));
    }
    let blobs: Vec<Vec<u8>> = rows.iter().map(|(_, b)| b.clone()).collect();
    if !crate::sync::merge::snapshot_covers_rows(snapshot, &blobs) {
        return Err(AppError::Other(format!(
            "yjs_compact: {note_id} snapshot does not cover stored history — refusing to compact"
        )));
    }
    Ok(())
}

pub(crate) fn yjs_compact(
    pool: &DbPool,
    note_id: &str,
    snapshot: &[u8],
    key: Option<[u8; 32]>,
) -> Result<(), AppError> {
    let _t = crate::shared::speed_log::scope("db.yjs_compact");
    let mut conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    // IMMEDIATE takes the write lock up front: the read→validate→DELETE→INSERT
    // below is one atomic step, so an append (autosave / sync) can neither land
    // between validate and delete nor be erased without being re-inserted.
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| AppError::Other(e.to_string()))?;
    let stored_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM note_content WHERE note_id = ?1",
            rusqlite::params![note_id],
            |r| r.get(0),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
    if stored_count > 0 {
        let rows = read_updates_in_tx(&tx, note_id, key)?;
        validate_compaction(&rows, stored_count, note_id, snapshot)?;
    }
    replace_rows_in_tx(&tx, note_id, snapshot, key)?;
    tx.commit().map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

pub(crate) fn yjs_row_count(pool: &DbPool, note_id: &str) -> Result<i64, AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    conn.query_row(
        "SELECT COUNT(*) FROM note_content WHERE note_id = ?1",
        rusqlite::params![note_id],
        |r| r.get(0),
    )
    .map_err(|e| AppError::Other(e.to_string()))
}

pub(crate) fn yjs_compact_batch(
    pool: &DbPool,
    note_id: &str,
    key: Option<[u8; 32]>,
) -> Result<(), AppError> {
    let _t = crate::shared::speed_log::scope("db.yjs_compact_batch");
    let mut conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    // Same atomic read→validate→replace as `yjs_compact`: the rows are read
    // inside the IMMEDIATE transaction, so an append landing concurrently is
    // either included in the merge or blocked until this commits — never
    // deleted without being folded in.
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| AppError::Other(e.to_string()))?;
    let stored_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM note_content WHERE note_id = ?1",
            rusqlite::params![note_id],
            |r| r.get(0),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = read_updates_in_tx(&tx, note_id, key)?;
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
    validate_compaction(&rows, stored_count, note_id, &snapshot)?;
    replace_rows_in_tx(&tx, note_id, &snapshot, key)?;
    tx.commit().map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

pub(crate) fn yjs_append_batch(
    pool: &DbPool,
    note_ids: &[String],
    updates: &[Vec<u8>],
    devices: &[String],
    key: Option<[u8; 32]>,
) -> Result<usize, AppError> {
    let _t = crate::shared::speed_log::scope("db.yjs_append_batch");
    if note_ids.len() != updates.len() || note_ids.len() != devices.len() {
        return Err(AppError::Other(
            "yjs_append_batch: array length mismatch".into(),
        ));
    }
    let mut conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let tx = conn
        .transaction()
        .map_err(|e| AppError::Other(e.to_string()))?;
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
            stmt.execute(rusqlite::params![note_ids[i], stored, devices[i], now,])
                .map_err(|e| AppError::Other(e.to_string()))?;
        }
    }
    tx.commit().map_err(|e| AppError::Other(e.to_string()))?;
    Ok(updates.len())
}

pub(crate) fn yjs_delete(pool: &DbPool, note_id: &str, workspace_id: &str) -> Result<(), AppError> {
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
    // Durable tombstone: the cloud asset differ deletes ONLY keys recorded
    // here (never inference), then clears the record after a confirmed remote
    // delete. Recorded even when this device has no cloud identity yet, so an
    // offline delete still prunes once sync is configured.
    conn.execute(
        "INSERT OR REPLACE INTO deleted_notes (note_id, workspace_id, deleted_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![note_id, workspace_id, chrono::Utc::now().timestamp_millis()],
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

/// Insert activity entries and keep only the newest `ACTIVITY_LOG_MAX_PER_NOTE`
/// rows per touched note. `INSERT OR IGNORE` makes the id the dedupe key, which
/// Phase 2 relies on when merging a collaborator's timeline with ours.
pub(crate) fn activity_append(pool: &DbPool, entries: &[ActivityEntry]) -> Result<(), AppError> {
    if entries.is_empty() {
        return Ok(());
    }
    let err = |e: rusqlite::Error| AppError::Other(e.to_string());
    let mut conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let tx = conn.transaction().map_err(err)?;
    {
        let mut insert = tx
            .prepare(
                "INSERT OR IGNORE INTO activity_log
                   (id, note_id, actor_id, actor_label, kind, summary, at, anchor_hint)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .map_err(err)?;
        for e in entries {
            insert
                .execute(params![
                    e.id,
                    e.note_id,
                    e.actor_id,
                    e.actor_label,
                    e.kind,
                    e.summary,
                    e.at,
                    e.anchor_hint
                ])
                .map_err(err)?;
        }
    }
    {
        let mut prune = tx
            .prepare(
                "DELETE FROM activity_log WHERE note_id = ?1 AND id NOT IN (
                   SELECT id FROM activity_log WHERE note_id = ?1
                   ORDER BY at DESC, rowid DESC LIMIT ?2)",
            )
            .map_err(err)?;
        let mut pruned: Vec<&str> = Vec::new();
        for e in entries {
            if pruned.contains(&e.note_id.as_str()) {
                continue;
            }
            pruned.push(e.note_id.as_str());
            prune
                .execute(params![e.note_id, ACTIVITY_LOG_MAX_PER_NOTE as i64])
                .map_err(err)?;
        }
    }
    tx.commit().map_err(err)
}

/// Newest-first page of a note's activity. `before` (epoch ms) is an exclusive
/// cursor for older pages.
pub(crate) fn activity_list(
    pool: &DbPool,
    note_id: &str,
    limit: i64,
    before: Option<i64>,
) -> Result<Vec<ActivityEntry>, AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, note_id, actor_id, actor_label, kind, summary, at, anchor_hint
             FROM activity_log
             WHERE note_id = ?1 AND (?2 IS NULL OR at < ?2)
             ORDER BY at DESC, rowid DESC
             LIMIT ?3",
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = stmt
        .query_map(params![note_id, before, limit], |row| {
            Ok(ActivityEntry {
                id: row.get(0)?,
                note_id: row.get(1)?,
                actor_id: row.get(2)?,
                actor_label: row.get(3)?,
                kind: row.get(4)?,
                summary: row.get(5)?,
                at: row.get(6)?,
                anchor_hint: row.get(7)?,
            })
        })
        .map_err(|e| AppError::Other(e.to_string()))?;
    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| AppError::Other(e.to_string()))?);
    }
    Ok(entries)
}

/// Drop every activity entry for one note (the confirm-guarded "Clear activity").
pub(crate) fn activity_clear(pool: &DbPool, note_id: &str) -> Result<(), AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    conn.execute(
        "DELETE FROM activity_log WHERE note_id = ?1",
        params![note_id],
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

/// Note ids deleted locally that the asset differ may prune for
/// `workspace_id`: records stamped with this workspace plus records with an
/// unknown (empty) workspace, which matches any workspace. Note ids are
/// globally unique, so an unknown-workspace tombstone cannot collide.
pub(crate) fn deleted_note_ids(pool: &DbPool, workspace_id: &str) -> Result<Vec<String>, AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT note_id FROM deleted_notes WHERE workspace_id = ?1 OR workspace_id = ''")
        .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = stmt
        .query_map(rusqlite::params![workspace_id], |row| row.get::<_, String>(0))
        .map_err(|e| AppError::Other(e.to_string()))?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| AppError::Other(e.to_string()))?);
    }
    Ok(ids)
}

/// Clear tombstones for `note_ids` after their remote assets were confirmed
/// deleted.
pub(crate) fn clear_deleted_notes(pool: &DbPool, note_ids: &[String]) -> Result<(), AppError> {
    if note_ids.is_empty() {
        return Ok(());
    }
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let mut stmt = conn
        .prepare("DELETE FROM deleted_notes WHERE note_id = ?1")
        .map_err(|e| AppError::Other(e.to_string()))?;
    for id in note_ids {
        stmt.execute(rusqlite::params![id])
            .map_err(|e| AppError::Other(e.to_string()))?;
    }
    Ok(())
}

fn read_snapshot(pool: &DbPool, note_id: &str) -> Result<Option<(Vec<u8>, i64)>, AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let mut stmt = conn
        .prepare("SELECT data, src_rowid FROM yjs_snapshots WHERE note_id = ?1")
        .map_err(|e| AppError::Other(e.to_string()))?;
    let row = stmt
        .query_row(rusqlite::params![note_id], |r| {
            Ok((r.get::<_, Vec<u8>>(0)?, r.get::<_, i64>(1)?))
        })
        .optional()
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(row)
}

/// A snapshot is stale when any stored row has an `id` greater than the row id
/// watermark it covers. Row ids are monotonic, so this detects an append even
/// in the same wall-clock millisecond as the snapshot write (finding C3).
fn snapshot_is_stale(
    pool: &DbPool,
    note_id: &str,
    snapshot_src_rowid: i64,
) -> Result<bool, AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let newest: Option<i64> = conn
        .query_row(
            "SELECT MAX(id) FROM note_content WHERE note_id = ?1",
            rusqlite::params![note_id],
            |r| r.get::<_, Option<i64>>(0),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(newest.is_some_and(|id| id > snapshot_src_rowid))
}

fn write_snapshot(
    pool: &DbPool,
    note_id: &str,
    data: &[u8],
    src_rowid: i64,
    key: Option<[u8; 32]>,
) -> Result<(), AppError> {
    let stored = match key {
        Some(k) => encrypt_yjs_blob(&k, data)?,
        None => data.to_vec(),
    };
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    conn.execute(
        "INSERT INTO yjs_snapshots (note_id, data, updated_at, src_rowid) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(note_id) DO UPDATE SET data = ?2, updated_at = ?3, src_rowid = ?4",
        rusqlite::params![
            note_id,
            stored,
            chrono::Utc::now().timestamp_millis(),
            src_rowid
        ],
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
        assert_eq!(
            timeout, 5000,
            "busy_timeout must be set to avoid SQLITE_BUSY"
        );
        let _ = fs::remove_dir_all(&root);
    }

    fn test_pool(prefix: &str) -> (DbPool, PathBuf) {
        let root = unique_temp_dir(prefix);
        let _ = fs::create_dir_all(&root);
        let pool = open_pool(&root.join("data.db")).expect("pool");
        (pool, root)
    }

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

    #[test]
    fn encrypted_row_roundtrips_and_fails_closed_without_key() {
        let (pool, root) = test_pool("beaver-notes-db-enc-roundtrip");
        let original = b"secret yjs update bytes".to_vec();
        yjs_append(&pool, "n1", &original, "devA", Some([2u8; 32])).expect("append");

        let conn = pool.get().expect("conn");
        let stored: Vec<u8> = conn
            .query_row(
                "SELECT data FROM note_content WHERE note_id = 'n1'",
                [],
                |r| r.get(0),
            )
            .expect("row");
        assert!(
            is_encrypted_yjs_blob(&stored),
            "row must carry BNY1 magic at rest"
        );

        let rows = yjs_get_updates(&pool, "n1", Some([2u8; 32])).expect("read");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].1, original);

        assert!(matches!(
            yjs_get_updates(&pool, "n1", None),
            Err(AppError::EncryptionLocked)
        ));
        let _ = fs::remove_dir_all(&root);
    }

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

    #[test]
    fn encrypted_rows_invalidate_cached_snapshot() {
        let (pool, root) = test_pool("beaver-notes-db-stale-enc");
        let key = [4u8; 32];
        write_snapshot(&pool, "meta", b"cached state", 0, Some(key)).expect("cache snapshot");
        let cached_rowid = latest_snapshot_src_rowid(&pool, "meta");

        yjs_append(&pool, "meta", b"second synced update", "devB", Some(key)).expect("append");

        assert!(
            snapshot_is_stale(&pool, "meta", cached_rowid).expect("stale"),
            "encrypted rows newer than the snapshot must mark it stale"
        );

        write_snapshot(&pool, "n2", b"cached state", 0, Some(key)).expect("cache snapshot 2");
        let cached_rowid2 = latest_snapshot_src_rowid(&pool, "n2");
        yjs_append(&pool, "n2", b"local update", "devA", None).expect("append plain");
        assert!(snapshot_is_stale(&pool, "n2", cached_rowid2).expect("stale plain"));
        let _ = fs::remove_dir_all(&root);
    }

    /// C3: an append in the *same wall-clock millisecond* as the snapshot write
    /// must not be masked by the cached snapshot. Freshness is a monotonic row
    /// id watermark, not `created_at > updated_at`.
    #[test]
    fn snapshot_freshness_detects_same_millisecond_append() {
        use crate::sync::merge::snapshot_covers_rows;
        let (pool, root) = test_pool("beaver-notes-db-same-ms");
        let key = [4u8; 32];
        yjs_append(&pool, "n1", &seed_update("a"), "devA", Some(key)).expect("append a");
        let first = yjs_get_snapshot(&pool, "n1", Some(key)).expect("snapshot 1");
        assert!(!first.is_empty());

        yjs_append(&pool, "n1", &seed_update("b"), "devA", Some(key)).expect("append b");
        // Align the second row onto the cached snapshot's millisecond so the old
        // `MAX(created_at) > updated_at` check reads it as fresh.
        let snap_ms = latest_snapshot_updated_at(&pool, "n1");
        {
            let conn = pool.get().expect("conn");
            conn.execute(
                "UPDATE note_content SET created_at = ?1 \
                 WHERE note_id = 'n1' \
                   AND id = (SELECT MAX(id) FROM note_content WHERE note_id = 'n1')",
                rusqlite::params![snap_ms],
            )
            .expect("align created_at");
        }

        let snapshot = yjs_get_snapshot(&pool, "n1", Some(key)).expect("snapshot 2");
        let rows: Vec<Vec<u8>> = yjs_get_updates(&pool, "n1", Some(key))
            .expect("rows")
            .into_iter()
            .map(|(_, b)| b)
            .collect();
        assert!(
            snapshot_covers_rows(&snapshot, &rows),
            "snapshot must include the same-millisecond append (finding C3)"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn kv_encrypted_roundtrip_and_fails_closed_without_key() {
        let (pool, root) = test_pool("beaver-notes-db-kv-enc");
        let key = [9u8; 32];
        db_set(&pool, "autoUpdateEnabled", "true", Some(key)).expect("set");

        let conn = pool.get().expect("conn");
        let stored: Vec<u8> = conn
            .query_row(
                "SELECT value FROM kv WHERE key = 'autoUpdateEnabled'",
                [],
                |r| r.get(0),
            )
            .expect("row");
        assert!(
            is_encrypted_yjs_blob(&stored),
            "kv value must carry BNY1 magic at rest"
        );

        assert_eq!(
            db_get(&pool, "autoUpdateEnabled", Some(key)).expect("get"),
            Some("true".to_string())
        );
        assert!(matches!(
            db_get(&pool, "autoUpdateEnabled", None),
            Err(AppError::EncryptionLocked)
        ));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn kv_plaintext_rows_stay_readable() {
        let (pool, root) = test_pool("beaver-notes-db-kv-plain");
        db_set(&pool, "legacy", "{\"a\":1}", None).expect("set plain");
        assert_eq!(
            db_get(&pool, "legacy", None).expect("get"),
            Some("{\"a\":1}".to_string())
        );
        assert_eq!(
            db_get(&pool, "legacy", Some([8u8; 32])).expect("get keyed"),
            Some("{\"a\":1}".to_string())
        );

        let all = db_all(&pool, None).expect("all");
        assert_eq!(all.get("legacy"), Some(&serde_json::json!({"a": 1})));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn kv_bulk_ops_roundtrip_encrypted() {
        let (pool, root) = test_pool("beaver-notes-db-kv-bulk");
        let key = [10u8; 32];

        let mut map = Map::new();
        map.insert("labels".to_string(), serde_json::json!(["red", "blue"]));
        map.insert(
            "labelColors".to_string(),
            serde_json::json!({"red": "#f00"}),
        );
        db_replace_all(&pool, map, Some(key)).expect("replace");

        let conn = pool.get().expect("conn");
        let mut stmt = conn.prepare("SELECT value FROM kv").expect("stmt");
        let values: Vec<Vec<u8>> = stmt
            .query_map([], |r| r.get(0))
            .expect("q")
            .map(|r| r.expect("row"))
            .collect();
        assert_eq!(values.len(), 2);
        assert!(
            values.iter().all(|v| is_encrypted_yjs_blob(v)),
            "every bulk-written row must be encrypted at rest"
        );
        drop(stmt);

        let all = db_all(&pool, Some(key)).expect("all");
        assert_eq!(all.get("labels"), Some(&serde_json::json!(["red", "blue"])));

        let mut upserts = Map::new();
        upserts.insert("labels".to_string(), serde_json::json!(["green"]));
        db_apply_diff(&pool, &upserts, &["labelColors".to_string()], Some(key)).expect("diff");

        let all = db_all(&pool, Some(key)).expect("all after diff");
        assert_eq!(all.get("labels"), Some(&serde_json::json!(["green"])));
        assert!(!all.contains_key("labelColors"));
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

    fn latest_snapshot_src_rowid(pool: &DbPool, note_id: &str) -> i64 {
        let conn = pool.get().expect("conn");
        conn.query_row(
            "SELECT src_rowid FROM yjs_snapshots WHERE note_id = ?1",
            rusqlite::params![note_id],
            |r| r.get(0),
        )
        .expect("snapshot row")
    }

    fn seed_update(text: &str) -> Vec<u8> {
        use yrs::{Doc, ReadTxn, StateVector, Text, Transact};
        let doc = Doc::new();
        let t = doc.get_or_insert_text("t");
        let mut txn = doc.transact_mut();
        t.insert(&mut txn, 0, text);
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    #[test]
    fn compact_refuses_non_covering_snapshot() {
        let (pool, root) = test_pool("beaver-notes-db-compact-guard");
        let a = seed_update("hello");
        let b = seed_update("world");
        yjs_append(&pool, "n1", &a, "devA", None).expect("append a");
        yjs_append(&pool, "n1", &b, "devB", None).expect("append b");

        assert!(
            yjs_compact(&pool, "n1", &a, None).is_err(),
            "partial snapshot must not replace full history"
        );
        let rows = yjs_get_updates(&pool, "n1", None).expect("read");
        assert_eq!(rows.len(), 2, "refused compact must leave rows untouched");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn compact_accepts_covering_snapshot() {
        use yrs::{Doc, ReadTxn, StateVector, Transact};
        use yrs::updates::decoder::Decode;
        let (pool, root) = test_pool("beaver-notes-db-compact-ok");
        let a = seed_update("hello");
        let b = seed_update("world");
        yjs_append(&pool, "n1", &a, "devA", None).expect("append a");
        yjs_append(&pool, "n1", &b, "devB", None).expect("append b");

        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        txn.apply_update(yrs::Update::decode_v1(&a).expect("decode a"))
            .expect("apply a");
        txn.apply_update(yrs::Update::decode_v1(&b).expect("decode b"))
            .expect("apply b");
        let full = txn.encode_state_as_update_v1(&StateVector::default());

        yjs_compact(&pool, "n1", &full, None).expect("covering compact");
        let rows = yjs_get_updates(&pool, "n1", None).expect("read");
        assert_eq!(rows.len(), 1, "covering compact folds history into one row");
        let _ = fs::remove_dir_all(&root);
    }

    /// Regression: `yjs_compact_batch` used to skip undecodable rows while
    /// reading, then DELETE every row and re-insert only the survivors —
    /// silently erasing a row it could not decrypt. The in-transaction count
    /// guard must refuse instead.
    #[test]
    fn compact_batch_refuses_when_a_row_fails_to_decode() {
        let (pool, root) = test_pool("beaver-notes-db-compact-batch-guard");
        let key = [7u8; 32];
        let foreign = [8u8; 32];
        yjs_append(&pool, "n1", &seed_update("good"), "devA", Some(key)).expect("append good");
        yjs_append(&pool, "n1", b"foreign bytes", "devB", Some(foreign)).expect("append foreign");

        assert!(
            yjs_compact_batch(&pool, "n1", Some(key)).is_err(),
            "an undecodable row must abort batch compaction, never be erased"
        );
        assert_eq!(
            yjs_row_count(&pool, "n1").expect("count"),
            2,
            "refused compact must leave every row in place"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reencrypt_payloads_for_key_roundtrips_encrypted_rows() {
        let (pool, root) = test_pool("beaver-notes-db-reencrypt");
        let old = [7u8; 32];
        let new = [9u8; 32];
        let note = b"note bytes".to_vec();
        let snap_plain = b"snapshot bytes".to_vec();

        yjs_append(&pool, "n1", &note, "devA", Some(old)).expect("append");
        {
            let conn = pool.get().expect("conn");
            conn.execute(
                "INSERT INTO kv (key, value) VALUES (?1, ?2)",
                rusqlite::params![
                    "ae:4:notes.demo",
                    seal_kv_value("{\"a\":1}", Some(old)).expect("seal")
                ],
            )
            .expect("kv insert");
            conn.execute(
                "INSERT INTO yjs_snapshots (note_id, data, updated_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![
                    "n1",
                    encrypt_yjs_blob(&old, &snap_plain).expect("snap enc"),
                    1i64
                ],
            )
            .expect("snapshot insert");
        }

        let migrated = reencrypt_payloads_for_key(&pool, &old, &new).expect("migrate");
        assert_eq!(migrated, 3, "kv + note_content + yjs_snapshots");

        let rows = yjs_get_updates(&pool, "n1", Some(new)).expect("read new");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].1, note);

        let conn = pool.get().expect("conn");
        let kv: Vec<u8> = conn
            .query_row("SELECT value FROM kv WHERE key = 'ae:4:notes.demo'", [], |r| {
                r.get(0)
            })
            .expect("kv row");
        assert_eq!(open_kv_value(kv, Some(new)).expect("open new"), "{\"a\":1}");

        let snap: Vec<u8> = conn
            .query_row(
                "SELECT data FROM yjs_snapshots WHERE note_id = 'n1'",
                [],
                |r| r.get(0),
            )
            .expect("snap row");
        assert_eq!(decrypt_yjs_blob(&new, &snap).expect("snap new"), snap_plain);
        assert!(
            decrypt_yjs_blob(&old, &snap).is_err(),
            "old key must no longer decrypt migrated rows"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reencrypt_payloads_for_key_skips_rows_from_other_keys() {
        let (pool, root) = test_pool("beaver-notes-db-reencrypt-skip");
        let old = [7u8; 32];
        let new = [9u8; 32];
        let foreign = [3u8; 32];
        let foreign_plain = b"foreign bytes".to_vec();

        yjs_append(&pool, "n1", b"old bytes", "devA", Some(old)).expect("append old");
        yjs_append(&pool, "n2", &foreign_plain, "devA", Some(foreign)).expect("append foreign");

        let migrated = reencrypt_payloads_for_key(&pool, &old, &new).expect("migrate");
        assert_eq!(migrated, 1, "only the row encrypted under old_key is rewritten");

        let foreign_rows = yjs_get_updates(&pool, "n2", Some(foreign)).expect("read foreign");
        assert_eq!(foreign_rows.len(), 1, "foreign row must be left intact");
        assert_eq!(foreign_rows[0].1, foreign_plain);

        let old_rows = yjs_get_updates(&pool, "n1", Some(new)).expect("read new");
        assert_eq!(old_rows.len(), 1);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reencrypt_payloads_for_key_noop_when_keys_equal() {
        let (pool, root) = test_pool("beaver-notes-db-reencrypt-noop");
        let key = [5u8; 32];

        yjs_append(&pool, "n1", b"bytes", "devA", Some(key)).expect("append");

        assert_eq!(
            reencrypt_payloads_for_key(&pool, &key, &key).expect("migrate"),
            0
        );
        let rows = yjs_get_updates(&pool, "n1", Some(key)).expect("read");
        assert_eq!(rows.len(), 1);

        let _ = fs::remove_dir_all(&root);
    }

    fn activity_entry(id: &str, note: &str, at: i64) -> ActivityEntry {
        ActivityEntry {
            id: id.into(),
            note_id: note.into(),
            actor_id: Some("u1".into()),
            actor_label: "Alice".into(),
            kind: "insert".into(),
            summary: format!("text {id}"),
            at,
            anchor_hint: Some(format!("text {id}")),
        }
    }

    #[test]
    fn activity_list_returns_newest_first() {
        let (pool, root) = test_pool("beaver-notes-activity-order");
        activity_append(
            &pool,
            &[
                activity_entry("a", "n1", 100),
                activity_entry("b", "n1", 300),
                activity_entry("c", "n1", 200),
            ],
        )
        .expect("append");

        let rows = activity_list(&pool, "n1", 50, None).expect("list");
        let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["b", "c", "a"], "newest first");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn activity_list_is_scoped_to_the_note() {
        let (pool, root) = test_pool("beaver-notes-activity-per-note");
        activity_append(
            &pool,
            &[activity_entry("a", "n1", 10), activity_entry("b", "n2", 20)],
        )
        .expect("append");

        let rows = activity_list(&pool, "n1", 50, None).expect("list n1");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].note_id, "n1");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn activity_list_honours_limit_and_before_cursor() {
        let (pool, root) = test_pool("beaver-notes-activity-cursor");
        let entries: Vec<ActivityEntry> = (0..5)
            .map(|i| activity_entry(&format!("e{i}"), "n1", 100 + i as i64))
            .collect();
        activity_append(&pool, &entries).expect("append");

        let first_page = activity_list(&pool, "n1", 2, None).expect("page 1");
        assert_eq!(first_page.len(), 2);
        assert_eq!(first_page[0].id, "e4");
        assert_eq!(first_page[1].id, "e3");

        let second_page = activity_list(&pool, "n1", 2, Some(first_page[1].at)).expect("page 2");
        assert_eq!(second_page[0].id, "e2");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn activity_append_dedupes_by_id() {
        let (pool, root) = test_pool("beaver-notes-activity-dedupe");
        activity_append(&pool, &[activity_entry("same", "n1", 10)]).expect("append");
        activity_append(&pool, &[activity_entry("same", "n1", 10)]).expect("append again");

        let rows = activity_list(&pool, "n1", 50, None).expect("list");
        assert_eq!(rows.len(), 1, "same id must merge, not duplicate");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn activity_append_prunes_oldest_past_the_cap() {
        let (pool, root) = test_pool("beaver-notes-activity-cap");
        let total = ACTIVITY_LOG_MAX_PER_NOTE + 5;
        let entries: Vec<ActivityEntry> = (0..total)
            .map(|i| activity_entry(&format!("e{i:04}"), "n1", i as i64))
            .collect();
        activity_append(&pool, &entries).expect("append");

        let rows = activity_list(&pool, "n1", 10_000, None).expect("list");
        assert_eq!(rows.len(), ACTIVITY_LOG_MAX_PER_NOTE, "cap enforced");
        assert_eq!(rows[0].id, format!("e{:04}", total - 1), "newest kept");
        assert_eq!(rows.last().unwrap().id, format!("e{:04}", 5), "oldest dropped");

        // Another note's rows are never pruned by this note's activity.
        activity_append(&pool, &[activity_entry("keep", "n2", 1)]).expect("append n2");
        let other = activity_list(&pool, "n2", 10_000, None).expect("list n2");
        assert_eq!(other.len(), 1);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn activity_clear_removes_only_that_note() {
        let (pool, root) = test_pool("beaver-notes-activity-clear");
        activity_append(
            &pool,
            &[activity_entry("a", "n1", 10), activity_entry("b", "n2", 20)],
        )
        .expect("append");

        activity_clear(&pool, "n1").expect("clear");

        assert!(activity_list(&pool, "n1", 50, None).expect("n1").is_empty());
        assert_eq!(
            activity_list(&pool, "n2", 50, None).expect("n2").len(),
            1,
            "other notes untouched"
        );

        let _ = fs::remove_dir_all(&root);
    }
}
