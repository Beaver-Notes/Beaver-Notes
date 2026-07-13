use std::path::Path;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, OptionalExtension};
use serde_json::{Map, Value};
use yrs::updates::decoder::Decode;
use yrs::{ReadTxn, Transact};

use crate::shared::{decrypt_yjs_blob, encrypt_yjs_blob};

pub(crate) type DbPool = Pool<SqliteConnectionManager>;

/// Schema version — increment when tables/indexes change.
/// Must stay in sync with `SCHEMA_VERSION` in the migration function below.
const SCHEMA_VERSION: i64 = 1;

/// DDL for every schema version. Each entry runs all statements from version N
/// to N+1. Add new migrations here and bump `SCHEMA_VERSION` above.
fn migrate(conn: &rusqlite::Connection, from: i64) -> Result<(), String> {
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
            );",
        )
        .map_err(|e| e.to_string())?;
    }

    // Future migrations go here, e.g.:
    // if from < 2 {
    //     conn.execute_batch("ALTER TABLE kv ADD COLUMN created_at INTEGER; ...")
    //         .map_err(|e| e.to_string())?;
    // }

    Ok(())
}

pub(crate) fn open_pool(path: &Path) -> Result<DbPool, String> {
    std::fs::create_dir_all(path.parent().unwrap_or(path)).map_err(|e| e.to_string())?;
    let manager = SqliteConnectionManager::file(path).with_flags(
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_CREATE,
    );
    let pool = Pool::builder()
        .max_size(4)
        .build(manager)
        .map_err(|e| e.to_string())?;
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
        PRAGMA case_sensitive_like = OFF;
        PRAGMA synchronous=NORMAL;",
    )
    .map_err(|e| e.to_string())?;

    // Run schema migration
    let current: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap_or(0);
    if current < SCHEMA_VERSION {
        migrate(&conn, current).map_err(|e| format!("migration v{current}→{SCHEMA_VERSION}: {e}"))?;
        conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
            .map_err(|e| e.to_string())?;
    }

    Ok(pool)
}

// ─── Basic KV operations ─────────────────────────────────────────────────────

pub(crate) fn db_get(pool: &DbPool, key: &str) -> Result<Option<String>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.query_row("SELECT value FROM kv WHERE key = ?1", params![key], |row| {
        row.get(0)
    })
    .optional()
    .map_err(|e| e.to_string())
}

pub(crate) fn db_set(pool: &DbPool, key: &str, value: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn db_has(pool: &DbPool, key: &str) -> Result<bool, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM kv WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

pub(crate) fn db_delete(pool: &DbPool, key: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM kv WHERE key = ?1", params![key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn db_clear(pool: &DbPool) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM kv", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn db_all(pool: &DbPool) -> Result<Map<String, Value>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM kv")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let raw: String = row.get(1)?;
            let value = serde_json::from_str(&raw).unwrap_or(Value::String(raw));
            Ok((key, value))
        })
        .map_err(|e| e.to_string())?;

    let mut map = Map::new();
    for row in rows {
        let (key, value) = row.map_err(|e| e.to_string())?;
        map.insert(key, value);
    }
    Ok(map)
}

pub(crate) fn db_replace_all(pool: &DbPool, data: Map<String, Value>) -> Result<(), String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM kv", [])
        .map_err(|e| e.to_string())?;

    {
        let mut stmt = tx
            .prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)")
            .map_err(|e| e.to_string())?;
        for (key, value) in data {
            let serialized = serde_json::to_string(&value).map_err(|e| e.to_string())?;
            stmt.execute(params![key, serialized])
                .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())
}

// ─── FTS5 helpers ─────────────────────────────────────────────────────────────

/// Upsert a note into the FTS index. `body` should be a pre-extracted plain-text
/// string (no JSON, no markup). Call this every time a note is saved.
pub(crate) fn fts_upsert(pool: &DbPool, id: &str, title: &str, body: &str) -> Result<(), String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM notes_fts WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO notes_fts (id, title, body) VALUES (?1, ?2, ?3)",
        params![id, title, body],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Remove a note from the FTS index. Call this when a note is deleted.
