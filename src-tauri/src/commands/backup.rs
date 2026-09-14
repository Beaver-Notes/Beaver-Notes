use std::path::{Path, PathBuf};

use rusqlite::params;
use tauri::{AppHandle, Manager};

use crate::shared::*;

/// Tables replicated wholesale between a backup folder and the live pools.
const BACKUP_TABLES: &[&str] = &["kv", "note_content", "yjs_snapshots"];
const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";


/// Byte-for-byte recursive copy (no re-encryption): assets are already
/// encrypted-at-rest where applicable, so the archive mirrors disk.
fn copy_dir_raw(src: &Path, dest: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_raw(&src_path, &dest_path)?;
        } else {
            std::fs::copy(&src_path, &dest_path)?;
        }
    }
    Ok(())
}

/// Verify `path` is SQLite at/below the current schema version with every
/// expected table present. Runs before anything is modified.
fn validate_backup_db(path: &Path, label: &str) -> Result<(), AppError> {
    use std::io::Read;

    let mut file = std::fs::File::open(path)
        .map_err(|e| AppError::Other(format!("[backup] missing {label}: {e}")))?;
    let mut header = [0u8; 16];
    file.read_exact(&mut header)
        .map_err(|e| AppError::Other(format!("[backup] unreadable {label}: {e}")))?;
    if &header != SQLITE_HEADER {
        return Err(AppError::Other(format!(
            "[backup] {label} is not a SQLite database"
        )));
    }

    let conn =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| AppError::Other(e.to_string()))?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| AppError::Other(e.to_string()))?;
    if version > crate::db::SCHEMA_VERSION {
        return Err(AppError::Other(
            "[backup] this backup was created by a newer app version — update the app first".into(),
        ));
    }
    for table in BACKUP_TABLES {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |row| row.get(0),
            )
            .map_err(|e| AppError::Other(e.to_string()))?;
        if count == 0 {
            return Err(AppError::Other(format!(
                r#"[backup] {label} is missing table "{table}""#
            )));
        }
    }
    Ok(())
}

/// Replace every row of the live database with the backup's rows, atomically
/// (DELETE + INSERT SELECT per table inside one transaction).
fn import_db(pool: &crate::db::DbPool, src: &Path) -> Result<(), AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    conn.execute(
        "ATTACH DATABASE ?1 AS backup_src",
        params![src.to_string_lossy()],
    )
    .map_err(|e| AppError::Other(e.to_string()))?;

    let result = (|| {
        conn.execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| AppError::Other(e.to_string()))?;
        if let Err(e) = BACKUP_TABLES.iter().try_for_each(|table| {
            conn.execute(&format!("DELETE FROM main.{table}"), [])
                .map_err(|e| AppError::Other(e.to_string()))?;
            conn.execute(
                &format!("INSERT INTO main.{table} SELECT * FROM backup_src.{table}"),
                [],
            )
            .map_err(|e| AppError::Other(e.to_string()))?;
            Ok::<(), AppError>(())
        }) {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(e);
        }
        conn.execute_batch("COMMIT")
            .map_err(|e| AppError::Other(e.to_string()))
    })();

    let _ = conn.execute_batch("DETACH DATABASE backup_src");
    result
}


/// Export a full-state backup folder (clean DB copies + global assets):
/// `<dir>/data.db`, `<dir>/settings.db`, `<dir>/assets/`
#[tauri::command]
#[specta::specta]
pub(crate) async fn backup_export(app: AppHandle, dir: String) -> Result<(), AppError> {
    // VACUUM INTO + recursive asset copy are I/O heavy.
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let dest = PathBuf::from(&dir);
        assert_path_access(&app, &state, &dest, "backup destination")?;
        std::fs::create_dir_all(&dest)?;

        for (name, pool) in [
            ("data.db", data_pool(&app, &state)?),
            ("settings.db", settings_pool(&app, &state)?),
        ] {
            let target = dest.join(name);
            // VACUUM INTO fails if the target exists.
            if target.exists() {
                std::fs::remove_file(&target)?;
            }
            let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
            conn.execute("VACUUM INTO ?1", params![target.to_string_lossy()])
                .map_err(|e| AppError::Other(e.to_string()))?;
        }

        let assets_src = app_storage_dir(&app, &state)?.join("assets");
        if assets_src.is_dir() {
            copy_dir_raw(&assets_src, &dest.join("assets"))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

/// Import a backup folder from `backup_export`: replaces every row of both
/// live DBs and swaps the assets directory. Caller must relaunch afterwards so
/// cached state rehydrates.
#[tauri::command]
#[specta::specta]
pub(crate) async fn backup_import(app: AppHandle, dir: String) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let src = PathBuf::from(&dir);
        assert_path_access(&app, &state, &src, "backup source")?;

        // Validate everything first so a bad backup never leaves half-imported state.
        validate_backup_db(&src.join("data.db"), "data.db")?;
        validate_backup_db(&src.join("settings.db"), "settings.db")?;

        import_db(&settings_pool(&app, &state)?, &src.join("settings.db"))?;
        import_db(&data_pool(&app, &state)?, &src.join("data.db"))?;

        let assets_dest = app_storage_dir(&app, &state)?.join("assets");
        if assets_dest.exists() {
            std::fs::remove_dir_all(&assets_dest)?;
        }
        if src.join("assets").is_dir() {
            copy_dir_raw(&src.join("assets"), &assets_dest)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}
