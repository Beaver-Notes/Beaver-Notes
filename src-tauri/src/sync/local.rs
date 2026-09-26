use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use unicode_normalization::UnicodeNormalization;
use tauri_plugin_scoped_storage::{
    MkdirRequest, ReadDirRequest, ReadFileRequest, RemoveFileRequest, RenameRequest,
    ScopedStorageError, ScopedStorageExt, WriteFileRequest,
};

use super::merge::{
    covered_by_vector, describe_coverage, load_vector, merge_updates, refresh_vector,
};
use crate::db::{self, DbPool};
use crate::shared::{
    SyncEnvelope, PROTOCOL_VERSION, SYNC_PAYLOAD_VERSION, aead_decrypt_bytes, aead_decrypt_json,
    aead_encrypt_bytes, assert_path_access, current_app_key, data_pool, decrypt_yjs_blob,
    generate_key_id, AppError, AppState,
};

const UPDATE_EXT: &str = ".yjs.json";
const SEP: &str = "~~";
const SYNC_ROOT: &str = "BeaverNotesSync";
const COMMITS_DIR: &str = "commits";
const SCOPED_PREFIX: &str = "scoped:";
const SCOPED_COMMITS_REL: &str = "BeaverNotesSync/commits";

const DEVICE_ID_KEY: &str = "sync:local:device-id";

/// Compact this device's own commit files for a note into a single snapshot
/// once it has accumulated this many, bounding folder growth (finding F11).
/// Peers consume snapshots (full state), so deleting superseded own files is
/// data-safe; files authored by peers are never deleted.
const COMMIT_COMPACT_THRESHOLD: usize = 32;

#[derive(Clone, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalStats {
    pub(crate) pulled: u64,
    pub(crate) pushed: u64,
    pub(crate) pending_icloud: u64,
    /// Commits that were readable but could not be applied (bad JSON, foreign
    /// vault, unknown envelope version). Counted and logged so a persistently
    /// skipped commit is visible instead of silently retried forever (F5).
    pub(crate) skipped: u64,
    /// Note ids newly applied by this cycle, so the scheduler can emit
    /// `sync:applied` and the renderer hydrates them (folder transport never
    /// runs the cloud pull that would otherwise supply ids).
    pub(crate) pulled_notes: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Default)]
struct ReadCursor {
    ts: u64,
    seq: u64,
}

pub struct ParsedCommit {
    pub note: String,
    pub device: String,
    pub ts: u64,
    pub seq: u64,
    pub is_snapshot: bool,
}

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

fn store_cursor(pool: &DbPool, note_id: &str, ts: u64, seq: u64) -> Result<(), AppError> {
    db::db_set(
        pool,
        &ckpt_key(note_id),
        &serde_json::to_string(&ReadCursor { ts, seq })?,
        None,
    )
}

fn seen_key(file: &ParsedCommit) -> String {
    format!(
        "sync:local:seen:{}~~{}~~{}~~{}~~{}",
        file.note,
        file.device,
        file.ts,
        file.seq,
        if file.is_snapshot { "s" } else { "u" }
    )
}

// ponytail: per-file consume markers. The old single-max-cursor gate
// permanently skipped peer commits that landed mid-cycle with a smaller
// (ts,seq) tuple (proven live: side A's meta cursor sat past side B's newer
// meta commits). A file is skipped only if THIS file was consumed before,
// regardless of tuple order.
fn is_consumed(pool: &DbPool, file: &ParsedCommit) -> bool {
    db::db_get(pool, &seen_key(file), None)
        .ok()
        .flatten()
        .is_some()
}

fn mark_consumed(pool: &DbPool, file: &ParsedCommit, name: &str) -> Result<(), AppError> {
    db::db_set(pool, &seen_key(file), name, None)
}

/// Drop markers whose commit file is gone (wiped folder, manual cleanup), so
/// a restored file is picked up again. Yjs merges are idempotent, so a
/// duplicate append after restore is harmless.
fn prune_consumed(
    pool: &DbPool,
    live: &std::collections::HashSet<String>,
) -> Result<(), AppError> {
    let rows: Vec<(String, String)> = {
        let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
        let mut stmt = conn
            .prepare("SELECT key, value FROM kv WHERE key LIKE 'sync:local:seen:%'")
            .map_err(|e| AppError::Other(e.to_string()))?;
        let mapped = stmt
            .query_map([], |row| {
                let key: String = row.get(0)?;
                let value: Vec<u8> = row.get(1)?;
                Ok((key, String::from_utf8_lossy(&value).into_owned()))
            })
            .map_err(|e| AppError::Other(e.to_string()))?;
        let rows: Result<Vec<(String, String)>, _> = mapped.collect();
        rows.map_err(|e| AppError::Other(e.to_string()))?
    };
    for (key, name) in rows {
        if !live.contains(&name) {
            db::db_delete(pool, &key)?;
        }
    }
    Ok(())
}

/// Pull phase: consume every unconsumed foreign commit exactly once, in
/// (ts,seq) order. Returns the applied note ids. Separated from `run_cycle`
/// so the skip logic is directly unit-testable.
fn pull_commits(
    pool: &DbPool,
    store: &CommitStore,
    device: &str,
    key: &[u8; 32],
    stats: &mut LocalStats,
) -> Result<Vec<String>, AppError> {
    let mut pulled_notes: Vec<String> = Vec::new();

    let mut incoming: Vec<(ParsedCommit, String)> = Vec::new();
    // Snapshot of the directory before this cycle: feeds marker pruning below.
    let listed = store.list()?;
    let before: std::collections::HashSet<String> = listed.iter().cloned().collect();
    for name in listed {
        let Some(p) = parse_sync_filename(&name) else {
            continue;
        };
        if p.device == device {
            continue;
        }
        if is_consumed(pool, &p) {
            continue;
        }
        incoming.push((p, name));
    }
    incoming.sort_by_key(|e| (e.0.ts, e.0.seq));
    for (p, name) in incoming {
        let (note, ts, seq, is_snapshot) = (p.note.clone(), p.ts, p.seq, p.is_snapshot);
        if store.is_evicted(&name) {
            stats.pending_icloud += 1;
            continue;
        }
        let Some(raw) = store.read(&name)? else {
            stats.pending_icloud += 1;
            continue;
        };
        let (note_id, from_device, update) = match decrypt_commit(key, &raw, &note, ts, is_snapshot)
        {
            Ok(v) => v,
            Err(reason) => {
                // Count and log instead of silently retrying every cycle (F5).
                stats.skipped += 1;
                crate::rs_log!("[sync::local] skipping commit {name}: {reason}");
                continue;
            }
        };

        if let Some(stored) = load_vector(pool, &note_id) {
            if covered_by_vector(std::slice::from_ref(&update), &stored) {
                // ponytail: temporary field diagnostic — which path eats peer
                // meta updates (covered-skip vs append). Marked right after,
                // so each file logs once. Remove once the meta stall is found.
                crate::rs_log!(
                    "[sync::local] covered-skip {note_id} ts={ts} seq={seq} len={} {}",
                    update.len(),
                    describe_coverage(std::slice::from_ref(&update), &stored)
                );
                store_cursor(pool, &note_id, ts, seq)?;
                mark_consumed(pool, &p, &name)?;
                continue;
            }
        }
        db::yjs_append(pool, &note_id, &update, &from_device, Some(*key))?;
        store_cursor(pool, &note_id, ts, seq)?;
        mark_consumed(pool, &p, &name)?;
        stats.pulled += 1;
        pulled_notes.push(note_id);
    }

    pulled_notes.sort();
    pulled_notes.dedup();
    for note in &pulled_notes {
        if let Err(e) = refresh_vector(pool, note, Some(*key)) {
            crate::rs_log!("[sync::local] vector refresh skipped: {e}");
        }
    }
    if let Err(e) = prune_consumed(pool, &before) {
        crate::rs_log!("[sync::local] marker prune skipped: {e}");
    }
    Ok(pulled_notes)
}

