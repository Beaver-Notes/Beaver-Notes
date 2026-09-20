//! Re-encrypt pre-existing local data when the app items key changes (vault
//! join or rotation).
//!
//! Joining another device's vault replaces the local items key. Without this
//! migration, everything the device encrypted under its old key becomes
//! undecryptable — the note payloads, snapshots, KV stores and asset files all
//! use a single current key with no key-id fallback. We therefore back up the
//! affected files and re-encrypt them under the adopted key *before* the swap.
//!
//! Every workspace database is migrated, not just the active one, and the whole
//! operation runs under a process-wide write barrier so no sealing writer can
//! read the old key and then commit ciphertext after the swap.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

use tauri::AppHandle;

use super::assets::{decrypt_asset_streaming, encrypt_asset_streaming, is_encrypted_asset_header};
use crate::shared::{
    app_encryption_manifest_path, app_storage_dir, restrict_private, workspace_root, AppError,
    AppState, CryptoSession,
};

const BACKUP_SUFFIX: &str = ".pre-join-backup";

/// Process-wide barrier separating key migration from sealing writes.
///
/// Lock order is always barrier first, then `AppState::crypto.session`:
/// - sealing write paths take a barrier read guard, then the session read lock
///   (via `current_app_key`) while they obtain the key and write ciphertext;
/// - migration takes the barrier write guard, then the session write lock, and
///   holds both until the new manifest is persisted and the sweep is done.
///
/// No path may take the session lock first and the barrier second; doing so
/// would let a migration (barrier write → session write) deadlock against a
/// writer (barrier read → session read).
static KEY_MIGRATION: RwLock<()> = RwLock::new(());

/// Acquire the read side of the migration barrier. Hold it across the whole
/// "obtain key → write ciphertext" span so migration cannot swap the key in
/// between. Poisoning is ignored: this lock guards mutual exclusion, not state.
pub(crate) fn write_barrier() -> RwLockReadGuard<'static, ()> {
    KEY_MIGRATION.read().unwrap_or_else(|e| e.into_inner())
}

/// Acquire the write side of the migration barrier. Held for the whole
/// re-encrypt → manifest → sweep sequence.
pub(crate) fn begin_migration() -> RwLockWriteGuard<'static, ()> {
    KEY_MIGRATION.write().unwrap_or_else(|e| e.into_inner())
}

fn backup_file(path: &Path) -> Result<Vec<PathBuf>, AppError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let backup = PathBuf::from(format!("{}{BACKUP_SUFFIX}", path.display()));
    // Keep the first backup: it is the cleanest pre-migration snapshot. A
    // retry after a partial failure must not overwrite it with already-mutated
    // data, which would destroy the only readable copy.
    if !backup.exists() {
        fs::copy(path, &backup)?;
    }
    Ok(vec![backup])
}

/// Back up a SQLite database together with its WAL sidecars.
fn backup_db(path: &Path) -> Result<Vec<PathBuf>, AppError> {
    let mut created = backup_file(path)?;
    for sidecar in ["-wal", "-shm"] {
        created.extend(backup_file(&PathBuf::from(format!(
            "{}{sidecar}",
            path.display()
        )))?);
    }
    Ok(created)
}

/// True when the file starts with an encrypted-asset header. Reads only the
/// 4-byte magic instead of the whole file.
fn is_encrypted_asset(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut magic = [0u8; 4];
    if file.read_exact(&mut magic).is_err() {
        return false;
    }
    match file.metadata() {
        Ok(meta) => is_encrypted_asset_header(&magic, meta.len()),
        Err(_) => false,
    }
}

