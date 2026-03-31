use std::path::Path;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{ params, OptionalExtension };
use serde_json::{ Map, Value };

pub(crate) type DbPool = Pool<SqliteConnectionManager>;

pub(crate) fn open_pool(path: &Path) -> Result<DbPool, String> {
  std::fs::create_dir_all(path.parent().unwrap_or(path)).map_err(|e| e.to_string())?;
  let manager = SqliteConnectionManager::file(path).with_flags(
    rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_CREATE
  );
  let pool = Pool::builder()
    .max_size(4)
    .build(manager)
    .map_err(|e| e.to_string())?;
  let conn = pool.get().map_err(|e| e.to_string())?;
  conn
    .execute_batch(
      "PRAGMA journal_mode=WAL;
       PRAGMA case_sensitive_like = OFF;
       PRAGMA synchronous=NORMAL;
       CREATE TABLE IF NOT EXISTS kv (
         key   TEXT PRIMARY KEY NOT NULL,
         value TEXT NOT NULL
       );
       -- FTS5 index: one row per note. title and body are tokenised; id is stored verbatim.
       CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
         id    UNINDEXED,
         title,
         body,
         tokenize = 'unicode61 remove_diacritics 1'
       );"
    )
    .map_err(|e| e.to_string())?;
  Ok(pool)
}

// ─── Basic KV operations ─────────────────────────────────────────────────────

pub(crate) fn db_get(pool: &DbPool, key: &str) -> Result<Option<String>, String> {
  let conn = pool.get().map_err(|e| e.to_string())?;
  conn
    .query_row("SELECT value FROM kv WHERE key = ?1", params![key], |row| { row.get(0) })
    .optional()
    .map_err(|e| e.to_string())
}

pub(crate) fn db_set(pool: &DbPool, key: &str, value: &str) -> Result<(), String> {
  let conn = pool.get().map_err(|e| e.to_string())?;
  conn
    .execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)", params![key, value])
    .map_err(|e| e.to_string())?;
  Ok(())
}

pub(crate) fn db_has(pool: &DbPool, key: &str) -> Result<bool, String> {
  let conn = pool.get().map_err(|e| e.to_string())?;
  let count: i64 = conn
    .query_row("SELECT COUNT(*) FROM kv WHERE key = ?1", params![key], |row| row.get(0))
    .map_err(|e| e.to_string())?;
  Ok(count > 0)
}

pub(crate) fn db_delete(pool: &DbPool, key: &str) -> Result<(), String> {
  let conn = pool.get().map_err(|e| e.to_string())?;
  conn.execute("DELETE FROM kv WHERE key = ?1", params![key]).map_err(|e| e.to_string())?;
  Ok(())
}

pub(crate) fn db_clear(pool: &DbPool) -> Result<(), String> {
  let conn = pool.get().map_err(|e| e.to_string())?;
  conn.execute("DELETE FROM kv", []).map_err(|e| e.to_string())?;
  Ok(())
}

pub(crate) fn db_all(pool: &DbPool) -> Result<Map<String, Value>, String> {
  let conn = pool.get().map_err(|e| e.to_string())?;
  let mut stmt = conn.prepare("SELECT key, value FROM kv").map_err(|e| e.to_string())?;
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
  tx.execute("DELETE FROM kv", []).map_err(|e| e.to_string())?;

  {
    let mut stmt = tx
      .prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)")
      .map_err(|e| e.to_string())?;
    for (key, value) in data {
      let serialized = serde_json::to_string(&value).map_err(|e| e.to_string())?;
      stmt.execute(params![key, serialized]).map_err(|e| e.to_string())?;
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
  tx.execute("DELETE FROM notes_fts WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
  tx
    .execute(
      "INSERT INTO notes_fts (id, title, body) VALUES (?1, ?2, ?3)",
      params![id, title, body]
    )
    .map_err(|e| e.to_string())?;
  tx.commit().map_err(|e| e.to_string())
}

/// Remove a note from the FTS index. Call this when a note is deleted.
pub(crate) fn fts_delete(pool: &DbPool, id: &str) -> Result<(), String> {
  let conn = pool.get().map_err(|e| e.to_string())?;
  conn.execute("DELETE FROM notes_fts WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
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
    .prepare("SELECT id FROM notes_fts WHERE notes_fts MATCH ?1
             ORDER BY rank LIMIT ?2")
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
  // Extract plain text from a ProseMirror content JSON value
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

  let all = db_all(pool)?;
  let mut count = 0;

  let mut conn = pool.get().map_err(|e| e.to_string())?;
  let tx = conn.transaction().map_err(|e| e.to_string())?;
  tx.execute("DELETE FROM notes_fts", []).map_err(|e| e.to_string())?;

  {
    let mut stmt = tx
      .prepare("INSERT INTO notes_fts (id, title, body) VALUES (?1, ?2, ?3)")
      .map_err(|e| e.to_string())?;

    for (key, value) in &all {
      let Some(id) = key.strip_prefix("notes.") else {
        continue;
      };
      let title = value.get("title").and_then(Value::as_str).unwrap_or_default();
      let content = value.get("content").unwrap_or(&Value::Null);
      let body = extract_text(content);

      stmt.execute(params![id, title, body]).map_err(|e| e.to_string())?;
      count += 1;
    }
  }

  tx.commit().map_err(|e| e.to_string())?;
  Ok(count)
}