pub(crate) fn get_or_create_device_id(pool: &DbPool) -> Result<String, AppError> {
    if let Some(id) = db::db_get(pool, DEVICE_ID_KEY, None)? {
        if !id.trim().is_empty() {
            return Ok(id);
        }
    }
    let id = generate_key_id();
    db::db_set(pool, DEVICE_ID_KEY, &id, None)?;
    Ok(id)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn sync_device_id(
    app: AppHandle,
    seed: Option<String>,
) -> Result<String, AppError> {
    let state = app.state::<AppState>();
    let pool = data_pool(&app, state.inner())?;
    // An isolated instance (separate data dir) needs its own device identity. The
    // seed comes from the shared webview localStorage, so adopting it would give
    // two instances the same id and make each skip the other's commits.
    let seed = if std::env::var_os("BEAVER_NOTES_DATA_DIR").filter(|v| !v.is_empty()).is_some() {
        None
    } else {
        seed
    };
    tokio::task::spawn_blocking(move || {
        if let Some(id) = db::db_get(&pool, DEVICE_ID_KEY, None)? {
            if !id.trim().is_empty() {
                return Ok(id);
            }
        }
        if let Some(s) = seed {
            let s = s.trim().to_string();
            if !s.is_empty() {
                db::db_set(&pool, DEVICE_ID_KEY, &s, None)?;
                return Ok(s);
            }
        }
        get_or_create_device_id(&pool)
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

/// Compare note ids modulo Unicode normalization. macOS filesystems store
/// filenames NFD while the payload's `noteId` is NFC, so a raw string compare
/// drops every accented/emoji-note commit forever (finding F6).
fn same_note(a: &str, b: &str) -> bool {
    a == b || a.nfc().eq(b.nfc())
}

fn decrypt_commit(
    key: &[u8; 32],
    raw: &[u8],
    file_note: &str,
    ts: u64,
    is_snapshot: bool,
) -> Result<(String, String, Vec<u8>), &'static str> {
    let env: serde_json::Value =
        serde_json::from_slice(raw).map_err(|_| "invalid JSON envelope")?;
    let v = env
        .get("v")
        .and_then(|v| v.as_u64())
        .ok_or("missing envelope version")? as u8;
    let aad = if is_snapshot {
        format!("{file_note}-snapshot-{ts}")
    } else {
        format!("{file_note}-{ts}")
    };
    if v == SYNC_PAYLOAD_VERSION {
        let iv = env.get("iv").and_then(|v| v.as_str()).ok_or("missing iv")?;
        let enc = env.get("enc").and_then(|v| v.as_str()).ok_or("missing enc")?;
        let update = aead_decrypt_bytes(key, iv, enc, &aad).map_err(|_| "decrypt failed")?;
        let meta = env.get("meta").ok_or("missing meta")?;
        let device = meta
            .get("device")
            .and_then(|v| v.as_str())
            .ok_or("missing device")?;
        // Fail closed when the envelope names a different note than the file:
        // appending under the wrong id would corrupt an unrelated note. Compare
        // normalization-insensitively so NFD filenames still match (F6), and
        // return the payload's canonical id.
        let note = meta
            .get("noteId")
            .and_then(|n| n.as_str())
            .filter(|n| !n.is_empty())
            .unwrap_or(file_note);
        if !same_note(note, file_note) {
            return Err("payload note id does not match filename");
        }
        Ok((note.to_string(), device.to_string(), update))
    } else if v == PROTOCOL_VERSION {
        let iv = env.get("iv").and_then(|v| v.as_str()).ok_or("missing iv")?;
        let enc = env.get("enc").and_then(|v| v.as_str()).ok_or("missing enc")?;
        let legacy = SyncEnvelope {
            v,
            iv: iv.to_string(),
            enc: enc.to_string(),
        };
        let value = aead_decrypt_json(key, &legacy, &aad).map_err(|_| "decrypt failed")?;
        let device = value
            .get("device")
            .and_then(|v| v.as_str())
            .ok_or("missing device")?;
        let note = value
            .get("noteId")
            .and_then(|n| n.as_str())
            .filter(|n| !n.is_empty())
            .unwrap_or(file_note);
        if !same_note(note, file_note) {
            return Err("payload note id does not match filename");
        }
        let bytes: Vec<u8> = value
            .get("update")
            .and_then(|v| v.as_array())
            .ok_or("missing update")?
            .iter()
            .filter_map(|n| n.as_u64().map(|u| u as u8))
            .collect();
        Ok((note.to_string(), device.to_string(), bytes))
    } else {
        Err("unsupported envelope version")
    }
}

fn resolve_commits_dir(folder_id: &str) -> Result<PathBuf, AppError> {
    let base = PathBuf::from(folder_id);

    if base.file_name().is_some_and(|n| n == COMMITS_DIR) {
        Ok(base)
    } else {
        Ok(base.join(SYNC_ROOT).join(COMMITS_DIR))
    }
}

pub fn atomic_write(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static CTR: AtomicU64 = AtomicU64::new(0);
    let n = CTR.fetch_add(1, Ordering::Relaxed);
    // Hidden (dot-prefixed) sibling: same directory for an atomic rename, and
    // invisible to the asset walks that skip dot entries, so a concurrent walk
    // never mistakes a half-written temp for a real file.
    let name = target.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = target.with_file_name(format!(".{name}.tmp-{}-{n}", std::process::id()));
    let res: std::io::Result<()> = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, target)?;
        Ok(())
    })();
    if res.is_err() {
        let _ = fs::remove_file(&tmp);
    } else if let Some(parent) = target.parent() {

        #[cfg(unix)]
        if let Ok(d) = fs::File::open(parent) {
            let _ = d.sync_all();
        }
    }
    res
}

#[cfg(unix)]
fn is_evicted_placeholder(path: &std::path::Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match std::fs::metadata(path) {
        Ok(m) => m.len() > 0 && m.blocks() == 0,
        Err(_) => false,
    }
}

#[cfg(not(unix))]
fn is_evicted_placeholder(_path: &std::path::Path) -> bool {
    false
}

fn scoped_err(e: ScopedStorageError) -> AppError {
    AppError::Other(format!("scoped storage: {e}"))
}

