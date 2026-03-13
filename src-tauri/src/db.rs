use std::path::Path;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, OptionalExtension};
use serde_json::{Map, Value};

pub(crate) type DbPool = Pool<SqliteConnectionManager>;

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
       PRAGMA synchronous=NORMAL;
       CREATE TABLE IF NOT EXISTS kv (
         key   TEXT PRIMARY KEY NOT NULL,
         value TEXT NOT NULL
       );",
    )
    .map_err(|e| e.to_string())?;
    Ok(pool)
}

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

#[allow(dead_code)]
pub(crate) fn db_delete(pool: &DbPool, key: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM kv WHERE key = ?1", params![key])
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
