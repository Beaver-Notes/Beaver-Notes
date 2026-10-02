use std::path::{Path, PathBuf};

use rusqlite::params;
use tauri::{AppHandle, Manager};

use crate::shared::*;

/// Tables replicated wholesale between a backup folder and the live pools.
const BACKUP_TABLES: &[&str] = &["kv", "note_content", "yjs_snapshots"];
const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";
/// Bundle-relative path of the exported encryption manifest (wrapped items key
/// + KDF params only — never a plaintext key).
pub(crate) const BACKUP_MANIFEST: &str = "manifest.v2.json";
/// Bundle-relative folder holding one subfolder per exported workspace. Bundles
/// written before multi-workspace export kept `data.db`/`settings.db` at the
/// bundle root; import still reads that legacy layout.
pub(crate) const BACKUP_WORKSPACES_DIR: &str = "workspaces";
/// Rows sampled per table when probing whether a backup decrypts with a key.
const KEY_PROBE_ROWS: i64 = 50;


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

/// One workspace's live DB files to include in a backup bundle.
#[derive(Debug, Clone)]
pub(crate) struct ExportSource {
    pub(crate) id: String,
    pub(crate) data: PathBuf,
    pub(crate) settings: PathBuf,
}

/// Reject workspace folder names that could escape the bundle's workspaces dir.
fn is_safe_bundle_workspace_id(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
        && !name.contains("..")
        && !name.starts_with('.')
        && !name.ends_with('.')
}

/// Copy each selected workspace's DBs into `<dest>/workspaces/<id>/` with
/// `VACUUM INTO` through a read-only source connection (the source is never
/// mutated), staging every file beside its target and renaming only once all
/// copies succeeded. Workspace folders no longer selected are pruned last so a
/// later import cannot resurrect a workspace the user chose to exclude.
fn export_workspace_dbs(sources: &[ExportSource], dest: &Path) -> Result<(), AppError> {
    let pid = std::process::id();
    let workspaces_root = dest.join(BACKUP_WORKSPACES_DIR);
    let mut staged: Vec<(PathBuf, PathBuf)> = Vec::new();
    let cleanup = |staged: &[(PathBuf, PathBuf)]| {
        for (tmp, _) in staged {
            let _ = std::fs::remove_file(tmp);
        }
    };

    for source in sources {
        if !is_safe_bundle_workspace_id(&source.id) {
            cleanup(&staged);
            return Err(AppError::Other(format!(
                "[backup] invalid workspace id: {}",
                source.id
            )));
        }
        let target_dir = workspaces_root.join(&source.id);
        std::fs::create_dir_all(&target_dir)?;
        for (name, path) in [("data.db", &source.data), ("settings.db", &source.settings)] {
            let target = target_dir.join(name);
            let tmp = target_dir.join(format!(".{name}.export-{pid}"));
            let _ = std::fs::remove_file(&tmp);
            let conn = rusqlite::Connection::open_with_flags(
                path,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .map_err(|e| {
                AppError::Other(format!("[backup] cannot read {}: {e}", path.display()))
            })?;
            if let Err(e) = conn.execute("VACUUM INTO ?1", params![tmp.to_string_lossy()]) {
                let _ = std::fs::remove_file(&tmp);
                cleanup(&staged);
                return Err(AppError::Other(e.to_string()));
            }
            staged.push((tmp, target));
        }
    }

    for (tmp, target) in &staged {
        std::fs::rename(tmp, target)?;
    }

    let selected: std::collections::HashSet<&str> =
        sources.iter().map(|s| s.id.as_str()).collect();
    if let Ok(entries) = std::fs::read_dir(&workspaces_root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if entry.path().is_dir() && !selected.contains(name.as_str()) {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
    Ok(())
}

/// A workspace's DBs inside a backup bundle. `id` is `None` for the legacy
/// single-workspace layout (top-level `data.db`/`settings.db`), which restores
/// into the active workspace like older builds did.
#[derive(Debug, Clone)]
pub(crate) struct BundleWorkspace {
    pub(crate) id: Option<String>,
    pub(crate) dir: PathBuf,
}

/// Discover the workspaces a bundle holds: the `workspaces/<id>/` layout when
/// present, else the legacy root-level single-workspace layout.
fn discover_bundle_workspaces(bundle: &Path) -> Result<Vec<BundleWorkspace>, AppError> {
    let workspaces_dir = bundle.join(BACKUP_WORKSPACES_DIR);
    if workspaces_dir.is_dir() {
        let mut out = Vec::new();
        for entry in std::fs::read_dir(&workspaces_dir)? {
            let entry = entry?;
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_safe_bundle_workspace_id(&name) || !is_path_inside(&workspaces_dir, &dir) {
                return Err(AppError::Other(format!(
                    "[backup] bundle has an unsafe workspace folder: {name}"
                )));
            }
            out.push(BundleWorkspace {
                id: Some(name),
                dir,
            });
        }
        out.sort_by(|a, b| a.id.cmp(&b.id));
        if !out.is_empty() {
            return Ok(out);
        }
    }
    if bundle.join("data.db").is_file() || bundle.join("settings.db").is_file() {
        return Ok(vec![BundleWorkspace {
            id: None,
            dir: bundle.to_path_buf(),
        }]);
    }
    Err(AppError::Other(
        "[backup] this folder is not a Beaver Notes backup: no workspace databases found".into(),
    ))
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

/// How the payloads in a backup bundle relate to a candidate vault key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BundleKeyMatch {
    /// No encrypted payloads: import needs no key at all.
    Plaintext,
    /// Every encrypted payload decrypts with the candidate key (same vault).
    SameKey,
    /// Encrypted under a different vault key; the source key is required.
    DifferentKey,
}

/// Read a bounded sample of payload blobs from the tables that carry encrypted
/// at-rest data, tolerating TEXT (`kv`) and BLOB columns alike.
fn sample_db_payloads(db: &Path) -> Result<Vec<Vec<u8>>, AppError> {
    let conn = rusqlite::Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| AppError::Other(e.to_string()))?;
    let mut out = Vec::new();
    for (table, column) in [
        ("kv", "value"),
        ("note_content", "data"),
        ("yjs_snapshots", "data"),
    ] {
        let sql = format!("SELECT {column} FROM {table} LIMIT {KEY_PROBE_ROWS}");
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| AppError::Other(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| match row.get_ref(0)? {
                rusqlite::types::ValueRef::Blob(b) => Ok(b.to_vec()),
                rusqlite::types::ValueRef::Text(t) => Ok(t.to_vec()),
                _ => Ok(Vec::new()),
            })
            .map_err(|e| AppError::Other(e.to_string()))?;
        for row in rows {
            out.push(row.map_err(|e| AppError::Other(e.to_string()))?);
        }
    }
    Ok(out)
}

/// First encrypted asset anywhere under `root`, or `None`.
fn first_encrypted_asset(root: &Path) -> Result<Option<PathBuf>, AppError> {
    if !root.is_dir() {
        return Ok(None);
    }
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(&dir)? {
            let path = entry?.path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }
            if !path.is_file() {
                continue;
            }
            let Ok(mut file) = std::fs::File::open(&path) else {
                continue;
            };
            use std::io::Read;
            let mut magic = [0u8; 4];
            if file.read_exact(&mut magic).is_err() {
                continue;
            }
            let size = file.metadata().map(|m| m.len()).unwrap_or(0);
            if is_encrypted_asset_header(&magic, size) {
                return Ok(Some(path));
            }
        }
    }
    Ok(None)
}