/// Scoped plugin paths are POSIX-relative, never filesystem paths, so the
/// separator is always `/`.
fn scoped_join(rel: &str, name: &str) -> String {
    format!("{rel}/{name}")
}

/// Where a sync folder's commits live: a filesystem directory, or a
/// user-approved scoped-storage folder on mobile (`scoped:<id>`).
enum CommitStore {
    Fs(PathBuf),
    Scoped {
        app: AppHandle,
        folder_id: String,
        rel: String,
    },
}

impl CommitStore {
    fn ensure(&self) -> Result<(), AppError> {
        match self {
            CommitStore::Fs(dir) => {
                fs::create_dir_all(dir)?;
                Ok(())
            }
            CommitStore::Scoped { app, folder_id, rel } => app
                .scoped_storage()
                .mkdir(MkdirRequest {
                    folder_id: folder_id.clone(),
                    path: rel.clone(),
                    recursive: Some(true),
                })
                .map_err(scoped_err),
        }
    }

    /// File names only; directory entries are filtered out.
    fn list(&self) -> Result<Vec<String>, AppError> {
        match self {
            CommitStore::Fs(dir) => {
                let mut names = Vec::new();
                for entry in fs::read_dir(dir)? {
                    names.push(entry?.file_name().to_string_lossy().to_string());
                }
                Ok(names)
            }
            CommitStore::Scoped { app, folder_id, rel } => {
                let entries = app
                    .scoped_storage()
                    .read_dir(ReadDirRequest {
                        folder_id: folder_id.clone(),
                        path: Some(rel.clone()),
                    })
                    .map_err(scoped_err)?;
                Ok(entries
                    .into_iter()
                    .filter(|e| e.is_file)
                    .map(|e| e.name)
                    .collect())
            }
        }
    }

    /// `None` means the commit is not (yet) readable — missing on disk or an
    /// evicted iCloud placeholder — and the caller counts it as pending.
    fn read(&self, name: &str) -> Result<Option<Vec<u8>>, AppError> {
        match self {
            // Preserve the old fs behaviour: any read error is a pending read,
            // not a cycle failure.
            CommitStore::Fs(dir) => Ok(fs::read(dir.join(name)).ok()),
            CommitStore::Scoped { app, folder_id, rel } => {
                match app.scoped_storage().read_file(ReadFileRequest {
                    folder_id: folder_id.clone(),
                    path: scoped_join(rel, name),
                }) {
                    Ok(resp) => Ok(Some(resp.data)),
                    Err(ScopedStorageError::NotFound(_)) => Ok(None),
                    Err(e) => Err(scoped_err(e)),
                }
            }
        }
    }

    fn write(&self, name: &str, bytes: &[u8]) -> Result<(), AppError> {
        match self {
            CommitStore::Fs(dir) => {
                atomic_write(&dir.join(name), bytes)?;
                Ok(())
            }
            CommitStore::Scoped { app, folder_id, rel } => {
                // Write-then-rename for atomicity; fall back to a direct write
                // when the backend does not support rename.
                let target = scoped_join(rel, name);
                let tmp = format!("{target}.tmp");
                let storage = app.scoped_storage();
                if storage
                    .write_file(WriteFileRequest {
                        folder_id: folder_id.clone(),
                        path: tmp.clone(),
                        data: bytes.to_vec(),
                        mime_type: None,
                        recursive: Some(true),
                    })
                    .is_ok()
                {
                    match storage.rename(RenameRequest {
                        folder_id: folder_id.clone(),
                        from_path: tmp.clone(),
                        to_path: target.clone(),
                    }) {
                        Ok(()) => return Ok(()),
                        Err(e) => {
                            crate::rs_log!(
                                "[sync::local] scoped rename failed, writing directly: {e}"
                            );
                            let _ = storage.remove_file(RemoveFileRequest {
                                folder_id: folder_id.clone(),
                                path: tmp,
                            });
                        }
                    }
                }
                storage
                    .write_file(WriteFileRequest {
                        folder_id: folder_id.clone(),
                        path: target,
                        data: bytes.to_vec(),
                        mime_type: None,
                        recursive: Some(true),
                    })
                    .map_err(scoped_err)
            }
        }
    }

    /// Evicted-placeholder detection is a desktop iCloud concept; scoped
    /// storage handles downloads natively, so nothing is ever evicted here.
    fn is_evicted(&self, name: &str) -> bool {
        match self {
            CommitStore::Fs(dir) => is_evicted_placeholder(&dir.join(name)),
            CommitStore::Scoped { .. } => false,
        }
    }

    fn remove(&self, name: &str) -> Result<(), AppError> {
        match self {
            CommitStore::Fs(dir) => {
                fs::remove_file(dir.join(name))?;
                Ok(())
            }
            CommitStore::Scoped { app, folder_id, rel } => app
                .scoped_storage()
                .remove_file(RemoveFileRequest {
                    folder_id: folder_id.clone(),
                    path: scoped_join(rel, name),
                })
                .map_err(scoped_err),
        }
    }
}

/// Folder asset mirroring walks raw filesystem paths; `scoped:` folders are
/// mobile sandbox handles with no such path. Returns true when asset mirroring
/// must be skipped (finding F9).
fn scoped_folder_skips_assets(folder_id: &str) -> bool {
    folder_id.starts_with(SCOPED_PREFIX)
}

fn run_cycle(app: &AppHandle, folder_id: &str) -> Result<LocalStats, AppError> {

    let state = app.state::<AppState>();
    let pool = data_pool(app, state.inner())?;

    let key = current_app_key(state.inner())?.ok_or(AppError::EncryptionLocked)?;

    let store = if let Some(id) = folder_id.strip_prefix(SCOPED_PREFIX) {
        CommitStore::Scoped {
            app: app.clone(),
            folder_id: id.to_string(),
            rel: SCOPED_COMMITS_REL.to_string(),
        }
    } else {
        let base = PathBuf::from(folder_id);
        assert_path_access(app, state.inner(), &base, "sync")?;
        let dir = resolve_commits_dir(folder_id)?;
        assert_path_access(app, state.inner(), &dir, "sync")?;
        CommitStore::Fs(dir)
    };
    store.ensure()?;

    let device = get_or_create_device_id(&pool)?;
    let mut stats = LocalStats::default();

    let pulled_notes = pull_commits(&pool, &store, &device, &key, &mut stats)?;

    let now_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    push_commits(&pool, &store, &device, &key, now_ms, &mut stats)?;

    if !scoped_folder_skips_assets(folder_id) {
        match super::assets::sync_folder_assets(app, state.inner(), folder_id) {
            Ok(n) if n > 0 => {
                crate::rs_log!("[sync::local] folder assets transferred: {n}");
            }
            Ok(_) => {}
            Err(e) => crate::rs_log!("[sync::local] folder asset sync failed: {e}"),
        }
    } else {
        // Scoped (`scoped:`) folders are mobile sandbox handles with no raw
        // filesystem path, so folder asset mirroring is not wired for them:
        // commit sync still transfers note content, but media is not mirrored
        // (finding F9). Logged, not silent.
        crate::rs_log!(
            "[sync::local] folder asset mirroring unsupported for scoped storage; note media is not mirrored"
        );
    }

    stats.pulled_notes = pulled_notes;
    Ok(stats)
}