/// Re-encrypt `data.db`/`settings.db` in every workspace directory under
/// `workspaces_root`, backing them up first when `backup` is set. Enumerating
/// the directory (not just the active workspace from `workspaces.json`) also
/// covers workspaces the registry forgot about.
fn migrate_workspace_dbs(
    workspaces_root: &Path,
    old_key: &[u8; 32],
    new_key: &[u8; 32],
    backup: bool,
    backups: &mut Vec<PathBuf>,
) -> Result<u64, AppError> {
    if !workspaces_root.exists() {
        return Ok(0);
    }
    let mut migrated = 0u64;
    for entry in fs::read_dir(workspaces_root)? {
        let dir = entry?.path();
        if !dir.is_dir() {
            continue;
        }
        for name in ["data.db", "settings.db"] {
            let db = dir.join(name);
            if !db.exists() {
                continue;
            }
            if backup {
                backups.extend(backup_db(&db)?);
            }
            let pool = crate::db::open_pool(&db)?;
            migrated += crate::db::reencrypt_payloads_for_key(&pool, old_key, new_key)?;
            // The transport cursors still say these rows were published (under
            // the old key), so peers would never get the re-encrypted content.
            // Reset them; the next cycle re-publishes under the adopted key.
            crate::db::reset_transport_push_cursors(&pool)?;
        }
    }
    Ok(migrated)
}

/// Re-encrypt every encrypted file in the shared asset tree. Assets use temp
/// files and a rename, so a crash can never leave a truncated asset in place.
/// Shared with backup import, which re-encrypts a staged copy of a foreign
/// vault's asset tree before swapping it in.
pub(crate) fn migrate_assets(
    assets_root: &Path,
    old_key: &[u8; 32],
    new_key: &[u8; 32],
) -> Result<u64, AppError> {
    if !assets_root.exists() {
        return Ok(0);
    }
    let mut migrated = 0u64;
    let mut pending = vec![assets_root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in fs::read_dir(&dir)? {
            let path = entry?.path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }
            if !path.is_file() || !is_encrypted_asset(&path) {
                continue;
            }
            let decrypted = with_suffix(&path, ".prejoin-dec");
            let encrypted = with_suffix(&path, ".prejoin-enc");
            // Undecryptable with the old key => already migrated (or foreign):
            // skip so a retried migration converges instead of failing.
            if decrypt_asset_streaming(&path, &decrypted, old_key).is_err() {
                let _ = fs::remove_file(&decrypted);
                continue;
            }
            let result = encrypt_asset_streaming(&decrypted, &encrypted, new_key);
            let _ = fs::remove_file(&decrypted);
            if result.is_err() {
                let _ = fs::remove_file(&encrypted);
                continue;
            }
            fs::rename(&encrypted, &path)?;
            let _ = restrict_private(&path);
            migrated += 1;
        }
    }
    Ok(migrated)
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

/// Backup and re-encrypt every local payload owned by every workspace plus the
/// shared asset tree. Returns the number of items rewritten and the backup
/// files created, so the caller can delete the backups only after the key swap
/// has been persisted. Any error aborts before the swap, so the old key (and
/// the backups) still describe a consistent, readable state.
fn migrate_roots(
    workspaces_root: &Path,
    assets_root: &Path,
    manifest_path: &Path,
    old_key: &[u8; 32],
    new_key: &[u8; 32],
    backup: bool,
) -> Result<(u64, Vec<PathBuf>), AppError> {
    if old_key == new_key {
        return Ok((0, Vec::new()));
    }

    let mut backups = Vec::new();
    if backup {
        backups.extend(backup_file(manifest_path)?);
    }

    let mut migrated =
        migrate_workspace_dbs(workspaces_root, old_key, new_key, backup, &mut backups)?;
    migrated += migrate_assets(assets_root, old_key, new_key)?;
    Ok((migrated, backups))
}