pub(crate) fn fts_delete(pool: &DbPool, id: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM notes_fts WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Full-text search. Returns a list of note IDs whose title or body match the
/// query. Uses FTS5's MATCH operator with a prefix search on the last token so
/// partial words (e.g. "rustac" matching "rustacean") work while the user types.
/// Returns at most `limit` results (default 200).
pub(crate) fn fts_search(pool: &DbPool, query: &str, limit: usize) -> Result<Vec<String>, String> {
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

    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id FROM notes_fts WHERE notes_fts MATCH ?1
             ORDER BY rank LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let ids = stmt
        .query_map(params![fts_query, limit as i64], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(ids)
}

/// Rebuild the entire FTS index from the current KV store. Called once on first
/// launch after the table is created, and available as a Tauri command for
/// maintenance / after a bulk import.
pub(crate) fn fts_rebuild(pool: &DbPool) -> Result<usize, String> {
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

    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt_sel = conn
        .prepare("SELECT key, value FROM kv WHERE key LIKE 'notes.%'")
        .map_err(|e| e.to_string())?;
    let note_rows: Vec<(String, Value)> = stmt_sel
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let raw: String = row.get(1)?;
            let value = serde_json::from_str(&raw).unwrap_or(Value::String(raw));
            Ok((key, value))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt_sel);

    let mut count = 0;
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM notes_fts", [])
        .map_err(|e| e.to_string())?;

    {
        let mut stmt = tx
            .prepare("INSERT INTO notes_fts (id, title, body) VALUES (?1, ?2, ?3)")
            .map_err(|e| e.to_string())?;

        for (key, value) in &note_rows {
            let Some(id) = key.strip_prefix("notes.") else {
                continue;
            };
            let title = value
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let content = value.get("content").unwrap_or(&Value::Null);
            let body = extract_text(content);

            stmt.execute(params![id, title, body])
                .map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(count)
}

// ─── Yjs note-content helpers ─────────────────────────────────────────────────

/// Append a Yjs binary update for a note. The raw update is kept (append-only
/// so every peer's version is preserved) and is also folded into the cached
/// merged snapshot, so reads stay O(1) regardless of edit history.
///
/// When `key` is `Some`, the stored blob is encrypted at rest. The fold
/// operation works on decrypted data so the CRDT merge stays correct.
pub(crate) fn yjs_append(
    pool: &DbPool,
    note_id: &str,
    blob: &[u8],
    device: &str,
    key: Option<[u8; 32]>,
) -> Result<(), String> {
    // Encrypt the blob for storage (no-op when key is None).
    let stored = match key {
        Some(k) => encrypt_yjs_blob(&k, blob).map_err(|e| e.to_string())?,
        None => blob.to_vec(),
    };
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO note_content (note_id, data, device, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![note_id, stored, device, chrono::Utc::now().timestamp_millis()],
    )
    .map_err(|e| e.to_string())?;
    // Fold the *raw* (unencrypted) blob into the cached snapshot.
    let _ = fold_snapshot(pool, note_id, blob, key);
    Ok(())
}

/// Return all Yjs updates for a note, ordered by insertion.
/// Kept for backwards compatibility / migration; prefer `yjs_get_snapshot`.
/// When `key` is `Some`, each blob is decrypted before returning.
pub(crate) fn yjs_get_updates(
    pool: &DbPool,
    note_id: &str,
    key: Option<[u8; 32]>,
) -> Result<Vec<(i64, Vec<u8>)>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, data FROM note_content WHERE note_id = ?1 ORDER BY id ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![note_id], |row| {
            let id: i64 = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            Ok((id, blob))
        })
        .map_err(|e| e.to_string())?;
    rows.map(|r| {
        r.map(|(id, blob)| {
            let decrypted = match key {
                Some(k) => decrypt_yjs_blob(&k, &blob).unwrap_or(blob),
                None => blob,
            };
            (id, decrypted)
        })
    })
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

/// Return a single merged Yjs state snapshot for a note, computed with the
/// `yrs` CRDT engine (wire-compatible with the JS `yjs` library). The result is
/// cached in `yjs_snapshots`, so repeated reads are O(1) regardless of edit
/// history length. When `key` is `Some`, the snapshot is decrypted before return.
pub(crate) fn yjs_get_snapshot(
    pool: &DbPool,
    note_id: &str,
    key: Option<[u8; 32]>,
) -> Result<Vec<u8>, String> {
    if let Some(cached) = read_snapshot(pool, note_id)? {
        if !cached.is_empty() {
            return match key {
                Some(k) => decrypt_yjs_blob(&k, &cached).map_err(|e| e.to_string()),
                None => Ok(cached),
            };
        }
    }
    let rows = yjs_get_updates(pool, note_id, key)?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let doc = yrs::Doc::new();
    {
        let mut txn = doc.transact_mut();
        for (_, blob) in rows {
            let update = yrs::Update::decode_v1(&blob).map_err(|e| e.to_string())?;
            txn.apply_update(update).map_err(|e| e.to_string())?;
        }
    }
    let snapshot = doc
        .transact_mut()
        .encode_state_as_update_v1(&yrs::StateVector::default());
    // Store the snapshot encrypted (fold_snapshot handles encryption internally).
    write_snapshot(pool, note_id, &snapshot, key)?;
    Ok(snapshot)
}

/// Replace all updates for a note with a single compressed snapshot, and keep
/// the merged `yjs_snapshots` cache in sync with it. When `key` is `Some`,
/// the stored snapshot is encrypted.
pub(crate) fn yjs_compact(
    pool: &DbPool,
    note_id: &str,
    snapshot: &[u8],
    key: Option<[u8; 32]>,
) -> Result<(), String> {
    // Encrypt the snapshot for storage.
    let stored = match key {
        Some(k) => encrypt_yjs_blob(&k, snapshot).map_err(|e| e.to_string())?,
        None => snapshot.to_vec(),
    };
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM note_content WHERE note_id = ?1",
        rusqlite::params![note_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO note_content (note_id, data, device, created_at) VALUES (?1, ?2, '', ?3)",
        rusqlite::params![note_id, stored, chrono::Utc::now().timestamp_millis()],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    write_snapshot(pool, note_id, snapshot, key)?;
    Ok(())
}

/// Delete all Yjs updates for a note. Called when the note itself is deleted.
pub(crate) fn yjs_delete(pool: &DbPool, note_id: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM note_content WHERE note_id = ?1",
        rusqlite::params![note_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM yjs_snapshots WHERE note_id = ?1",
        rusqlite::params![note_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Yjs snapshot cache helpers (yrs-backed) ───────────────────────────────────

fn read_snapshot(pool: &DbPool, note_id: &str) -> Result<Option<Vec<u8>>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT data FROM yjs_snapshots WHERE note_id = ?1")
        .map_err(|e| e.to_string())?;
    let row = stmt
        .query_row(rusqlite::params![note_id], |r| r.get::<_, Vec<u8>>(0))
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(row)
}

fn write_snapshot(
    pool: &DbPool,
    note_id: &str,
    data: &[u8],
    key: Option<[u8; 32]>,
) -> Result<(), String> {
    let stored = match key {
        Some(k) => encrypt_yjs_blob(&k, data).map_err(|e| e.to_string())?,
        None => data.to_vec(),
    };
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO yjs_snapshots (note_id, data, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(note_id) DO UPDATE SET data = ?2, updated_at = ?3",
        rusqlite::params![note_id, stored, chrono::Utc::now().timestamp_millis()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Fold a single update into the cached merged snapshot (O(1) on read). If no
/// snapshot exists yet, the fold is skipped — `yjs_get_snapshot` will build it
/// from history lazily on the next read. The `blob` parameter is always raw
/// (unencrypted); the existing snapshot is decrypted internally when `key` is
/// provided, and the merged result is encrypted before writing back.
fn fold_snapshot(
    pool: &DbPool,
    note_id: &str,
    blob: &[u8],
    key: Option<[u8; 32]>,
) -> Result<(), String> {
    let Some(existing_encrypted) = read_snapshot(pool, note_id)? else {
        return Ok(());
    };
    if existing_encrypted.is_empty() {
        return Ok(());
    }
    // Decrypt the existing snapshot so the CRDT merge sees raw Yjs data.
    let existing = match key {
        Some(k) => decrypt_yjs_blob(&k, &existing_encrypted).map_err(|e| e.to_string())?,
        None => existing_encrypted,
    };
    let doc = yrs::Doc::new();
    doc.transact_mut()
        .apply_update(yrs::Update::decode_v1(&existing).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    doc.transact_mut()
        .apply_update(yrs::Update::decode_v1(blob).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let snapshot = doc
        .transact_mut()
        .encode_state_as_update_v1(&yrs::StateVector::default());
    // write_snapshot encrypts internally when key is provided.
    write_snapshot(pool, note_id, &snapshot, key)?;
    Ok(())
}