/// Whether an encrypted asset decrypts with `key`. Streams to a throwaway temp
/// file so validation never loads the whole asset into memory.
fn asset_decrypts_with_key(path: &Path, key: &[u8; 32]) -> bool {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let out = std::env::temp_dir().join(format!(
        ".beaver-backup-asset-probe-{}-{stamp}",
        std::process::id()
    ));
    let ok = decrypt_asset_streaming(path, &out, key).is_ok();
    let _ = std::fs::remove_file(&out);
    ok
}

/// Classify a bundle against `target_key` by decrypting sample payloads, never
/// by trusting headers. A wrong key leaves every encrypted blob undecryptable.
fn bundle_key_match(
    bundle: &Path,
    target_key: Option<&[u8; 32]>,
) -> Result<BundleKeyMatch, AppError> {
    let mut saw_encrypted = false;
    for workspace in discover_bundle_workspaces(bundle)? {
        for name in ["data.db", "settings.db"] {
            for blob in sample_db_payloads(&workspace.dir.join(name))? {
                if !is_encrypted_yjs_blob(&blob) {
                    continue;
                }
                saw_encrypted = true;
                if let Some(key) = target_key {
                    if decrypt_yjs_blob(key, &blob).is_ok() {
                        return Ok(BundleKeyMatch::SameKey);
                    }
                }
            }
        }
    }
    if saw_encrypted {
        return Ok(BundleKeyMatch::DifferentKey);
    }
    // No encrypted DB rows: an encrypted asset still marks a foreign vault.
    if let Some(asset) = first_encrypted_asset(&bundle.join("assets"))? {
        if target_key.is_some_and(|key| asset_decrypts_with_key(&asset, key)) {
            return Ok(BundleKeyMatch::SameKey);
        }
        return Ok(BundleKeyMatch::DifferentKey);
    }
    Ok(BundleKeyMatch::Plaintext)
}

/// Derive the source items key from the manifest carried in the bundle. The
/// manifest only ever holds a wrapped key, so this stays zero-knowledge.
fn unlock_bundle_key(bundle: &Path, passphrase: &str) -> Result<[u8; 32], AppError> {
    let manifest = load_encryption_manifest(&bundle.join(BACKUP_MANIFEST))?.ok_or_else(|| {
        AppError::Other(
            "[backup] this backup is encrypted but carries no vault manifest, so it cannot be re-encrypted with a different vault key"
                .into(),
        )
    })?;
    let (key, _kek) = unlock_key_from_manifest(
        &manifest,
        passphrase,
        APP_ENCRYPTION_SCOPE,
        APP_PASSWORD_CHECK,
    )?;
    Ok(key)
}

