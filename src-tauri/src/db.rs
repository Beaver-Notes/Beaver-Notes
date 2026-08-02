use std::{collections::HashMap, path::Path};

use rayon::prelude::*;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, OptionalExtension};
use serde_json::{Map, Value};
use yrs::updates::decoder::Decode;
use yrs::{ReadTxn, Transact};

use crate::shared::{decrypt_yjs_blob, encrypt_yjs_blob, is_encrypted_yjs_blob, AppError};

pub(crate) type DbPool = Pool<SqliteConnectionManager>;

/// Schema version — increment when tables/indexes change.
/// Must stay in sync with `SCHEMA_VERSION` in the migration function below.
const SCHEMA_VERSION: i64 = 1;

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
            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
              id    UNINDEXED,
              title,
              body,
              tokenize = 'unicode61 remove_diacritics 1'
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
        PRAGMA synchronous=NORMAL;",
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

// ─── FTS5 helpers ─────────────────────────────────────────────────────────────

/// Upsert a note into the FTS index. `body` should be a pre-extracted plain-text
/// string (no JSON, no markup). Call this every time a note is saved.
pub(crate) fn fts_upsert(pool: &DbPool, id: &str, title: &str, body: &str) -> Result<(), AppError> {
    let mut conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let tx = conn.transaction().map_err(|e| AppError::Other(e.to_string()))?;
    tx.execute("DELETE FROM notes_fts WHERE id = ?1", params![id])
        .map_err(|e| AppError::Other(e.to_string()))?;
    tx.execute(
        "INSERT INTO notes_fts (id, title, body) VALUES (?1, ?2, ?3)",
        params![id, title, body],
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    tx.commit().map_err(|e| AppError::Other(e.to_string()))
}

/// Remove a note from the FTS index. Call this when a note is deleted.
pub(crate) fn fts_delete(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    conn.execute("DELETE FROM notes_fts WHERE id = ?1", params![id])
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

/// Full-text search. Returns a list of note IDs whose title or body match the
/// query. Uses FTS5's MATCH operator with a prefix search on the last token so
/// partial words (e.g. "rustac" matching "rustacean") work while the user types.
/// Returns at most `limit` results (default 200).
pub(crate) fn fts_search(pool: &DbPool, query: &str, limit: usize) -> Result<Vec<String>, AppError> {
    let _t = crate::shared::speed_log::scope("db.fts_search");
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    // Build a safe FTS5 query: quote each token, append * to the last one for
    // prefix matching. This avoids injection via special FTS5 syntax characters.
    let tokens: Vec<String> = query
        .split_whitespace()
        .map(|t| {
            let escaped = t.replace('"', "\"\"");
            format!("\"{escaped}\"")
        })
        .collect();

    let fts_query = if tokens.is_empty() {
        return Ok(vec![]);
    } else {
        let mut q = tokens.join(" ");
        // Append prefix wildcard to the last token so typing "rust" also
        // matches "rustacean".
        if q.ends_with('"') {
            q.truncate(q.len() - 1);
            q.push_str("*\"");
        }
        q
    };

    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let mut stmt = conn
        .prepare(
            "SELECT id FROM notes_fts WHERE notes_fts MATCH ?1
             ORDER BY rank LIMIT ?2",
        )
        .map_err(|e| AppError::Other(e.to_string()))?;

    let ids = stmt
        .query_map(params![fts_query, limit as i64], |row| row.get(0))
        .map_err(|e| AppError::Other(e.to_string()))?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| AppError::Other(e.to_string()))?;

    Ok(ids)
}

/// Rebuild the entire FTS index from the current KV store. Called once on first
/// launch after the table is created, and available as a Tauri command for
/// maintenance / after a bulk import.
pub(crate) fn fts_rebuild(pool: &DbPool) -> Result<usize, AppError> {
    let _t = crate::shared::speed_log::scope("db.fts_rebuild");
    fn extract_text(value: &Value) -> String {
        let mut parts = Vec::new();
        fn visit(node: &Value, parts: &mut Vec<String>) {
            if let Some(text) = node.get("text").and_then(Value::as_str) {
                parts.push(text.to_owned());
            }
            if let Some(children) = node.get("content").and_then(Value::as_array) {
                for child in children {
                    visit(child, parts);
                }
            }
        }
        visit(value, &mut parts);
        parts.join(" ")
    }

    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let mut stmt_sel = conn
        .prepare("SELECT key, value FROM kv WHERE key LIKE 'notes.%'")
        .map_err(|e| AppError::Other(e.to_string()))?;
    let note_rows: Vec<(String, Value)> = stmt_sel
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let raw: String = row.get(1)?;
            let value = serde_json::from_str(&raw).unwrap_or(Value::String(raw));
            Ok((key, value))
        })
        .map_err(|e| AppError::Other(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt_sel);

    let mut count = 0;
    let mut conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let tx = conn.transaction().map_err(|e| AppError::Other(e.to_string()))?;
    tx.execute("DELETE FROM notes_fts", [])
        .map_err(|e| AppError::Other(e.to_string()))?;

    {
        let mut stmt = tx
            .prepare("INSERT INTO notes_fts (id, title, body) VALUES (?1, ?2, ?3)")
            .map_err(|e| AppError::Other(e.to_string()))?;

        for (key, value) in &note_rows {
            let Some(id) = key.strip_prefix("notes.") else {
                continue;
            };
            let title = value
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let body = if let Some(content) = value.get("content") {
                extract_text(content)
            } else if let Some(text) = value.get("searchText").and_then(Value::as_str) {
                text.to_owned()
            } else {
                String::new()
            };

            stmt.execute(params![id, title, body])
                .map_err(|e| AppError::Other(e.to_string()))?;
            count += 1;
        }
    }

    tx.commit().map_err(|e| AppError::Other(e.to_string()))?;
    Ok(count)
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
/// `yrs` CRDT engine (wire-compatible with the JS `yjs` library). The result is
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
    let doc = yrs::Doc::new();
    {
        let mut txn = doc.transact_mut();
        for (_, blob) in rows {
            let update = yrs::Update::decode_v1(&blob).map_err(|e| AppError::Other(e.to_string()))?;
            txn.apply_update(update).map_err(|e| AppError::Other(e.to_string()))?;
        }
    }
    let snapshot = doc
        .transact_mut()
        .encode_state_as_update_v1(&yrs::StateVector::default());
    // Store the snapshot encrypted (write_snapshot handles encryption internally).
    write_snapshot(pool, note_id, &snapshot, key)?;
    Ok(snapshot)
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

    let mut stmt = conn
        .prepare(&format!(
            "SELECT note_id, MAX(created_at) FROM note_content WHERE note_id IN ({placeholders}) GROUP BY note_id"
        ))
        .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(note_ids.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| AppError::Other(e.to_string()))?;
    let latest: HashMap<String, i64> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Other(e.to_string()))?
        .into_iter()
        .collect();

    // Decrypt all cached snapshots in parallel. AES-GCM is independent per
    // blob, so this scales with cores; on a 100+ note vault this is the bulk
    // of the `yjs_get_snapshots` cost.
    let decrypted: Vec<(String, Vec<u8>)> = snapshots
        .par_iter()
        .filter(|(note_id, data, updated_at)| {
            let stale = latest
                .get(note_id)
                .is_some_and(|&t| t > *updated_at);
            !data.is_empty() && !stale && (key.is_some() || !is_encrypted_yjs_blob(data))
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

// ─── Yjs snapshot cache helpers (yrs-backed) ───────────────────────────────────

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
fn snapshot_is_stale(pool: &DbPool, note_id: &str, snapshot_updated_at: i64) -> Result<bool, AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let latest: Option<i64> = conn
        .query_row(
            "SELECT MAX(created_at) FROM note_content WHERE note_id = ?1",
            rusqlite::params![note_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(latest.is_some_and(|latest| latest > snapshot_updated_at))
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