/// Run the whole key migration: re-encrypt every workspace and the asset tree
/// under the write barrier, apply the in-memory key swap and persist the new
/// manifest (both via `commit`), then sweep once more before releasing the
/// barrier. Returns the migrated count and the backup files to delete once the
/// manifest is durable.
///
/// `commit` runs inside the barrier so a barrier-aware writer can never observe
/// the old key after the swap. Keep it cheap: it executes under the barrier
/// write guard and the session write lock.
pub(crate) fn migrate_app_data_key(
    app: &AppHandle,
    state: &AppState,
    old_key: &[u8; 32],
    new_key: &[u8; 32],
    manifest: &super::EncryptionManifest,
    commit: impl FnOnce(&mut CryptoSession),
) -> Result<(u64, Vec<PathBuf>), AppError> {
    if old_key == new_key {
        return Ok((0, Vec::new()));
    }

    let workspaces_root = workspace_root(app, state)?;
    let assets_root = app_storage_dir(app, state)?.join("assets");
    let manifest_path = app_encryption_manifest_path(app, state)?;

    // Barrier write guard first, then the session write lock: the global lock
    // order documented on `KEY_MIGRATION`.
    let _barrier = begin_migration();

    let (migrated, backups) = migrate_roots(
        &workspaces_root,
        &assets_root,
        &manifest_path,
        old_key,
        new_key,
        true,
    )?;

    {
        let mut session = state.crypto.session.write().map_err(AppError::from)?;
        commit(&mut session);
    }
    super::write_encryption_manifest(&manifest_path, manifest)?;

    // Final sweep, still under the barrier, catches any payload that a writer
    // bypassing the barrier sealed with the old key before the swap.
    migrate_roots(
        &workspaces_root,
        &assets_root,
        &manifest_path,
        old_key,
        new_key,
        false,
    )?;

    Ok((migrated, backups))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, SystemTime};

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let ts = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock ok")
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{ts}-{}", std::process::id()))
    }

    fn seed_note(db: &Path, note: &str, key: &[u8; 32]) {
        let pool = crate::db::open_pool(db).expect("pool");
        crate::db::yjs_append(&pool, note, b"secret payload", "dev", Some(*key))
            .expect("append");
    }

    /// Regression: a failed migration retry must never clobber the first clean
    /// backup — after a partial re-encryption the live file is already mutated,
    /// so overwriting would destroy the only readable copy.
    #[test]
    fn backup_file_keeps_the_first_clean_copy() {
        let root = unique_temp_dir("beaver-notes-key-migration");
        std::fs::create_dir_all(&root).expect("tmpdir");
        let live = root.join("data.db");
        std::fs::write(&live, b"original").expect("write live");

        let first = backup_file(&live).expect("first backup");
        assert_eq!(std::fs::read(&first[0]).expect("read first"), b"original");

        std::fs::write(&live, b"mutated").expect("mutate live");
        let second = backup_file(&live).expect("second backup");
        assert_eq!(
            std::fs::read(&second[0]).expect("read second"),
            b"original",
            "a retry must keep the clean pre-migration backup"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migrates_every_workspace_database_and_shared_assets() {
        let root = unique_temp_dir("beaver-notes-workspace-migration");
        let workspaces_root = root.join("workspaces");
        let assets_root = root.join("assets");
        let manifest_path = root.join("app-crypto/manifest.v2.json");
        fs::create_dir_all(&assets_root).expect("assets dir");
        fs::create_dir_all(manifest_path.parent().unwrap()).expect("manifest dir");
        fs::write(&manifest_path, b"manifest").expect("manifest");

        let old = [7u8; 32];
        let new = [8u8; 32];

        for ws in ["default", "second"] {
            let dir = workspaces_root.join(ws);
            fs::create_dir_all(&dir).expect("workspace dir");
            seed_note(&dir.join("data.db"), "n1", &old);
        }
        let third = workspaces_root.join("third");
        fs::create_dir_all(&third).expect("third dir");
        {
            let pool = crate::db::open_pool(&third.join("settings.db")).expect("pool");
            crate::db::db_set(&pool, "flag", "true", Some(old)).expect("set");
        }

        let src = root.join("plain.bin");
        fs::write(&src, b"asset-bytes").expect("plain asset");
        let asset = assets_root.join("pic.bin");
        encrypt_asset_streaming(&src, &asset, &old).expect("encrypt asset");

        let (migrated, backups) =
            migrate_roots(&workspaces_root, &assets_root, &manifest_path, &old, &new, true)
                .expect("migrate");
        assert_eq!(
            migrated, 4,
            "two note rows + one kv row + one asset must be re-encrypted"
        );

        for ws in ["default", "second"] {
            let pool =
                crate::db::open_pool(&workspaces_root.join(ws).join("data.db")).expect("pool");
            assert_eq!(
                crate::db::yjs_get_updates(&pool, "n1", Some(new))
                    .expect("read new")
                    .len(),
                1,
                "{ws} note must decrypt with the new key"
            );
            assert!(
                crate::db::yjs_get_updates(&pool, "n1", Some(old))
                    .expect("read old")
                    .is_empty(),
                "{ws} note must no longer decrypt with the old key"
            );
        }

        {
            let pool = crate::db::open_pool(&third.join("settings.db")).expect("pool");
            assert_eq!(
                crate::db::db_get(&pool, "flag", Some(new)).expect("get").as_deref(),
                Some("true"),
                "workspace with only a settings DB must migrate too"
            );
        }

        let out = root.join("pic.out");
        decrypt_asset_streaming(&asset, &out, &new).expect("asset decrypts with new key");
        assert_eq!(fs::read(&out).expect("read out"), b"asset-bytes");

        assert!(
            backups
                .iter()
                .any(|p| p.to_string_lossy().ends_with("data.db.pre-join-backup")),
            "each workspace db must be backed up: {backups:?}"
        );
        assert!(
            backups
                .iter()
                .any(|p| p.to_string_lossy().ends_with("settings.db.pre-join-backup")),
            "settings db must be backed up: {backups:?}"
        );
        assert!(
            backups
                .iter()
                .any(|p| p.to_string_lossy().ends_with("manifest.v2.json.pre-join-backup")),
            "manifest must be backed up: {backups:?}"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn sweep_reencrypts_a_payload_written_with_the_old_key() {
        let root = unique_temp_dir("beaver-notes-key-sweep");
        let workspaces_root = root.join("workspaces");
        let assets_root = root.join("assets");
        let manifest_path = root.join("manifest.v2.json");
        let dir = workspaces_root.join("default");
        fs::create_dir_all(&dir).expect("workspace dir");
        fs::create_dir_all(&assets_root).expect("assets dir");
        let db = dir.join("data.db");

        let old = [1u8; 32];
        let new = [2u8; 32];
        seed_note(&db, "n1", &old);

        let (migrated, _) =
            migrate_roots(&workspaces_root, &assets_root, &manifest_path, &old, &new, true)
                .expect("first pass");
        assert_eq!(migrated, 1);

        // Simulate a writer that sealed with the old key while migration ran.
        seed_note(&db, "late", &old);

        let (swept, _) =
            migrate_roots(&workspaces_root, &assets_root, &manifest_path, &old, &new, false)
                .expect("sweep");
        assert_eq!(swept, 1, "sweep must re-encrypt the late old-key row");

        let pool = crate::db::open_pool(&db).expect("pool");
        assert_eq!(
            crate::db::yjs_get_updates(&pool, "late", Some(new))
                .expect("read new")
                .len(),
            1
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn no_op_when_the_keys_match() {
        let root = unique_temp_dir("beaver-notes-key-noop");
        let manifest_path = root.join("manifest.v2.json");
        fs::create_dir_all(&root).expect("tmpdir");
        let key = [3u8; 32];
        let (migrated, backups) = migrate_roots(
            &root.join("workspaces"),
            &root.join("assets"),
            &manifest_path,
            &key,
            &key,
            true,
        )
        .expect("no-op");
        assert_eq!(migrated, 0);
        assert!(backups.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// F4: a vault join/rotation re-encrypts local rows, but the transport
    /// cursors still claim those rows were already published under the old key.
    /// The migration must clear the push cursors so the next cycle re-publishes
    /// under the adopted key, while leaving pull state (checkpoints, consume
    /// markers) intact.
    #[test]
    fn migration_resets_transport_push_cursors_but_keeps_pull_state() {
        let root = unique_temp_dir("beaver-notes-key-cursors");
        let workspaces_root = root.join("workspaces");
        let assets_root = root.join("assets");
        let manifest_path = root.join("manifest.v2.json");
        let dir = workspaces_root.join("default");
        fs::create_dir_all(&dir).expect("workspace dir");
        fs::create_dir_all(&assets_root).expect("assets dir");

        let old = [1u8; 32];
        let new = [2u8; 32];
        let db = dir.join("data.db");
        seed_note(&db, "n1", &old);
        const RESET: [&str; 4] = [
            "sync:local:pushed:n1",
            "sync:local:wseq:n1",
            "sync:cloud:pushed:n1",
            "sync:cloud:wseq:n1",
        ];
        const KEEP: [&str; 3] = [
            "sync:local:ckpt:n1",
            "sync:cloud:ckpt:n1",
            "sync:local:seen:n1~~dev~~1~~2~~u",
        ];
        {
            let pool = crate::db::open_pool(&db).expect("pool");
            for key in RESET {
                crate::db::db_set(&pool, key, "9", None).expect("seed cursor");
            }
            for key in KEEP {
                crate::db::db_set(&pool, key, "keep", None).expect("seed pull state");
            }
        }

        migrate_roots(&workspaces_root, &assets_root, &manifest_path, &old, &new, true)
            .expect("migrate");

        let pool = crate::db::open_pool(&db).expect("pool");
        for key in RESET {
            assert!(
                crate::db::db_get(&pool, key, None).expect("get").is_none(),
                "{key} must be reset so the migrated rows re-publish"
            );
        }
        for key in KEEP {
            assert_eq!(
                crate::db::db_get(&pool, key, None).expect("get").as_deref(),
                Some("keep"),
                "{key} is pull state and must survive the migration"
            );
        }
        drop(pool);
        let _ = fs::remove_dir_all(&root);
    }

    /// F4 (c): with no migration (same key on both sides) the push cursors are
    /// untouched, so a normal startup never triggers a re-publish loop.
    #[test]
    fn matching_keys_leave_transport_push_cursors_untouched() {
        let root = unique_temp_dir("beaver-notes-key-cursors-noop");
        let workspaces_root = root.join("workspaces");
        let assets_root = root.join("assets");
        let manifest_path = root.join("manifest.v2.json");
        let dir = workspaces_root.join("default");
        fs::create_dir_all(&dir).expect("workspace dir");
        fs::create_dir_all(&assets_root).expect("assets dir");

        let key = [3u8; 32];
        let db = dir.join("data.db");
        seed_note(&db, "n1", &key);
        {
            let pool = crate::db::open_pool(&db).expect("pool");
            crate::db::db_set(&pool, "sync:local:pushed:n1", "9", None).expect("seed cursor");
        }

        migrate_roots(&workspaces_root, &assets_root, &manifest_path, &key, &key, true)
            .expect("no-op migrate");

        let pool = crate::db::open_pool(&db).expect("pool");
        assert_eq!(
            crate::db::db_get(&pool, "sync:local:pushed:n1", None)
                .expect("get")
                .as_deref(),
            Some("9"),
            "no key change must not reset the push cursor"
        );
        drop(pool);
        let _ = fs::remove_dir_all(&root);
    }

    /// The barrier must exclude sealing writers while migration holds the write
    /// guard, then let them through once it is released.
    #[test]
    fn write_barrier_blocks_until_migration_guard_is_released() {
        let guard = begin_migration();
        let (tx, rx) = mpsc::channel();
        let handle = std::thread::spawn(move || {
            let _read = write_barrier();
            tx.send(()).expect("send");
        });

        assert!(
            rx.recv_timeout(Duration::from_millis(75)).is_err(),
            "a sealing writer must block while the migration guard is held"
        );

        drop(guard);
        assert!(
            rx.recv_timeout(Duration::from_secs(5)).is_ok(),
            "a sealing writer must proceed once the migration guard is released"
        );
        handle.join().expect("join");
    }
}