/// Re-encrypt every payload of a staged backup DB from the source to the target
/// key, reusing the shared row sweeper, then checkpoint so the staged file is a
/// single self-contained database for `ATTACH`. Push cursors are reset like the
/// vault-join migration so the imported rows republish under the target key.
fn reencrypt_staged_db(
    path: &Path,
    source_key: &[u8; 32],
    target_key: &[u8; 32],
) -> Result<u64, AppError> {
    let pool = crate::db::open_pool(path)?;
    let migrated = crate::db::reencrypt_payloads_for_key(&pool, source_key, target_key, None)?;
    crate::db::reset_transport_push_cursors(&pool)?;
    {
        let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .map_err(|e| AppError::Other(e.to_string()))?;
    }
    drop(pool);
    Ok(migrated)
}

/// Stage the live encryption manifest into the bundle beside its final path,
/// mirroring the DB staging: the caller renames it into place only once the
/// whole bundle is ready. Returns `None` when the app has no manifest.
fn stage_bundle_manifest(
    manifest_src: &Path,
    dest: &Path,
) -> Result<Option<(PathBuf, PathBuf)>, AppError> {
    if !manifest_src.is_file() {
        return Ok(None);
    }
    let target = dest.join(BACKUP_MANIFEST);
    let tmp = dest.join(format!(".{BACKUP_MANIFEST}.export-{}", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    std::fs::copy(manifest_src, &tmp)?;
    Ok(Some((tmp, target)))
}

/// A bundle prepared for import: DBs and assets copied to `staging_dir` and, if
/// the bundle came from another vault, already re-encrypted to the target key.
/// The caller swaps these into live state only after `stage_import` succeeds, so
/// a bad key or corrupt bundle never leaves a partial import.
#[derive(Debug)]
pub(crate) struct StagedWorkspace {
    pub(crate) id: Option<String>,
    pub(crate) data_db: PathBuf,
    pub(crate) settings_db: PathBuf,
}

#[derive(Debug)]
pub(crate) struct StagedImport {
    pub(crate) workspaces: Vec<StagedWorkspace>,
    pub(crate) assets: Option<PathBuf>,
}

/// Copy a backup bundle into `staging_dir`, re-encrypting from the source vault
/// key to `target_key` when the payloads do not already decrypt with it. Returns
/// `AppError::VaultKeyRequired` when a different key is needed but absent.
fn stage_import(
    bundle: &Path,
    staging_dir: &Path,
    target_key: Option<&[u8; 32]>,
    source_passphrase: Option<&str>,
) -> Result<StagedImport, AppError> {
    let bundle_workspaces = discover_bundle_workspaces(bundle)?;
    for workspace in &bundle_workspaces {
        let label = workspace.id.as_deref().unwrap_or("data.db");
        validate_backup_db(&workspace.dir.join("data.db"), &format!("{label}/data.db"))?;
        validate_backup_db(
            &workspace.dir.join("settings.db"),
            &format!("{label}/settings.db"),
        )?;
    }

    let reencrypt = match bundle_key_match(bundle, target_key)? {
        BundleKeyMatch::Plaintext | BundleKeyMatch::SameKey => None,
        BundleKeyMatch::DifferentKey => {
            let Some(target) = target_key else {
                return Err(AppError::Other(
                    "[backup] this backup is encrypted, but this app has no vault key. Set up a vault key before importing."
                        .into(),
                ));
            };
            let Some(passphrase) = source_passphrase else {
                return Err(AppError::VaultKeyRequired);
            };
            Some((unlock_bundle_key(bundle, passphrase)?, *target))
        }
    };

    std::fs::create_dir_all(staging_dir)?;
    let mut workspaces = Vec::with_capacity(bundle_workspaces.len());
    for (index, bundle_workspace) in bundle_workspaces.iter().enumerate() {
        let dir = staging_dir.join(format!("ws-{index}"));
        std::fs::create_dir_all(&dir)?;
        let data_db = dir.join("data.db");
        let settings_db = dir.join("settings.db");
        std::fs::copy(bundle_workspace.dir.join("data.db"), &data_db)?;
        std::fs::copy(bundle_workspace.dir.join("settings.db"), &settings_db)?;
        workspaces.push(StagedWorkspace {
            id: bundle_workspace.id.clone(),
            data_db,
            settings_db,
        });
    }

    let assets = if bundle.join("assets").is_dir() {
        let out = staging_dir.join("assets");
        copy_dir_raw(&bundle.join("assets"), &out)?;
        Some(out)
    } else {
        None
    };

    if let Some((source_key, target)) = reencrypt {
        for workspace in &workspaces {
            reencrypt_staged_db(&workspace.data_db, &source_key, &target)?;
            reencrypt_staged_db(&workspace.settings_db, &source_key, &target)?;
        }
        if let Some(ref assets) = assets {
            crate::shared::migrate_assets(assets, &source_key, &target)?;
        }
    }

    Ok(StagedImport {
        workspaces,
        assets,
    })
}


/// Swap `staging` into `dest` (same parent). Any existing `dest` is moved
/// aside first and restored if the rename fails, so `dest` is never missing and
/// a failed swap leaves the previous tree in place.
fn swap_dir_into(staging: &Path, dest: &Path) -> Result<(), AppError> {
    let old = dest.with_file_name(format!(
        ".{}.old-{}",
        dest.file_name().and_then(|n| n.to_str()).unwrap_or("dir"),
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&old);
    if dest.exists() {
        std::fs::rename(dest, &old)?;
    }
    if let Err(e) = std::fs::rename(staging, dest) {
        if old.exists() {
            let _ = std::fs::rename(&old, dest);
        }
        return Err(e.into());
    }
    let _ = std::fs::remove_dir_all(&old);
    Ok(())
}

/// Export a full-state backup folder. Each selected workspace's clean DB copies
/// go under `<dir>/workspaces/<id>/`; the global `assets/` tree and encryption
/// manifest stay at the bundle root. `workspaces` defaults to the active
/// workspace so existing callers keep their single-workspace behavior.
///
/// Every artifact is staged beside its target and renamed into place only once
/// complete, so an existing backup is never deleted before the replacement is
/// ready.
#[tauri::command]
#[specta::specta]
pub(crate) async fn backup_export(
    app: AppHandle,
    dir: String,
    workspaces: Option<Vec<String>>,
) -> Result<(), AppError> {
    // VACUUM INTO + recursive asset copy are I/O heavy.
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let dest = PathBuf::from(&dir);
        assert_path_access(&app, &state, &dest, "backup destination")?;
        std::fs::create_dir_all(&dest)?;
        let pid = std::process::id();

        let selected = match workspaces {
            Some(ids) if !ids.is_empty() => ids,
            _ => vec![current_workspace_id(&app, &state)?],
        };
        let mut sources = Vec::with_capacity(selected.len());
        for id in selected {
            if !is_safe_bundle_workspace_id(&id) {
                return Err(AppError::Other(format!("[backup] invalid workspace id: {id}")));
            }
            let data = workspace_data_path(&app, &state, &id)?;
            let settings = workspace_settings_path(&app, &state, &id)?;
            if !data.is_file() || !settings.is_file() {
                return Err(AppError::Other(format!(
                    "[backup] workspace {id} has no database to export"
                )));
            }
            sources.push(ExportSource { id, data, settings });
        }

        let assets_src = app_storage_dir(&app, &state)?.join("assets");
        let assets_dest = dest.join("assets");
        let assets_tmp = dest.join(format!(".assets.export-{pid}"));
        let _ = std::fs::remove_dir_all(&assets_tmp);
        let has_assets = assets_src.is_dir();
        if has_assets {
            if let Err(e) = copy_dir_raw(&assets_src, &assets_tmp) {
                let _ = std::fs::remove_dir_all(&assets_tmp);
                return Err(e);
            }
        }

        // Carry the manifest so the bundle is self-describing: a restore into a
        // vault with a different key can derive the source key from it.
        let manifest = match stage_bundle_manifest(
            &app_encryption_manifest_path(&app, &state)?,
            &dest,
        ) {
            Ok(pair) => pair,
            Err(e) => {
                if has_assets {
                    let _ = std::fs::remove_dir_all(&assets_tmp);
                }
                return Err(e);
            }
        };

        // Stage + commit the workspace DBs (read-only source, atomic renames).
        if let Err(e) = export_workspace_dbs(&sources, &dest) {
            if has_assets {
                let _ = std::fs::remove_dir_all(&assets_tmp);
            }
            if let Some((tmp, _)) = &manifest {
                let _ = std::fs::remove_file(tmp);
            }
            return Err(e);
        }

        if let Some((tmp, target)) = manifest {
            std::fs::rename(tmp, target)?;
        }
        // Swap the assets directory last, with rollback on failure.
        if has_assets {
            swap_dir_into(&assets_tmp, &assets_dest)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

/// Acquire the sync cycle guard for a backup import, failing closed when a
/// cycle is already running. Swapping the live DB rows and assets directory
/// while a tick is mid-write would race and roll the import (or the tick) away
/// (finding F8). Refuse rather than wait so the caller can retry once the cycle
/// finishes.
fn begin_backup_import() -> Result<crate::sync::scheduler::CycleGuard, AppError> {
    crate::sync::scheduler::begin_cycle().ok_or_else(|| {
        AppError::Other("sync: cannot import a backup while a sync cycle is running".into())
    })
}

/// Import a backup folder from `backup_export`: every workspace in the bundle
/// has its live rows replaced (legacy root-level DBs restore into the active
/// workspace) and the assets directory is swapped atomically. The bundled payloads are
/// first probed against the current vault key; when they belong to a different
/// vault, `vault_key` (the source vault key) derives the source items key from
/// the bundle's manifest and the staged copies are re-encrypted to the current
/// key before anything live is touched. Returns `VaultKeyRequired` when a
/// different key is needed but none was supplied. Caller must relaunch
/// afterwards so cached state rehydrates.
#[tauri::command]
#[specta::specta]
pub(crate) async fn backup_import(
    app: AppHandle,
    dir: String,
    vault_key: Option<String>,
) -> Result<(), AppError> {
    let _cycle = begin_backup_import()?;
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let src = PathBuf::from(&dir);
        assert_path_access(&app, &state, &src, "backup source")?;

        let target_key = current_app_key(&state)?;
        let staging_dir = app_storage_dir(&app, &state)?
            .join(format!(".backup-import-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&staging_dir);

        let staged = match stage_import(
            &src,
            &staging_dir,
            target_key.as_ref(),
            vault_key.as_deref(),
        ) {
            Ok(staged) => staged,
            Err(e) => {
                let _ = std::fs::remove_dir_all(&staging_dir);
                return Err(e);
            }
        };

        let result = (|| {
            // Everything is validated and re-encrypted in staging first: only now
            // do we touch live state, so a failed import leaves it untouched.
            for workspace in &staged.workspaces {
                import_staged_workspace(&app, &state, workspace)?;
            }
            if let Some(assets) = staged.assets {
                let assets_dest = app_storage_dir(&app, &state)?.join("assets");
                swap_dir_into(&assets, &assets_dest)?;
            }
            Ok(())
        })();
        let _ = std::fs::remove_dir_all(&staging_dir);
        result
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

/// Replace one staged workspace's live rows. The legacy layout (`id == None`)
/// and a bundle entry for the active workspace both restore into the active
/// workspace's cached pools; any other id restores into that workspace,
/// creating + registering it when this device has never seen it (restore onto a
/// fresh device).
fn import_staged_workspace(
    app: &AppHandle,
    state: &AppState,
    workspace: &StagedWorkspace,
) -> Result<(), AppError> {
    let active = current_workspace_id(app, state)?;
    let target_id = workspace.id.as_deref().unwrap_or(active.as_str());
    if target_id == active.as_str() {
        import_db(&settings_pool(app, state)?, &workspace.settings_db)?;
        import_db(&data_pool(app, state)?, &workspace.data_db)?;
        return Ok(());
    }

    // ponytail: register created workspaces; if the row swap below fails they
    // stay as empty local workspaces instead of rolling the registry back.
    ensure_workspace_ready(app, state, target_id)?;
    let settings = crate::db::open_pool(&workspace_settings_path(app, state, target_id)?)?;
    let data = crate::db::open_pool(&workspace_data_path(app, state, target_id)?)?;
    import_db(&settings, &workspace.settings_db)?;
    import_db(&data, &workspace.data_db)?;
    Ok(())
}

/// Make sure a workspace directory + DBs exist and the registry lists it.
fn ensure_workspace_ready(
    app: &AppHandle,
    state: &AppState,
    id: &str,
) -> Result<(), AppError> {
    if !is_safe_bundle_workspace_id(id) {
        return Err(AppError::Other(format!("[backup] invalid workspace id: {id}")));
    }
    let root = workspace_root(app, state)?;
    let dir = root.join(id);
    if !is_path_inside(&root, &dir) {
        return Err(AppError::Other(format!("[backup] invalid workspace id: {id}")));
    }
    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
        let _ = crate::db::open_pool(&dir.join("data.db"))?;
        let _ = crate::db::open_pool(&dir.join("settings.db"))?;
    }

    let mut registry = load_workspace_registry(app, state)?;
    if !registry.iter().any(|w| w.id == id) {
        registry.push(WorkspaceInfo {
            id: id.to_string(),
            name: id.to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            workspace_type: "personal".into(),
            org_id: None,
            owner_id: None,
            cloud_sync: false,
        });
        save_workspace_registry(app, state, &registry)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression: importing/exporting used to `remove_dir_all` the live assets
    /// tree before copying. The staged swap must always leave a complete tree
    /// at `dest`, replacing the old one only after the new one is ready.
    #[test]
    fn swap_dir_into_replaces_dest_without_gap() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock ok")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "beaver-notes-backup-swap-{stamp}-{}",
            std::process::id()
        ));
        let dest = root.join("assets");
        let staging = root.join(".assets.import-test");
        std::fs::create_dir_all(&dest).expect("dest");
        std::fs::write(dest.join("old.bin"), b"old").expect("old file");
        std::fs::create_dir_all(&staging).expect("staging");
        std::fs::write(staging.join("new.bin"), b"new").expect("new file");

        swap_dir_into(&staging, &dest).expect("swap");
        assert!(dest.join("new.bin").is_file(), "new tree is live");
        assert!(!dest.join("old.bin").exists(), "old tree is gone");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// F8: swapping the live DB rows and assets under a live sync cycle races
    /// the tick's writes. The import must take the same cycle guard and fail
    /// closed while a cycle is running.
    #[test]
    fn backup_import_refuses_while_a_sync_cycle_runs() {
        // Serialize with the other process-global guard test (flaky under
        // parallel `cargo test` otherwise).
        let _serial = crate::sync::scheduler::CYCLE_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let held = crate::sync::scheduler::begin_cycle().expect("cycle free");
        let err = match begin_backup_import() {
            Ok(_) => panic!("import must refuse while a cycle runs"),
            Err(e) => e,
        };
        assert!(
            err.to_string().contains("sync cycle"),
            "unexpected error: {err}"
        );
        drop(held);
        begin_backup_import().expect("import allowed once the cycle finishes");
    }

    fn unique_dir(prefix: &str) -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock ok")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("{prefix}-{stamp}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        dir
    }

    fn seed_note(db: &Path, note: &str, key: &[u8; 32]) {
        let pool = crate::db::open_pool(db).expect("pool");
        crate::db::yjs_append(&pool, note, b"secret payload", "dev", Some(*key)).expect("append");
    }

    /// Build a bundle whose data/settings DBs and assets are sealed under
    /// `source_key`, with a manifest wrapping that same key under `passphrase`.
    fn build_encrypted_bundle(root: &Path, passphrase: &str) -> (PathBuf, [u8; 32]) {
        let bundle = root.join("bundle");
        std::fs::create_dir_all(&bundle).expect("bundle");
        let (manifest, source_key, _) =
            create_encryption_manifest(APP_ENCRYPTION_SCOPE, APP_PASSWORD_CHECK, passphrase)
                .expect("manifest");
        write_encryption_manifest(&bundle.join(BACKUP_MANIFEST), &manifest).expect("write manifest");
        seed_note(&bundle.join("data.db"), "n1", &source_key);
        seed_note(&bundle.join("settings.db"), "unused", &source_key);

        let plain = root.join("plain.bin");
        std::fs::write(&plain, b"asset-bytes").expect("plain asset");
        let assets = bundle.join("assets");
        std::fs::create_dir_all(&assets).expect("assets");
        encrypt_asset_streaming(&plain, &assets.join("pic.bin"), &source_key).expect("encrypt asset");
        (bundle, source_key)
    }

    /// Requirement 1: the export bundle is self-describing — it carries a copy
    /// of the encryption manifest (a wrapped key, never plaintext).
    #[test]
    fn export_bundle_carries_the_encryption_manifest() {
        let root = unique_dir("beaver-notes-backup-manifest");
        let bundle = root.join("bundle");
        std::fs::create_dir_all(&bundle).expect("bundle");
        let manifest_src = root.join("manifest.v2.json");
        let (manifest, _, _) =
            create_encryption_manifest(APP_ENCRYPTION_SCOPE, APP_PASSWORD_CHECK, "pw")
                .expect("manifest");
        write_encryption_manifest(&manifest_src, &manifest).expect("write src");

        let (tmp, target) = stage_bundle_manifest(&manifest_src, &bundle)
            .expect("stage")
            .expect("manifest present");
        std::fs::rename(&tmp, &target).expect("commit");
        assert_eq!(target.file_name().unwrap(), BACKUP_MANIFEST);
        assert!(bundle.join(BACKUP_MANIFEST).is_file(), "manifest is in the bundle");

        let loaded = load_encryption_manifest(&bundle.join(BACKUP_MANIFEST))
            .expect("load")
            .expect("present");
        assert_eq!(loaded.wrapped_key.cipher, manifest.wrapped_key.cipher);
        assert_eq!(loaded.argon2_salt_hex, manifest.argon2_salt_hex);

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Same vault: the payloads decrypt with the app's current key, so import
    /// must proceed silently (no source vault key) and the note stays readable.
    #[test]
    fn same_key_bundle_imports_silently_and_stays_readable() {
        let root = unique_dir("beaver-notes-backup-same-key");
        let (bundle, key) = build_encrypted_bundle(&root, "source-pass");
        let staging = root.join("staging");

        assert_eq!(
            bundle_key_match(&bundle, Some(&key)).expect("match"),
            BundleKeyMatch::SameKey
        );

        let staged = stage_import(&bundle, &staging, Some(&key), None)
            .expect("same-key bundle needs no vault key");

        let live = root.join("live.db");
        let pool = crate::db::open_pool(&live).expect("pool");
        import_db(&pool, &staged.workspaces[0].data_db).expect("import");
        assert_eq!(
            crate::db::yjs_get_updates(&pool, "n1", Some(key))
                .expect("read")
                .len(),
            1,
            "imported note must decrypt with the app's current key"
        );

        drop(pool);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Different vault: the source vault key derives the source items key from
    /// the bundle manifest, and the DBs and assets are re-encrypted to the
    /// target key before import.
    #[test]
    fn cross_key_bundle_re_encrypts_dbs_and_assets_with_the_source_vault_key() {
        let root = unique_dir("beaver-notes-backup-cross-key");
        let (bundle, source_key) = build_encrypted_bundle(&root, "source-pass");
        let target_key = [0x42u8; 32];
        let staging = root.join("staging");

        assert_eq!(
            bundle_key_match(&bundle, Some(&target_key)).expect("match"),
            BundleKeyMatch::DifferentKey
        );

        let staged = stage_import(&bundle, &staging, Some(&target_key), Some("source-pass"))
            .expect("correct source vault key re-encrypts the bundle");

        let live = root.join("live.db");
        let pool = crate::db::open_pool(&live).expect("pool");
        import_db(&pool, &staged.workspaces[0].data_db).expect("import");
        assert_eq!(
            crate::db::yjs_get_updates(&pool, "n1", Some(target_key))
                .expect("read target")
                .len(),
            1,
            "imported note must decrypt with the target vault key"
        );
        assert!(
            crate::db::yjs_get_updates(&pool, "n1", Some(source_key))
                .expect("read source")
                .is_empty(),
            "imported note must no longer decrypt with the source key"
        );

        let out = root.join("pic.out");
        decrypt_asset_streaming(
            &staged.assets.expect("staged assets").join("pic.bin"),
            &out,
            &target_key,
        )
        .expect("imported asset must decrypt with the target key");
        assert_eq!(std::fs::read(&out).expect("read out"), b"asset-bytes");

        drop(pool);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A cross-key bundle with no key offered must ask for one, never guess.
    #[test]
    fn cross_key_bundle_without_a_key_reports_vault_key_required() {
        let root = unique_dir("beaver-notes-backup-needs-key");
        let (bundle, _) = build_encrypted_bundle(&root, "source-pass");
        let staging = root.join("staging");

        let err = stage_import(&bundle, &staging, Some(&[7u8; 32]), None)
            .expect_err("no key must fail");
        assert!(matches!(err, AppError::VaultKeyRequired), "got {err:?}");
        assert!(!staging.exists(), "no staging is created before a key is known");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// A wrong source vault key must fail before any live state is touched.
    #[test]
    fn wrong_source_vault_key_fails_and_leaves_live_data_intact() {
        let root = unique_dir("beaver-notes-backup-wrong-key");
        let (bundle, _) = build_encrypted_bundle(&root, "right-pass");
        let target_key = [0x24u8; 32];
        let staged_dir = root.join("staging");

        let live = root.join("live.db");
        let pool = crate::db::open_pool(&live).expect("pool");
        seed_note(&live, "existing", &target_key);
        let before = std::fs::read(&live).expect("read live before");

        let err = stage_import(&bundle, &staged_dir, Some(&target_key), Some("wrong-pass"))
            .expect_err("wrong key must fail");
        assert!(matches!(err, AppError::WrongPassword), "got {err:?}");

        assert_eq!(
            std::fs::read(&live).expect("read live after"),
            before,
            "live DB must not be modified by a failed import"
        );
        assert_eq!(
            crate::db::yjs_get_updates(&pool, "existing", Some(target_key))
                .expect("read")
                .len(),
            1,
            "pre-existing note must survive a failed import"
        );

        drop(pool);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// An encrypted bundle that lost its manifest cannot be re-encrypted; fail
    /// clearly instead of importing undecryptable rows.
    #[test]
    fn encrypted_bundle_without_a_manifest_is_rejected() {
        let root = unique_dir("beaver-notes-backup-no-manifest");
        let (bundle, _) = build_encrypted_bundle(&root, "source-pass");
        std::fs::remove_file(bundle.join(BACKUP_MANIFEST)).expect("drop manifest");
        let staging = root.join("staging");

        let err = stage_import(&bundle, &staging, Some(&[7u8; 32]), Some("source-pass"))
            .expect_err("missing manifest must fail");
        assert!(
            err.to_string().contains("manifest"),
            "error must name the missing manifest: {err}"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// An unencrypted backup still imports with no key and no manifest.
    #[test]
    fn plaintext_bundle_imports_without_a_key() {
        let root = unique_dir("beaver-notes-backup-plaintext");
        let bundle = root.join("bundle");
        std::fs::create_dir_all(&bundle).expect("bundle");
        for name in ["data.db", "settings.db"] {
            let pool = crate::db::open_pool(&bundle.join(name)).expect("pool");
            crate::db::db_set(&pool, "hello", "\"world\"", None).expect("set");
        }
        let staging = root.join("staging");

        assert_eq!(
            bundle_key_match(&bundle, None).expect("match"),
            BundleKeyMatch::Plaintext
        );
        let staged = stage_import(&bundle, &staging, None, None).expect("plaintext import");

        let live = root.join("live.db");
        let pool = crate::db::open_pool(&live).expect("pool");
        import_db(&pool, &staged.workspaces[0].data_db).expect("import");
        assert_eq!(
            crate::db::db_get(&pool, "hello", None).expect("get").as_deref(),
            Some("\"world\"")
        );

        drop(pool);
        let _ = std::fs::remove_dir_all(&root);
    }

    fn seed_kv(db: &Path, key: &str, value: &str) {
        let pool = crate::db::open_pool(db).expect("pool");
        crate::db::db_set(&pool, key, value, None).expect("set");
    }

    /// Requirement 1a: exporting several workspaces writes each selected
    /// workspace's DBs under its own folder in the bundle.
    #[test]
    fn multi_workspace_export_contains_each_selected_workspace() {
        let root = unique_dir("beaver-notes-backup-multi-export");
        let mut sources = Vec::new();
        for id in ["alpha", "beta"] {
            let dir = root.join("live").join(id);
            std::fs::create_dir_all(&dir).expect("dir");
            let data = dir.join("data.db");
            let settings = dir.join("settings.db");
            seed_kv(&data, "note", &format!("\"{id}\""));
            seed_kv(&settings, "theme", "\"dark\"");
            sources.push(ExportSource {
                id: id.to_string(),
                data,
                settings,
            });
        }

        let dest = root.join("bundle");
        export_workspace_dbs(&sources, &dest).expect("export");

        for id in ["alpha", "beta"] {
            let ws_dir = dest.join(BACKUP_WORKSPACES_DIR).join(id);
            let exported = ws_dir.join("data.db");
            assert!(exported.is_file(), "{id} data.db must be in the bundle");
            assert!(
                ws_dir.join("settings.db").is_file(),
                "{id} settings.db must be in the bundle"
            );
            let pool = crate::db::open_pool(&exported).expect("pool");
            let expected = format!("\"{id}\"");
            assert_eq!(
                crate::db::db_get(&pool, "note", None).expect("get").as_deref(),
                Some(expected.as_str()),
                "exported {id} data.db must carry its own rows"
            );
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Requirement 1a: a narrower export drops workspace folders that are no
    /// longer selected, so a later import cannot resurrect them.
    #[test]
    fn workspace_export_prunes_workspaces_not_selected() {
        let root = unique_dir("beaver-notes-backup-export-prune");
        let mut all = Vec::new();
        for id in ["alpha", "beta"] {
            let dir = root.join("live").join(id);
            std::fs::create_dir_all(&dir).expect("dir");
            let data = dir.join("data.db");
            let settings = dir.join("settings.db");
            seed_kv(&data, "note", &format!("\"{id}\""));
            seed_kv(&settings, "theme", "\"dark\"");
            all.push(ExportSource {
                id: id.to_string(),
                data,
                settings,
            });
        }
        let dest = root.join("bundle");
        export_workspace_dbs(&all, &dest).expect("first export");

        export_workspace_dbs(&all[..1], &dest).expect("narrower export");

        assert!(
            dest.join(BACKUP_WORKSPACES_DIR).join("alpha").is_dir(),
            "selected workspace stays"
        );
        assert!(
            !dest.join(BACKUP_WORKSPACES_DIR).join("beta").exists(),
            "unselected workspace folder is pruned"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Requirement 1b/2: staging discovers every workspace in the bundle and
    /// the staged DBs restore their own rows into separate live databases.
    #[test]
    fn multi_workspace_import_restores_each_workspace() {
        let root = unique_dir("beaver-notes-backup-multi-import");
        let bundle = root.join("bundle");
        std::fs::create_dir_all(&bundle).expect("bundle");
        for (id, value) in [("alpha", "\"a\""), ("beta", "\"b\"")] {
            let dir = bundle.join(BACKUP_WORKSPACES_DIR).join(id);
            std::fs::create_dir_all(&dir).expect("dir");
            seed_kv(&dir.join("data.db"), "note", value);
            seed_kv(&dir.join("settings.db"), "note", value);
        }

        let staging = root.join("staging");
        let staged = stage_import(&bundle, &staging, None, None).expect("stage");
        assert_eq!(staged.workspaces.len(), 2, "both workspaces are staged");
        let mut ids: Vec<&str> = staged
            .workspaces
            .iter()
            .filter_map(|ws| ws.id.as_deref())
            .collect();
        ids.sort_unstable();
        assert_eq!(ids, ["alpha", "beta"]);

        for ws in &staged.workspaces {
            let id = ws.id.clone().expect("workspace id");
            let live = root.join("live").join(&id).join("data.db");
            std::fs::create_dir_all(live.parent().expect("parent")).expect("dir");
            let pool = crate::db::open_pool(&live).expect("pool");
            import_db(&pool, &ws.data_db).expect("import");
            let expected = if id == "alpha" { "\"a\"" } else { "\"b\"" };
            assert_eq!(
                crate::db::db_get(&pool, "note", None).expect("get").as_deref(),
                Some(expected),
                "workspace {id} must restore its own rows"
            );
        }

        let _ = std::fs::remove_dir_all(&root);
    }
}