/// Push phase: publish every dirty row as a commit file. `now_ms` is fixed
/// per cycle by the caller so all files in one push share a timestamp;
/// tests pass explicit values for determinism. Symmetric to `pull_commits`.
fn push_commits(
    pool: &DbPool,
    store: &CommitStore,
    device: &str,
    key: &[u8; 32],
    now_ms: u64,
    stats: &mut LocalStats,
) -> Result<(), AppError> {
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
    for note in notes {

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
                    // Do NOT advance past this row: a later success would move
                    // the cursor beyond it and the update would never be
                    // published (F10). Count/log and stop this note; the row is
                    // retried next cycle.
                    // ponytail: a permanently-foreign row stalls this note's
                    // push queue (visible via `skipped`); quarantine by row id
                    // if that ever proves necessary.
                    stats.skipped += 1;
                    crate::rs_log!(
                        "[sync::local] holding push cursor at undecryptable row {id} for {note}: {e}"
                    );
                    break;
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
            match store.write(&name, serde_json::to_string(&envelope)?.as_bytes()) {
                Ok(()) => {
                    db::db_set(&pool, &wseq_key(&note), &seq.to_string(), None)?;
                    since = id;
                    stats.pushed += 1;
                }

                Err(_) => {
                    stats.pending_icloud += 1;
                    break;
                }
            }
        }
        db::db_set(&pool, &pushed_key(&note), &since.to_string(), None)?;

        if let Err(e) =
            compact_own_commits(pool, store, device, key, &note, now_ms, COMMIT_COMPACT_THRESHOLD)
        {
            crate::rs_log!("[sync::local] commit compaction skipped for {note}: {e}");
        }
    }
    Ok(())
}

/// Fold this device's own commit files for `note` into one snapshot-format
/// file and delete the superseded files, but only once `threshold` is reached
/// (finding F11: otherwise one file per row accumulates forever). A snapshot
/// carries full state, so any peer that has not read the deleted files still
/// converges from it; peer-owned files are left untouched.
fn compact_own_commits(
    pool: &DbPool,
    store: &CommitStore,
    device: &str,
    key: &[u8; 32],
    note: &str,
    now_ms: u64,
    threshold: usize,
) -> Result<u64, AppError> {
    let own: Vec<String> = store
        .list()?
        .into_iter()
        .filter(|name| {
            parse_sync_filename(name).is_some_and(|p| p.note == note && p.device == device)
        })
        .collect();
    if own.len() < threshold {
        return Ok(0);
    }
    let rows = db::yjs_get_updates(pool, note, Some(*key))?;
    if rows.is_empty() {
        return Ok(0);
    }
    let blobs: Vec<Vec<u8>> = rows.into_iter().map(|(_, b)| b).collect();
    let merged = merge_updates(&blobs);
    if merged.is_empty() {
        return Ok(0);
    }
    let aad = format!("{note}-snapshot-{now_ms}");
    let (iv, enc) = aead_encrypt_bytes(key, &merged, &aad)?;
    let envelope = serde_json::json!({
        "v": SYNC_PAYLOAD_VERSION,
        "meta": {
            "device": device,
            "ts": now_ms as i64,
            "sequence": 0i64,
            "noteId": note,
        },
        "iv": iv,
        "enc": enc,
    });
    let snapshot_name = format!("{note}{SEP}snapshot{SEP}{device}{SEP}{now_ms}{UPDATE_EXT}");
    store.write(&snapshot_name, serde_json::to_string(&envelope)?.as_bytes())?;
    // Every previous own file (snapshots included) is now superseded by the
    // full-state snapshot just written.
    let mut deleted = 0u64;
    for name in own {
        if name == snapshot_name {
            continue;
        }
        if store.remove(&name).is_ok() {
            deleted += 1;
        }
    }
    Ok(deleted)
}

/// Acquire the shared cycle guard for an externally-invoked folder cycle.
/// `None` when any cycle (tick, dirty push, another folder cycle) is already in
/// flight, so the caller skips instead of racing the same cursors/rows
/// (finding F12). The scheduler tick and dirty push hold the same guard.
fn try_begin_local_cycle() -> Option<crate::sync::scheduler::CycleGuard> {
    crate::sync::scheduler::begin_cycle()
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn sync_local_cycle(
    app: AppHandle,
    folder_id: String,
) -> Result<LocalStats, AppError> {
    // Serialize with the scheduler's full cycles; a concurrent folder cycle
    // races the same cursors/rows (finding F12). No-op (not an error) when a
    // cycle is already in flight, matching the tick guard's posture.
    let Some(_cycle) = try_begin_local_cycle() else {
        crate::rs_log!("[sync::local] cycle already running; skipping sync:localCycle");
        return Ok(LocalStats::default());
    };
    sync_local_cycle_unlocked(app, folder_id).await
}

/// Folder cycle body without the cycle guard: use from callers that already
/// hold it (the scheduler tick and dirty push). External `sync:localCycle`
/// invocations go through [`sync_local_cycle`], which acquires the guard.
pub(crate) async fn sync_local_cycle_unlocked(
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

    #[test]
    fn atomic_write_survives_partial_failure() {
        let dir =
            std::env::temp_dir().join(format!("beaver-sync-atomic-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("n~~d~~1~~2.yjs.json");
        super::atomic_write(&target, b"data").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"data");
        assert!(std::fs::read_dir(&dir).unwrap().count() == 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn evicted_placeholder_check_passes_through_real_files() {
        let dir =
            std::env::temp_dir().join(format!("beaver-sync-evicted-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("n~~d~~1~~2.yjs.json");
        std::fs::write(&target, b"data").unwrap();
        assert!(!super::is_evicted_placeholder(&target));
        assert!(!super::is_evicted_placeholder(&dir.join("missing.yjs.json")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scoped_routing_strips_prefix_only_when_present() {
        assert_eq!(
            "scoped:folder-1".strip_prefix(super::SCOPED_PREFIX),
            Some("folder-1")
        );
        assert_eq!("/plain/sync/dir".strip_prefix(super::SCOPED_PREFIX), None);
        assert_eq!("".strip_prefix(super::SCOPED_PREFIX), None);
    }

    #[test]
    fn scoped_path_joins_with_slash() {
        assert_eq!(
            super::scoped_join(super::SCOPED_COMMITS_REL, "a~~d~~1~~2.yjs.json"),
            "BeaverNotesSync/commits/a~~d~~1~~2.yjs.json"
        );
    }

    /// Regression: the old single-max-cursor gate permanently skipped peer
    /// commits that landed after a newer-tuple file was consumed (live case:
    /// side A's meta cursor sat at (ts,5) while side B's (smaller-ts,6/7)
    /// commits were never applied). Per-file markers must consume them.
    #[test]
    fn pull_consumes_older_tuple_files_landing_after_newer_ones() {
        use yrs::{Doc, ReadTxn, StateVector, Text, Transact};

        fn update(text: &str) -> Vec<u8> {
            let doc = Doc::new();
            let t = doc.get_or_insert_text("t");
            let mut txn = doc.transact_mut();
            t.insert(&mut txn, 0, text);
            txn.encode_state_as_update_v1(&StateVector::default())
        }

        fn write_commit(
            store: &super::CommitStore,
            key: &[u8; 32],
            note: &str,
            from_device: &str,
            ts: u64,
            seq: u64,
            body: &[u8],
        ) {
            let aad = format!("{note}-{ts}");
            let (iv, enc) =
                crate::shared::aead_encrypt_bytes(key, body, &aad).expect("encrypt commit");
            let envelope = serde_json::json!({
                "v": crate::shared::SYNC_PAYLOAD_VERSION,
                "meta": {"device": from_device, "ts": ts as i64, "sequence": seq as i64, "noteId": note},
                "iv": iv,
                "enc": enc,
            });
            let name = format!("{note}~~{from_device}~~{ts}~~{seq}.yjs.json");
            store
                .write(&name, serde_json::to_string(&envelope).unwrap().as_bytes())
                .expect("write commit");
        }

        fn row_count(pool: &crate::db::DbPool, key: &[u8; 32]) -> usize {
            crate::db::yjs_get_updates(pool, "meta", Some(*key))
                .expect("read rows")
                .len()
        }

        let root = std::env::temp_dir().join(format!(
            "beaver-sync-markers-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let commits = root.join("commits");
        std::fs::create_dir_all(&commits).unwrap();
        let pool = crate::db::open_pool(&root.join("data.db")).expect("pool");
        let store = super::CommitStore::Fs(commits);
        let key = [7u8; 32];
        let device = super::get_or_create_device_id(&pool).expect("device id");
        let mut stats = super::LocalStats::default();

        // Cycle 1 consumes the newer-tuple file first.
        write_commit(&store, &key, "meta", "devB", 2000, 5, &update("one"));
        assert_eq!(
            super::pull_commits(&pool, &store, &device, &key, &mut stats).expect("pull 1"),
            vec!["meta".to_string()]
        );
        assert_eq!(row_count(&pool, &key), 1);

        // Older-tuple files land afterwards (mid-cycle landing / delayed write).
        write_commit(&store, &key, "meta", "devB", 1000, 6, &update("two"));
        write_commit(&store, &key, "meta", "devB", 1500, 7, &update("three"));
        assert_eq!(
            super::pull_commits(&pool, &store, &device, &key, &mut stats).expect("pull 2"),
            vec!["meta".to_string()]
        );
        assert_eq!(row_count(&pool, &key), 3);

        // Exactly once: a third cycle applies nothing new.
        assert!(
            super::pull_commits(&pool, &store, &device, &key, &mut stats)
                .expect("pull 3")
                .is_empty()
        );
        assert_eq!(row_count(&pool, &key), 3);

        let _ = std::fs::remove_dir_all(&root);
    }

    // ---- two-device transport suite: two pools, one shared folder ----

    struct TwoDev {
        root: std::path::PathBuf,
        pool_a: crate::db::DbPool,
        pool_b: crate::db::DbPool,
        dev_a: String,
        dev_b: String,
        key: [u8; 32],
        store: super::CommitStore,
    }

    impl TwoDev {
        fn setup(tag: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "beaver-sync-2dev-{tag}-{}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&root);
            let commits = root.join("commits");
            std::fs::create_dir_all(&commits).unwrap();
            let pool_a = crate::db::open_pool(&root.join("a.db")).expect("pool a");
            let pool_b = crate::db::open_pool(&root.join("b.db")).expect("pool b");
            let dev_a = super::get_or_create_device_id(&pool_a).expect("device a");
            let dev_b = super::get_or_create_device_id(&pool_b).expect("device b");
            assert_ne!(dev_a, dev_b, "devices must differ across pools");
            Self {
                root,
                pool_a,
                pool_b,
                dev_a,
                dev_b,
                key: [9u8; 32],
                store: super::CommitStore::Fs(commits),
            }
        }

        fn update(text: &str) -> Vec<u8> {
            use yrs::{Doc, ReadTxn, StateVector, Text, Transact};
            let doc = Doc::new();
            let t = doc.get_or_insert_text("t");
            let mut txn = doc.transact_mut();
            t.insert(&mut txn, 0, text);
            txn.encode_state_as_update_v1(&StateVector::default())
        }

        fn edit(&self, pool: &crate::db::DbPool, note: &str, text: &str) {
            crate::db::yjs_append(pool, note, &Self::update(text), "local", Some(self.key))
                .expect("seed row");
        }

        fn push(
            &self,
            pool: &crate::db::DbPool,
            dev: &str,
            now_ms: u64,
        ) -> super::LocalStats {
            let mut stats = super::LocalStats::default();
            super::push_commits(pool, &self.store, dev, &self.key, now_ms, &mut stats)
                .expect("push");
            stats
        }

        fn pull(&self, pool: &crate::db::DbPool, dev: &str) -> Vec<String> {
            let mut stats = super::LocalStats::default();
            super::pull_commits(pool, &self.store, dev, &self.key, &mut stats).expect("pull")
        }

        fn rows(&self, pool: &crate::db::DbPool, note: &str) -> usize {
            crate::db::yjs_get_updates(pool, note, Some(self.key))
                .expect("read rows")
                .len()
        }

        fn snap(&self, pool: &crate::db::DbPool, note: &str) -> Vec<u8> {
            crate::db::yjs_get_snapshot(pool, note, Some(self.key)).expect("snapshot")
        }

        fn files(&self) -> Vec<String> {
            self.store.list().expect("list")
        }

        fn cleanup(self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn two_devices_roundtrip_note_a_to_b() {
        let t = TwoDev::setup("roundtrip");
        t.edit(&t.pool_a, "n1", "hello");
        assert_eq!(t.push(&t.pool_a, &t.dev_a, 1000).pushed, 1);
        assert_eq!(t.pull(&t.pool_b, &t.dev_b), vec!["n1".to_string()]);
        assert_eq!(t.rows(&t.pool_b, "n1"), 1);
        assert_eq!(t.snap(&t.pool_a, "n1"), t.snap(&t.pool_b, "n1"));
        t.cleanup();
    }

    #[test]
    fn two_devices_meta_and_content_travel_together() {
        let t = TwoDev::setup("meta-content");
        t.edit(&t.pool_a, "meta", "titles");
        t.edit(&t.pool_a, "n1", "body");
        t.push(&t.pool_a, &t.dev_a, 1000);
        let mut pulled = t.pull(&t.pool_b, &t.dev_b);
        pulled.sort();
        assert_eq!(pulled, vec!["meta".to_string(), "n1".to_string()]);
        assert_eq!(t.snap(&t.pool_a, "meta"), t.snap(&t.pool_b, "meta"));
        assert_eq!(t.snap(&t.pool_a, "n1"), t.snap(&t.pool_b, "n1"));
        t.cleanup();
    }

    #[test]
    fn two_devices_concurrent_same_note_converges() {
        let t = TwoDev::setup("concurrent");
        t.edit(&t.pool_a, "n1", "aaa");
        t.edit(&t.pool_b, "n1", "bbb");
        t.push(&t.pool_a, &t.dev_a, 1000);
        t.push(&t.pool_b, &t.dev_b, 1000);
        t.pull(&t.pool_b, &t.dev_b);
        t.pull(&t.pool_a, &t.dev_a);
        assert_eq!(t.rows(&t.pool_a, "n1"), 2);
        assert_eq!(t.rows(&t.pool_b, "n1"), 2);
        assert_eq!(t.snap(&t.pool_a, "n1"), t.snap(&t.pool_b, "n1"));
        t.cleanup();
    }

    #[test]
    fn two_devices_older_tuple_push_consumed_after_newer() {
        // End-to-end shape of the live H3 loss: B publishes with an older ts
        // after A already consumed a newer-tuple file; markers must pick it up.
        let t = TwoDev::setup("older-tuple");
        t.edit(&t.pool_a, "meta", "new");
        t.push(&t.pool_a, &t.dev_a, 2000);
        assert_eq!(t.pull(&t.pool_b, &t.dev_b), vec!["meta".to_string()]);
        t.edit(&t.pool_b, "meta", "old-but-late");
        t.push(&t.pool_b, &t.dev_b, 1000);
        assert_eq!(t.pull(&t.pool_a, &t.dev_a), vec!["meta".to_string()]);
        assert_eq!(t.snap(&t.pool_a, "meta"), t.snap(&t.pool_b, "meta"));
        t.cleanup();
    }

    #[test]
    fn two_devices_pull_is_exactly_once() {
        let t = TwoDev::setup("exactly-once");
        t.edit(&t.pool_a, "n1", "x");
        t.push(&t.pool_a, &t.dev_a, 1000);
        assert!(!t.pull(&t.pool_b, &t.dev_b).is_empty());
        assert!(t.pull(&t.pool_b, &t.dev_b).is_empty());
        assert_eq!(t.rows(&t.pool_b, "n1"), 1);
        t.cleanup();
    }

    #[test]
    fn two_devices_own_files_ignored() {
        let t = TwoDev::setup("own-files");
        t.edit(&t.pool_a, "n1", "x");
        t.push(&t.pool_a, &t.dev_a, 1000);
        assert!(t.pull(&t.pool_a, &t.dev_a).is_empty());
        assert_eq!(t.rows(&t.pool_a, "n1"), 1);
        t.cleanup();
    }

    #[test]
    fn two_devices_corrupt_file_skips_without_blocking_valid() {
        let t = TwoDev::setup("corrupt");
        t.edit(&t.pool_b, "good", "ok");
        t.push(&t.pool_b, &t.dev_b, 1000);
        let bad = format!("good~~{}~~1000~~99.yjs.json", t.dev_b);
        t.store.write(&bad, b"not json at all").expect("write bad");
        let pulled = t.pull(&t.pool_a, &t.dev_a);
        assert_eq!(pulled, vec!["good".to_string()]);
        assert_eq!(t.rows(&t.pool_a, "good"), 1);
        // Corrupt file stays on disk, skipped every cycle without error.
        assert!(t.pull(&t.pool_a, &t.dev_a).is_empty());
        assert!(t.files().contains(&bad));
        t.cleanup();
    }

    #[test]
    fn two_devices_wrong_key_commit_never_lands_or_blocks() {
        let t = TwoDev::setup("wrong-key");
        // Commit encrypted under a foreign vault key.
        let aad = "evil-1000";
        let (iv, enc) =
            crate::shared::aead_encrypt_bytes(&[1u8; 32], &TwoDev::update("x"), aad)
                .expect("encrypt");
        let envelope = serde_json::json!({
            "v": crate::shared::SYNC_PAYLOAD_VERSION,
            "meta": {"device": "devX", "ts": 1000i64, "sequence": 1i64, "noteId": "evil"},
            "iv": iv, "enc": enc,
        });
        let name = format!("evil~~devX~~1000~~1.yjs.json");
        t.store
            .write(&name, serde_json::to_string(&envelope).unwrap().as_bytes())
            .expect("write evil");
        t.edit(&t.pool_b, "good", "ok");
        t.push(&t.pool_b, &t.dev_b, 1000);
        let pulled = t.pull(&t.pool_a, &t.dev_a);
        assert_eq!(pulled, vec!["good".to_string()]);
        assert_eq!(t.rows(&t.pool_a, "evil"), 0);
        t.cleanup();
    }

    #[test]
    fn two_devices_unsafe_note_id_never_reaches_folder() {
        let t = TwoDev::setup("unsafe-id");
        t.edit(&t.pool_a, "a~~b", "x");
        t.edit(&t.pool_a, "fine", "y");
        t.push(&t.pool_a, &t.dev_a, 1000);
        for name in t.files() {
            assert!(!name.starts_with("a~~"), "unsafe id leaked: {name}");
        }
        assert!(t.files().iter().any(|n| n.starts_with("fine~~")));
        t.cleanup();
    }

    #[test]
    fn two_devices_snapshot_and_legacy_files_consumed() {
        let t = TwoDev::setup("formats");
        // Snapshot-format file (note~~snapshot~~dev~~ts, snapshot AAD).
        let body = TwoDev::update("snap");
        let aad = "n1-snapshot-1000";
        let (iv, enc) = crate::shared::aead_encrypt_bytes(&t.key, &body, aad).expect("enc");
        let snap_env = serde_json::json!({
            "v": crate::shared::SYNC_PAYLOAD_VERSION,
            "meta": {"device": "devX", "ts": 1000i64, "sequence": 0i64, "noteId": "n1"},
            "iv": iv, "enc": enc,
        });
        t.store
            .write(
                "n1~~snapshot~~devX~~1000.yjs.json",
                serde_json::to_string(&snap_env).unwrap().as_bytes(),
            )
            .expect("write snapshot");
        // Legacy 3-part file (no seq, normal AAD).
        let body2 = TwoDev::update("legacy");
        let (iv2, enc2) =
            crate::shared::aead_encrypt_bytes(&t.key, &body2, "n2-2000").expect("enc");
        let leg_env = serde_json::json!({
            "v": crate::shared::SYNC_PAYLOAD_VERSION,
            "meta": {"device": "devX", "ts": 2000i64, "sequence": 0i64, "noteId": "n2"},
            "iv": iv2, "enc": enc2,
        });
        t.store
            .write(
                "n2~~devX~~2000.yjs.json",
                serde_json::to_string(&leg_env).unwrap().as_bytes(),
            )
            .expect("write legacy");
        let mut pulled = t.pull(&t.pool_a, &t.dev_a);
        pulled.sort();
        assert_eq!(pulled, vec!["n1".to_string(), "n2".to_string()]);
        assert_eq!(t.rows(&t.pool_a, "n1"), 1);
        assert_eq!(t.rows(&t.pool_a, "n2"), 1);
        t.cleanup();
    }

    #[test]
    fn two_devices_push_shares_one_ts_across_notes() {
        let t = TwoDev::setup("shared-ts");
        t.edit(&t.pool_a, "n1", "a");
        t.edit(&t.pool_a, "n2", "b");
        let stats = t.push(&t.pool_a, &t.dev_a, 5000);
        assert_eq!(stats.pushed, 2);
        let files = t.files();
        assert_eq!(files.len(), 2);
        for name in &files {
            assert!(name.contains("~~5000~~"), "unexpected ts: {name}");
        }
        t.cleanup();
    }

    /// F4 (a)/(b): a key migration clears the transport push cursors, so an
    /// already-acked note is re-published exactly once; the following cycle is
    /// quiet again (converges to steady state rather than looping).
    #[test]
    fn two_devices_republish_after_push_cursor_reset_then_converge() {
        let t = TwoDev::setup("cursor-reset");
        t.edit(&t.pool_a, "n1", "hello");
        assert_eq!(t.push(&t.pool_a, &t.dev_a, 1000).pushed, 1);
        assert_eq!(
            t.push(&t.pool_a, &t.dev_a, 2000).pushed,
            0,
            "steady state: nothing new to push"
        );
        // Vault join/rotation resets the cursors as part of the key migration.
        crate::db::reset_transport_push_cursors(&t.pool_a).expect("reset");
        assert_eq!(
            t.push(&t.pool_a, &t.dev_a, 3000).pushed,
            1,
            "the migrated note must re-publish under the adopted key"
        );
        assert_eq!(
            t.push(&t.pool_a, &t.dev_a, 4000).pushed,
            0,
            "re-publish must converge, not loop"
        );
        t.cleanup();
    }

    #[test]
    fn two_devices_marker_pruned_when_file_deleted() {
        let t = TwoDev::setup("prune");
        t.edit(&t.pool_b, "n1", "x");
        t.push(&t.pool_b, &t.dev_b, 1000);
        assert_eq!(t.pull(&t.pool_a, &t.dev_a), vec!["n1".to_string()]);
        let name = t
            .files()
            .into_iter()
            .find(|n| n.starts_with("n1~~"))
            .expect("commit file");
        let parsed = super::parse_sync_filename(&name).expect("parse");
        let key = super::seen_key(&parsed);
        assert!(crate::db::db_get(&t.pool_a, &key, None).expect("db_get").is_some());
        std::fs::remove_file(t.root.join("commits").join(&name)).expect("delete commit");
        assert!(t.pull(&t.pool_a, &t.dev_a).is_empty());
        assert!(crate::db::db_get(&t.pool_a, &key, None).expect("db_get").is_none());
        t.cleanup();
    }

    // ---- A+ gap tests: hostile/edge inputs, ping-pong, unicode, scale ----

    fn write_envelope(
        t: &TwoDev,
        file_note: &str,
        meta_note: &str,
        device: &str,
        ts: u64,
        seq: u64,
        body: &[u8],
    ) -> (String, Vec<u8>) {
        let aad = format!("{file_note}-{ts}");
        let (iv, enc) =
            crate::shared::aead_encrypt_bytes(&t.key, body, &aad).expect("enc");
        let envelope = serde_json::json!({
            "v": crate::shared::SYNC_PAYLOAD_VERSION,
            "meta": {"device": device, "ts": ts as i64, "sequence": seq as i64, "noteId": meta_note},
            "iv": iv, "enc": enc,
        });
        let name = format!("{file_note}~~{device}~~{ts}~~{seq}.yjs.json");
        (name, serde_json::to_string(&envelope).unwrap().into_bytes())
    }

    fn has_marker(t: &TwoDev, pool: &crate::db::DbPool, name: &str) -> bool {
        let _ = t;
        let p = super::parse_sync_filename(name).expect("parse");
        crate::db::db_get(pool, &super::seen_key(&p), None)
            .expect("get")
            .is_some()
    }

    #[test]
    fn two_devices_meta_filename_mismatch_rejected() {
        let t = TwoDev::setup("mismatch");
        let (name, bytes) = write_envelope(&t, "real", "other", "devX", 1000, 1, &TwoDev::update("x"));
        t.store.write(&name, &bytes).expect("write");
        assert!(t.pull(&t.pool_a, &t.dev_a).is_empty());
        assert_eq!(t.rows(&t.pool_a, "real"), 0);
        assert_eq!(t.rows(&t.pool_a, "other"), 0);
        // Fail-closed without consuming: retried, never marked, file stays.
        assert!(t.pull(&t.pool_a, &t.dev_a).is_empty());
        assert!(!has_marker(&t, &t.pool_a, &name));
        assert!(t.files().contains(&name));
        t.cleanup();
    }

    #[test]
    fn two_devices_bad_envelope_version_skipped_without_consuming() {
        let t = TwoDev::setup("badver");
        let envelope = serde_json::json!({
            "v": 999,
            "meta": {"device": "devX", "ts": 1000i64, "sequence": 1i64, "noteId": "n1"},
            "iv": "00", "enc": "00",
        });
        let name = format!("n1~~devX~~1000~~1.yjs.json");
        t.store
            .write(&name, serde_json::to_string(&envelope).unwrap().as_bytes())
            .expect("write");
        assert!(t.pull(&t.pool_a, &t.dev_a).is_empty());
        assert!(t.pull(&t.pool_a, &t.dev_a).is_empty());
        assert_eq!(t.rows(&t.pool_a, "n1"), 0);
        assert!(!has_marker(&t, &t.pool_a, &name));
        t.cleanup();
    }

    #[test]
    fn two_devices_empty_file_skipped_without_blocking_valid() {
        let t = TwoDev::setup("empty");
        let empty = format!("n0~~devX~~1000~~1.yjs.json");
        t.store.write(&empty, b"").expect("write empty");
        t.edit(&t.pool_b, "good", "ok");
        t.push(&t.pool_b, &t.dev_b, 1000);
        assert_eq!(t.pull(&t.pool_a, &t.dev_a), vec!["good".to_string()]);
        assert!(t.pull(&t.pool_a, &t.dev_a).is_empty());
        assert!(t.files().contains(&empty));
        t.cleanup();
    }

    #[test]
    fn two_devices_ping_pong_self_stabilizes() {
        // Echo semantics: a side that never pulled has no cached vector yet,
        // so the first echo of its own update appends one duplicate row. Yjs
        // merges are idempotent (snapshots stay equal) and the pull refreshes
        // the vector, so all further rounds are quiet.
        let t = TwoDev::setup("pingpong");
        t.edit(&t.pool_a, "n1", "hello");
        t.push(&t.pool_a, &t.dev_a, 1000);
        assert_eq!(t.pull(&t.pool_b, &t.dev_b), vec!["n1".to_string()]);
        // B re-publishes everything it holds, including A's update, as its own file.
        t.push(&t.pool_b, &t.dev_b, 2000);
        assert_eq!(t.pull(&t.pool_a, &t.dev_a), vec!["n1".to_string()]);
        assert_eq!(t.snap(&t.pool_a, "n1"), t.snap(&t.pool_b, "n1"));
        // Vectors now cover the update on both sides: further rounds append nothing.
        t.push(&t.pool_a, &t.dev_a, 3000);
        assert!(t.pull(&t.pool_b, &t.dev_b).is_empty());
        t.push(&t.pool_b, &t.dev_b, 4000);
        assert!(t.pull(&t.pool_a, &t.dev_a).is_empty());
        assert_eq!(t.snap(&t.pool_a, "n1"), t.snap(&t.pool_b, "n1"));
        t.cleanup();
    }

    #[test]
    fn two_devices_unicode_note_id_roundtrips() {
        let t = TwoDev::setup("unicode");
        let note = "café-☕-note";
        t.edit(&t.pool_a, note, "unicode body");
        assert_eq!(t.push(&t.pool_a, &t.dev_a, 1000).pushed, 1);
        assert_eq!(t.pull(&t.pool_b, &t.dev_b), vec![note.to_string()]);
        assert_eq!(t.snap(&t.pool_a, note), t.snap(&t.pool_b, note));
        t.cleanup();
    }

    #[test]
    fn two_devices_device_id_stable_within_pool() {
        let t = TwoDev::setup("devid");
        let again = super::get_or_create_device_id(&t.pool_a).expect("device again");
        assert_eq!(again, t.dev_a);
        t.cleanup();
    }

    #[test]
    fn two_devices_large_update_roundtrips_1mb() {
        let t = TwoDev::setup("large");
        let big = "x".repeat(1024 * 1024);
        t.edit(&t.pool_a, "big", &big);
        assert_eq!(t.push(&t.pool_a, &t.dev_a, 1000).pushed, 1);
        assert_eq!(t.pull(&t.pool_b, &t.dev_b), vec!["big".to_string()]);
        assert_eq!(t.snap(&t.pool_a, "big"), t.snap(&t.pool_b, "big"));
        t.cleanup();
    }

    /// F5: a readable-but-unapplicable commit (unknown envelope version) must
    /// be counted/logged instead of silently retried every cycle.
    #[test]
    fn unappliable_commit_is_counted() {
        let t = TwoDev::setup("bad-counted");
        let envelope = serde_json::json!({
            "v": 999,
            "meta": {"device": "devX", "ts": 1000i64, "sequence": 1i64, "noteId": "n1"},
            "iv": "00", "enc": "00",
        });
        t.store
            .write(
                "n1~~devX~~1000~~1.yjs.json",
                serde_json::to_string(&envelope).unwrap().as_bytes(),
            )
            .expect("write");
        let mut stats = super::LocalStats::default();
        super::pull_commits(&t.pool_a, &t.store, &t.dev_a, &t.key, &mut stats).expect("pull");
        assert_eq!(stats.skipped, 1, "a bad commit must be counted (F5)");
        assert_eq!(stats.pulled, 0);
        t.cleanup();
    }

    /// F6: a commit whose filename is NFD (macOS) but whose payload names the
    /// NFC note id must still match, not be dropped forever.
    #[test]
    fn two_devices_nfc_nfd_note_id_matches() {
        use unicode_normalization::UnicodeNormalization;
        let t = TwoDev::setup("nfc-nfd");
        let nfc: String = "café".nfc().collect();
        let nfd: String = "café".nfd().collect();
        assert_ne!(nfc, nfd, "the two forms must differ to exercise the bug");
        let (name, bytes) = write_envelope(&t, &nfd, &nfc, "devX", 1000, 1, &TwoDev::update("x"));
        t.store.write(&name, &bytes).expect("write");
        let pulled = t.pull(&t.pool_a, &t.dev_a);
        assert_eq!(
            pulled,
            vec![nfc.clone()],
            "NFD filename must still match its NFC payload note id"
        );
        assert_eq!(t.rows(&t.pool_a, &nfc), 1);
        t.cleanup();
    }

    /// F10: an undecryptable row must not advance `pushed_key` past it, or a
    /// later successful publish would skip that update permanently.
    #[test]
    fn push_cursor_holds_at_undecryptable_row() {
        let t = TwoDev::setup("hold-cursor");
        let foreign = [1u8; 32];
        t.edit(&t.pool_a, "n1", "good-before");
        crate::db::yjs_append(&t.pool_a, "n1", b"foreign row", "devX", Some(foreign))
            .expect("append foreign");
        t.edit(&t.pool_a, "n1", "good-after");

        let mut stats = super::LocalStats::default();
        super::push_commits(&t.pool_a, &t.store, &t.dev_a, &t.key, 1000, &mut stats).expect("push");
        assert_eq!(stats.pushed, 1, "only the row before the bad one is published");
        assert_eq!(stats.skipped, 1);
        assert_eq!(
            t.files().len(),
            1,
            "the row after the undecryptable one must not be published"
        );

        let cursor: i64 = crate::db::db_get(&t.pool_a, &super::pushed_key("n1"), None)
            .unwrap()
            .unwrap()
            .parse()
            .unwrap();
        let max_id: i64 = {
            let conn = t.pool_a.get().expect("conn");
            conn.query_row(
                "SELECT MAX(id) FROM note_content WHERE note_id = 'n1'",
                [],
                |r| r.get(0),
            )
            .expect("max id")
        };
        assert!(
            cursor < max_id,
            "cursor must not advance past the undecryptable row (F10)"
        );
        t.cleanup();
    }

    /// F9: scoped folders have no raw filesystem path, so folder asset
    /// mirroring is explicitly skipped (and logged) rather than attempted.
    #[test]
    fn scoped_folders_skip_asset_mirroring() {
        assert!(super::scoped_folder_skips_assets("scoped:folder-1"));
        assert!(!super::scoped_folder_skips_assets("/plain/sync/dir"));
    }

    /// F12: the folder cycle shares the scheduler's cycle guard, so a second
    /// concurrent cycle is rejected rather than racing cursors/rows.
    #[test]
    fn local_cycle_guard_rejects_a_concurrent_cycle() {
        // The guard is process-global; serialize with the other guard test so
        // parallel `cargo test` cannot observe its held guard.
        let _serial = crate::sync::scheduler::CYCLE_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let first = super::try_begin_local_cycle().expect("first cycle");
        assert!(
            super::try_begin_local_cycle().is_none(),
            "a concurrent cycle must be rejected while one is running"
        );
        drop(first);
        assert!(
            super::try_begin_local_cycle().is_some(),
            "a new cycle may start once the previous one finishes"
        );
    }

    /// F11: repeated edit+push rounds must not multiply commit files; once a
    /// note's own files reach the threshold they fold into one snapshot.
    #[test]
    fn repeated_rounds_bounded_by_commit_compaction() {
        let t = TwoDev::setup("compact");
        for i in 0..(super::COMMIT_COMPACT_THRESHOLD + 8) {
            t.edit(&t.pool_a, "n1", &format!("edit-{i}"));
            t.push(&t.pool_a, &t.dev_a, 1000 + i as u64);
        }
        let own = t
            .files()
            .into_iter()
            .filter(|n| n.starts_with("n1~~") && n.contains(&t.dev_a))
            .count();
        assert!(
            own <= super::COMMIT_COMPACT_THRESHOLD,
            "own commit files must stay bounded by compaction, got {own}"
        );
        // A peer still converges from the compacted folder.
        assert_eq!(t.pull(&t.pool_b, &t.dev_b), vec!["n1".to_string()]);
        t.cleanup();
    }
}
