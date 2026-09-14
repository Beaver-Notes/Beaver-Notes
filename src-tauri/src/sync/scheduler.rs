use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(desktop)]
use notify::{RecommendedWatcher, RecursiveMode, Watcher};

use super::assets::sync_cloud_assets;
use super::bootstrap::{bootstrap_from_snapshots, seed_cloud_workspace};
use super::cloud::{
    CloudFail, SyncError, SyncStatus, DEFAULT_API_URL, local_cloud_flags, sync_cloud_pull,
    sync_cloud_push,
};
use crate::shared::{AppError, AppState, current_app_key, data_pool};

/// Full-cycle cadence (mirrors the JS engine 30s pull timer).
const TICK_INTERVAL: Duration = Duration::from_secs(30);
/// WS-notify kicks coalesce here before a tick runs.
const KICK_DEBOUNCE: Duration = Duration::from_millis(200);
/// Dirty pushes coalesce here so a keystroke burst becomes one request.
const DIRTY_COALESCE: Duration = Duration::from_millis(600);
/// Pushes closer than this after a successful push are skipped unless forced
/// (mirrors JS `CLOUD_PUSH_MIN_INTERVAL_MS`).
const PUSH_MIN_INTERVAL: Duration = Duration::from_secs(30);

/// Exponential backoff budget for transports: 1s floor, doubling per
/// consecutive failure, 60s cap. `record_success` resets to the floor.
/// The scheduler parks pushes for the current delay on 429/5xx; 401 stops
/// pushing via the auth gate below; offline skips silently (typed `Offline`).
#[derive(Default)]
pub struct RetryBudget {
    consecutive: u32,
}

impl RetryBudget {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn delay_ms(&self, attempt: u32) -> u64 {
        1_000u64
            .saturating_mul(2_u64.pow(attempt.saturating_sub(1).min(6)))
            .min(60_000)
    }

    pub fn record_failure(&mut self) {
        self.consecutive = self.consecutive.saturating_add(1);
    }

    pub fn record_success(&mut self) {
        self.consecutive = 0;
    }

    fn current_delay_ms(&self) -> u64 {
        self.delay_ms(self.consecutive.max(1))
    }
}

/// Cloud identity + folder target, owned by JS (account store) and passed in
/// on every command; the scheduler only caches the latest copy in memory.
#[derive(Clone, Default)]
struct StoredConfig {
    workspace_id: String,
    server_url: String,
    token: String,
    folder_id: Option<String>,
    /// Active transport name from JS (`"folder"` or `"remote"`); `None` means
    /// unknown and is treated as cloud-enabled.
    transport: Option<String>,
}

/// Folder-only transport means the Rust tick must not touch the cloud.
fn cloud_enabled(transport: Option<&str>) -> bool {
    transport != Some("folder")
}

#[derive(Clone, Copy, PartialEq)]
enum KickKind {
    Kick,
    Dirty,
    Shutdown,
}

struct SchedState {
    config: Option<StoredConfig>,
    backoff_until: Option<Instant>,
    retry: RetryBudget,
    /// Server 401/403: stop pushing until the identity inputs change.
    no_push_auth: bool,
    last_push_at: Option<Instant>,
    running: bool,
    tx: Option<tokio::sync::mpsc::UnboundedSender<KickKind>>,
}

impl SchedState {
    fn new() -> Self {
        Self {
            config: None,
            backoff_until: None,
            retry: RetryBudget::new(),
            no_push_auth: false,
            last_push_at: None,
            running: false,
            tx: None,
        }
    }
}

static SCHED: OnceLock<Mutex<SchedState>> = OnceLock::new();

fn sched() -> &'static Mutex<SchedState> {
    SCHED.get_or_init(|| Mutex::new(SchedState::new()))
}

/// Guards so the seed/bootstrap network probes stop repeating once they have
/// actually taken effect. Both stay clear after a skip/empty result (matching
/// the JS authority, which re-probes on every pull) and reset on `sync_stop`.
static SEED_ATTEMPTED: AtomicBool = AtomicBool::new(false);
static BOOTSTRAP_ATTEMPTED: AtomicBool = AtomicBool::new(false);

/// Watches the active folder transport's commits directory and kicks the
/// scheduler on any change, so a peer's writes are noticed in well under the
/// 30s tick. Recreated when the sync folder changes; dropped on `sync_stop`.
/// Our own commit writes also fire this, but a follow-up tick is a no-op once
/// the push cursor has advanced.
#[cfg(desktop)]
static FOLDER_WATCH: OnceLock<Mutex<Option<(PathBuf, RecommendedWatcher)>>> = OnceLock::new();

#[cfg(desktop)]
fn folder_watch() -> &'static Mutex<Option<(PathBuf, RecommendedWatcher)>> {
    FOLDER_WATCH.get_or_init(|| Mutex::new(None))
}

#[cfg(desktop)]
fn commits_dir_for(folder_id: &str) -> PathBuf {
    let base = PathBuf::from(folder_id);
    if base.file_name().and_then(|n| n.to_str()) == Some("commits") {
        base
    } else {
        base.join("BeaverNotesSync").join("commits")
    }
}

#[cfg(desktop)]
fn refresh_folder_watcher(
    tx: &tokio::sync::mpsc::UnboundedSender<KickKind>,
    folder_id: Option<&str>,
) {
    let desired = folder_id
        .filter(|f| !f.trim().is_empty() && !f.starts_with("scoped:"))
        .map(commits_dir_for);
    let mut slot = folder_watch().lock().unwrap_or_else(|e| e.into_inner());
    if slot.as_ref().map(|(p, _)| p.clone()) == desired {
        return;
    }
    *slot = None;
    let Some(dir) = desired else {
        return;
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        crate::rs_log!("[sync] folder watch dir unavailable {}: {e}", dir.display());
        return;
    }
    let tx = tx.clone();
    match notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = tx.send(KickKind::Kick);
        }
    }) {
        Ok(mut watcher) => match watcher.watch(&dir, RecursiveMode::NonRecursive) {
            Ok(()) => {
                crate::rs_log!("[sync] watching folder for changes: {}", dir.display());
                *slot = Some((dir, watcher));
            }
            Err(e) => crate::rs_log!("[sync] folder watch failed {}: {e}", dir.display()),
        },
        Err(e) => crate::rs_log!("[sync] watcher init failed: {e}"),
    }
}

#[cfg(not(desktop))]
fn refresh_folder_watcher(
    _tx: &tokio::sync::mpsc::UnboundedSender<KickKind>,
    _folder_id: Option<&str>,
) {
}

#[cfg(desktop)]
fn drop_folder_watcher() {
    if let Ok(mut slot) = folder_watch().lock() {
        *slot = None;
    }
}

#[cfg(not(desktop))]
fn drop_folder_watcher() {}

fn emit_status(app: &AppHandle, status: &str) {
    let _ = app.emit("sync:status", serde_json::json!({ "status": status }));
}

/// Progress payload keys MUST match the JS listener in
/// `src/store/sync-progress.js` (`{ phase, processed, total }`), not the
/// plan's `{ phase, done, total }`.
fn emit_progress(app: &AppHandle, phase: &str, processed: u64, total: u64) {
    let _ = app.emit(
        "sync:progress",
        serde_json::json!({ "phase": phase, "processed": processed, "total": total }),
    );
}

fn emit_applied(app: &AppHandle, note_ids: &[String]) {
    let _ = app.emit("sync:applied", serde_json::json!({ "noteIds": note_ids }));
}

/// Best-effort: reports ids from chunks genuinely pushed this call, even when a
/// later chunk 401/403s and the cycle ends `authorization-failed`. A future JS
/// hook must not read this as "cycle succeeded".
fn emit_pushed(app: &AppHandle, note_ids: &[String]) {
    let _ = app.emit("sync:pushed", serde_json::json!({ "noteIds": note_ids }));
}

fn emit_error(app: &AppHandle, message: &str) {
    let _ = app.emit("sync:error", serde_json::json!({ "message": message }));
}

/// Per-tick telemetry (payload keys mirror the camelCase `sync:status`
/// convention): wall-clock cycle time plus what the tick moved.
fn emit_telemetry(
    app: &AppHandle,
    cycle_ms: u128,
    pushed: u64,
    pulled: u64,
    pending_icloud: u64,
) {
    let _ = app.emit(
        "sync:telemetry",
        serde_json::json!({
            "cycleMs": cycle_ms,
            "pushed": pushed,
            "pulled": pulled,
            "pendingIcloud": pending_icloud,
        }),
    );
}

/// Fail-closed server URLs only (mirrors the JS account store gate).
fn resolve_server_url(input: Option<String>) -> Result<String, AppError> {
    let raw = input
        .unwrap_or_default()
        .trim()
        .trim_end_matches('/')
        .to_string();
    if raw.is_empty() {
        return Ok(DEFAULT_API_URL.to_string());
    }
    if raw.starts_with("http://") || raw.starts_with("https://") {
        Ok(raw)
    } else {
        Err(AppError::Other("sync: refusing non-http(s) server URL".into()))
    }
}

fn is_locked(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    current_app_key(state.inner()).ok().flatten().is_none()
}

fn sched_lock() -> Result<std::sync::MutexGuard<'static, SchedState>, AppError> {
    sched().lock().map_err(|e| AppError::Other(e.to_string()))
}

fn is_running() -> bool {
    sched().lock().map(|s| s.running).unwrap_or(false)
}

fn note_backoff() {
    if let Ok(mut s) = sched().lock() {
        s.retry.record_failure();
        let delay = s.retry.current_delay_ms();
        s.backoff_until = Some(Instant::now() + Duration::from_millis(delay));
    }
}

fn note_success() {
    if let Ok(mut s) = sched().lock() {
        s.retry.record_success();
        s.backoff_until = None;
    }
}

fn note_pushed() {
    if let Ok(mut s) = sched().lock() {
        s.last_push_at = Some(Instant::now());
    }
}

fn note_auth_blocked() {
    if let Ok(mut s) = sched().lock() {
        s.no_push_auth = true;
    }
}

/// Budget gate for pushes: parked on 429 backoff or 401 stop-push.
fn push_allowed() -> bool {
    sched()
        .lock()
        .map(|s| {
            !s.no_push_auth
                && s.backoff_until.map(|until| Instant::now() >= until).unwrap_or(true)
        })
        .unwrap_or(true)
}

fn push_due(force: bool) -> bool {
    if force || push_allowed() {
        return force
            || sched().lock().map(|s| {
                s.last_push_at.map(|at| at.elapsed() >= PUSH_MIN_INTERVAL).unwrap_or(true)
            }).unwrap_or(true);
    }
    false
}

/// Seed only when this device has local notes and no seed has taken effect
/// this session.
fn should_seed(has_notes: bool) -> bool {
    has_notes && !SEED_ATTEMPTED.load(Ordering::Relaxed)
}

/// Bootstrap until snapshots have actually been applied. An empty probe (no
/// docs yet) must not close the guard, else a workspace seeded later in the
/// session would never be picked up.
fn should_bootstrap(has_checkpoints: bool) -> bool {
    !has_checkpoints && !BOOTSTRAP_ATTEMPTED.load(Ordering::Relaxed)
}

/// A bootstrap probe may stop repeating only once it applied something; after
/// that checkpoints exist and the guard is redundant anyway.
fn bootstrap_applied_anything(applied: usize) -> bool {
    applied > 0
}

/// Cheap DB read feeding `should_seed`/`should_bootstrap`; `None` (pool or
/// local state unavailable) skips both. Failures are logged, never silently
/// dropped.
fn local_cloud_state(app: &AppHandle) -> Option<(bool, bool)> {
    let state = app.state::<AppState>();
    let pool = match data_pool(app, state.inner()) {
        Ok(pool) => pool,
        Err(e) => {
            crate::rs_log!("[sync] seed/bootstrap probe: data pool unavailable: {e}");
            return None;
        }
    };
    match local_cloud_flags(&pool) {
        Ok(flags) => Some(flags),
        Err(e) => {
            crate::rs_log!("[sync] seed/bootstrap probe: local state read failed: {e}");
            None
        }
    }
}

/// Fold a cloud failure into the tick exactly like the pull/push arms:
/// Throttled → backoff + status, Unauthorized → stop-push + status, Fatal →
/// emit + abort. Only Fatal returns `Err`.
fn absorb_cloud_fail(
    app: &AppHandle,
    fail: CloudFail,
    status: &mut &'static str,
) -> Result<(), AppError> {
    match fail {
        CloudFail::Typed(t) => {
            if matches!(t, SyncError::Throttled) {
                note_backoff();
            }
            *status = t.status_str();
            Ok(())
        }
        CloudFail::Unauthorized => {
            note_auth_blocked();
            *status = "authorization-failed";
            Ok(())
        }
        CloudFail::Fatal(e) => {
            emit_error(app, &e.to_string());
            Err(e)
        }
    }
}

async fn run_tick(app: &AppHandle, force: bool) -> Result<SyncStatus, AppError> {
    let start = Instant::now();
    let out = run_tick_inner(app, force).await;
    if let Ok(s) = &out {
        emit_telemetry(
            app,
            start.elapsed().as_millis(),
            s.pushed,
            s.pulled,
            s.pending_icloud,
        );
    }
    out
}

async fn run_tick_inner(app: &AppHandle, force: bool) -> Result<SyncStatus, AppError> {
    emit_status(app, "syncing");
    let cfg = sched().lock().map(|s| s.config.clone()).unwrap_or(None);
    let Some(cfg) = cfg else {
        emit_status(app, "idle");
        return Ok(SyncStatus::with_status("idle"));
    };
    // Gate: locked session → typed status, no push.
    if is_locked(app) {
        emit_status(app, SyncError::Locked.status_str());
        return Ok(SyncStatus::with_status(SyncError::Locked.status_str()));
    }

    let mut pushed = 0u64;
    let mut pulled = 0u64;
    let mut pending_icloud = 0u64;
    let mut applied: Vec<String> = Vec::new();
    let mut status = "complete";

    // Local folder first (Task 2 driver, reused as a command).
    if let Some(folder) = cfg.folder_id.clone() {
        match super::sync_local_cycle(app.clone(), folder.clone()).await {
            Ok(stats) => {
                pushed += stats.pushed;
                pulled += stats.pulled;
                pending_icloud += stats.pending_icloud;
                applied.extend(stats.pulled_notes);
            }
            Err(AppError::EncryptionLocked) => {
                crate::rs_log!(
                    "[sync] local cycle locked: no app key loaded (transport={:?}, folder={})",
                    cfg.transport,
                    folder
                );
                emit_status(app, SyncError::Locked.status_str());
                return Ok(SyncStatus::with_status(SyncError::Locked.status_str()));
            }
            Err(e) => {
                crate::rs_log!("[sync] local cycle failed: {e}; continuing with cloud");
            }
        }
    }

    if cloud_enabled(cfg.transport.as_deref())
        && !cfg.workspace_id.trim().is_empty()
        && !cfg.token.is_empty()
    {
        let (has_notes, has_checkpoints) = local_cloud_state(app).unwrap_or_else(|| {
            crate::rs_log!("[sync] seed/bootstrap guards defaulted (no local cloud state)");
            (false, false)
        });

        // Seed an empty cloud workspace from this device. `seed_cloud_workspace`
        // re-probes server state and no-ops when the workspace already exists or
        // another device won initialization.
        if should_seed(has_notes) {
            emit_progress(app, "seed", 0, 0);
            match seed_cloud_workspace(app, &cfg.workspace_id, &cfg.server_url, &cfg.token).await {
                Ok(true) => {
                    SEED_ATTEMPTED.store(true, Ordering::Relaxed);
                    // Origin device already holds every snapshot.
                    BOOTSTRAP_ATTEMPTED.store(true, Ordering::Relaxed);
                    crate::rs_log!("[sync] cloud workspace seeded from this device");
                }
                Ok(false) => {
                    // Not (yet) seedable: a new workspace can 404 before it
                    // reports `empty`. Leave the guard clear so a later tick
                    // retries; the re-probe claims/publishes nothing once
                    // initialized.
                    crate::rs_log!("[sync] cloud seed skipped: workspace not seedable yet");
                }
                Err(fail) => absorb_cloud_fail(app, fail, &mut status)?,
            }
        }

        // Fresh device: pull the server's seeded snapshots before the regular
        // incremental pull. The DB probe keeps this off the steady-state path;
        // the attempt flag stops re-probing when the server has nothing yet.
        if should_bootstrap(has_checkpoints) && status == "complete" {
            emit_progress(app, "bootstrap", 0, 0);
            match bootstrap_from_snapshots(app, &cfg.workspace_id, &cfg.server_url, &cfg.token)
                .await
            {
                Ok(ids) => {
                    if bootstrap_applied_anything(ids.len()) {
                        BOOTSTRAP_ATTEMPTED.store(true, Ordering::Relaxed);
                        crate::rs_log!("[sync] bootstrap applied {} snapshots", ids.len());
                        pulled += ids.len() as u64;
                        // Surface them to the renderer like any applied note.
                        applied.extend(ids.iter().cloned());
                        let n = ids.len() as u64;
                        emit_progress(app, "bootstrap", n, n);
                    }
                    // Empty result: leave the guard clear so the cheap probe
                    // re-runs next tick if the server gets seeded meanwhile.
                }
                Err(fail) => absorb_cloud_fail(app, fail, &mut status)?,
            }
        }

        emit_progress(app, "pull", 0, 0);
        match sync_cloud_pull(app, &cfg.workspace_id, &cfg.server_url, &cfg.token).await {
            Ok(out) => {
                pulled += out.pulled;
                applied.extend(out.applied);
                emit_progress(app, "pull", out.pulled, out.pulled);
            }
            Err(CloudFail::Typed(t)) => {
                if matches!(t, SyncError::Throttled) {
                    note_backoff();
                }
                status = t.status_str();
            }
            Err(CloudFail::Unauthorized) => {
                note_auth_blocked();
                status = "authorization-failed";
            }
            Err(CloudFail::Fatal(e)) => {
                emit_error(app, &e.to_string());
                return Err(e);
            }
        }
        // Push rides the same gate: a failed pull (locked/decrypt/offline)
        // never pushes, matching the JS engine's abort-on-pull-error.
        if status == "complete" && push_due(force) {
            match sync_cloud_push(app, &cfg.workspace_id, &cfg.server_url, &cfg.token).await {
                Ok(out) => {
                    note_pushed();
                    pushed += out.pushed;
                    if out.has_pushed() {
                        emit_pushed(app, &out.note_ids);
                    }
                    if out.unauthorized {
                        note_auth_blocked();
                        status = "authorization-failed";
                    }
                }
                Err(CloudFail::Typed(t)) => {
                    if matches!(t, SyncError::Throttled) {
                        note_backoff();
                    }
                    status = t.status_str();
                }
                Err(CloudFail::Unauthorized) => {
                    note_auth_blocked();
                    status = "authorization-failed";
                }
                Err(CloudFail::Fatal(e)) => {
                    emit_error(app, &e.to_string());
                    return Err(e);
                }
            }
        }

        // NOTE(Phase B): version-history commit recording (`POST /commits`,
        // `cloud.js:1574-1611`) is intentionally not ported. It requires
        // `captureNoteSnapshot` → Tiptap `generateHTML` +
        // `yXmlFragmentToProsemirrorJSON` (`commit-snapshot.js`), which have no
        // Rust equivalent. Commit recording and history restore stay JS-side
        // until Phase B deletes the JS engine.

        // Assets last, only on a fully successful cycle. Failure maps exactly
        // like the pull/push arms above.
        if status == "complete" {
            emit_progress(app, "assets", 0, 0);
            match sync_cloud_assets(app, &cfg.workspace_id, &cfg.server_url, &cfg.token).await {
                Ok(transferred) => {
                    crate::rs_log!("[sync] cloud assets synced: {transferred}");
                    emit_progress(app, "assets", transferred, transferred);
                }
                Err(fail) => absorb_cloud_fail(app, fail, &mut status)?,
            }
        }
    }

    if status == "complete" && pending_icloud > 0 {
        status = SyncError::ICloudPending.status_str();
    }
    if !applied.is_empty() {
        emit_applied(app, &applied);
    }
    if status == "complete" {
        note_success();
    }
    emit_status(app, status);
    Ok(SyncStatus {
        status: status.to_string(),
        pushed,
        pulled,
        pending_icloud,
        note_ids: applied,
    })
}

/// Immediate-on-dirty push: cloud goes through the budget gate; folder-only
/// transport lands commit files via a local cycle instead (no cloud to push
/// to). Failures stay silent here — the next tick surfaces persistent
/// problems.
async fn run_dirty_push(app: &AppHandle) {
    let cfg = sched().lock().map(|s| s.config.clone()).unwrap_or(None);
    let Some(cfg) = cfg else { return };
    if !cloud_enabled(cfg.transport.as_deref()) {
        // ponytail: full local cycle, not push-only — the dir listing is the
        // pull, and cursors make the no-op case cheap. This is what makes
        // folder sync realtime; the peer's folder watcher picks up the files.
        let Some(folder) = cfg.folder_id.filter(|f| !f.trim().is_empty()) else {
            return;
        };
        if is_locked(app) {
            return;
        }
        match super::sync_local_cycle(app.clone(), folder).await {
            Ok(stats) if !stats.pulled_notes.is_empty() => {
                emit_applied(app, &stats.pulled_notes)
            }
            Ok(_) | Err(_) => {}
        }
        return;
    }
    if cfg.workspace_id.trim().is_empty() || cfg.token.is_empty() {
        return;
    }
    if is_locked(app) || !push_allowed() {
        return;
    }
    match sync_cloud_push(app, &cfg.workspace_id, &cfg.server_url, &cfg.token).await {
        Ok(out) => {
            note_pushed();
            note_success();
            if out.has_pushed() {
                emit_pushed(app, &out.note_ids);
            }
            if out.unauthorized {
                note_auth_blocked();
            }
        }
        Err(CloudFail::Typed(SyncError::Throttled)) => note_backoff(),
        Err(CloudFail::Unauthorized) => note_auth_blocked(),
        Err(_) => {}
    }
}

/// Swallow coalesced kicks; a shutdown poisons the drain and stops the loop.
fn drain_shutdown(rx: &mut tokio::sync::mpsc::UnboundedReceiver<KickKind>) -> bool {
    let mut shutdown = false;
    while let Ok(msg) = rx.try_recv() {
        if matches!(msg, KickKind::Shutdown) {
            shutdown = true;
        }
    }
    shutdown
}

fn spawn_loop(app: AppHandle, mut rx: tokio::sync::mpsc::UnboundedReceiver<KickKind>) {
    tauri::async_runtime::spawn(async move {
        run_tick(&app, false).await.ok();
        let mut interval = tokio::time::interval(TICK_INTERVAL);
        // The tick above covers startup; consume the immediate interval
        // firing so the cadence starts a full 30s out.
        interval.tick().await;
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    if !is_running() {
                        break;
                    }
                    run_tick(&app, false).await.ok();
                }
                msg = rx.recv() => {
                    match msg {
                        None | Some(KickKind::Shutdown) => break,
                        Some(KickKind::Kick) => {
                            tokio::time::sleep(KICK_DEBOUNCE).await;
                            if drain_shutdown(&mut rx) || !is_running() {
                                break;
                            }
                            run_tick(&app, true).await.ok();
                        }
                        Some(KickKind::Dirty) => {
                            tokio::time::sleep(DIRTY_COALESCE).await;
                            if drain_shutdown(&mut rx) || !is_running() {
                                break;
                            }
                            run_dirty_push(&app).await;
                        }
                    }
                }
            }
        }
        if let Ok(mut s) = sched().lock() {
            s.running = false;
            s.tx = None;
        }
    });
}

/// Store the latest JS-owned config (clearing the 401 stop-push and backoff
/// when the identity inputs change) and return the loop sender, spawning the
/// loop on first use.
fn ensure_loop(
    app: &AppHandle,
    workspace_id: String,
    server_url: Option<String>,
    token: String,
    folder_id: Option<String>,
    transport: Option<String>,
) -> Result<tokio::sync::mpsc::UnboundedSender<KickKind>, AppError> {
    let cfg = StoredConfig {
        workspace_id,
        server_url: resolve_server_url(server_url)?,
        token,
        folder_id: folder_id.filter(|s| !s.trim().is_empty()),
        transport: transport.filter(|s| !s.trim().is_empty()),
    };
    let mut state = sched_lock()?;
    let identity_changed = state.config.as_ref().map(|c| {
        c.workspace_id != cfg.workspace_id
            || c.server_url != cfg.server_url
            || c.token != cfg.token
    }).unwrap_or(true);
    if identity_changed {
        state.no_push_auth = false;
        state.backoff_until = None;
        // New workspace/account: allow seed/bootstrap to probe once again.
        SEED_ATTEMPTED.store(false, Ordering::Relaxed);
        BOOTSTRAP_ATTEMPTED.store(false, Ordering::Relaxed);
    }
    state.config = Some(cfg);
    let folder = state.config.as_ref().and_then(|c| c.folder_id.clone());
    if let Some(tx) = state.tx.clone() {
        refresh_folder_watcher(&tx, folder.as_deref());
        return Ok(tx);
    }
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    state.tx = Some(tx.clone());
    state.running = true;
    spawn_loop(app.clone(), rx);
    refresh_folder_watcher(&tx, folder.as_deref());
    Ok(tx)
}

/// One full sync cycle: local folder (Task 2) + cloud pull/push, emitting
/// `sync:status` and `sync:applied { noteIds }`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn sync_tick(app: AppHandle) -> Result<SyncStatus, AppError> {
    run_tick(&app, false).await
}

/// Start (or reconfigure) the background scheduler: immediate tick, then a
/// 30s interval plus debounced kick channels.
#[tauri::command]
#[specta::specta]
pub(crate) async fn sync_start(
    app: AppHandle,
    workspace_id: String,
    server_url: Option<String>,
    token: String,
    folder_id: Option<String>,
    transport: Option<String>,
) -> Result<SyncStatusPayload, AppError> {
    ensure_loop(&app, workspace_id, server_url, token, folder_id, transport)?;
    Ok(SyncStatusPayload {
        status: "started".to_string(),
    })
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn sync_stop() -> Result<(), AppError> {
    let tx = sched().lock().map(|s| s.tx.clone()).unwrap_or(None);
    if let Ok(mut s) = sched().lock() {
        s.running = false;
    }
    SEED_ATTEMPTED.store(false, Ordering::Relaxed);
    BOOTSTRAP_ATTEMPTED.store(false, Ordering::Relaxed);
    drop_folder_watcher();
    if let Some(tx) = tx {
        let _ = tx.send(KickKind::Shutdown);
    }
    Ok(())
}

/// WS-notify path: coalesced (500ms) full tick, force-pushing past the idle
/// throttle floor.
#[tauri::command]
#[specta::specta]
pub(crate) async fn sync_kick(
    app: AppHandle,
    workspace_id: String,
    server_url: Option<String>,
    token: String,
    folder_id: Option<String>,
    transport: Option<String>,
) -> Result<(), AppError> {
    let tx = ensure_loop(&app, workspace_id, server_url, token, folder_id, transport)?;
    let _ = tx.send(KickKind::Kick);
    Ok(())
}

/// Immediate-on-dirty cloud push without waiting for the tick: coalesced
/// ~1500ms and budget-gated (locked/offline/backoff/401 → skipped).
#[tauri::command]
#[specta::specta]
pub(crate) async fn sync_kick_dirty(
    app: AppHandle,
    workspace_id: String,
    server_url: Option<String>,
    token: String,
    folder_id: Option<String>,
    transport: Option<String>,
) -> Result<(), AppError> {
    let tx = ensure_loop(&app, workspace_id, server_url, token, folder_id, transport)?;
    let _ = tx.send(KickKind::Dirty);
    Ok(())
}

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncStatusPayload {
    pub(crate) status: String,
}

#[cfg(test)]
mod tests {
    use super::cloud_enabled;

    #[test]
    fn cloud_enabled_only_skips_explicit_folder() {
        assert!(!cloud_enabled(Some("folder")));
        assert!(cloud_enabled(Some("cloud")));
        assert!(cloud_enabled(None));
    }

    #[test]
    fn backoff_grows_then_resets() {
        let mut b = super::RetryBudget::new();
        assert!(b.delay_ms(1) < b.delay_ms(4));
        b.record_success();
        assert_eq!(b.delay_ms(1), 1_000); // reset to floor
    }

    #[test]
    fn seed_and_bootstrap_guards() {
        super::SEED_ATTEMPTED.store(false, super::Ordering::Relaxed);
        super::BOOTSTRAP_ATTEMPTED.store(false, super::Ordering::Relaxed);
        assert!(super::should_seed(true));
        assert!(!super::should_seed(false));
        assert!(super::should_bootstrap(false));
        assert!(!super::should_bootstrap(true));

        super::SEED_ATTEMPTED.store(true, super::Ordering::Relaxed);
        super::BOOTSTRAP_ATTEMPTED.store(true, super::Ordering::Relaxed);
        assert!(!super::should_seed(true));
        assert!(!super::should_bootstrap(false));
    }

    #[test]
    fn bootstrap_probe_stays_open_until_snapshots_apply() {
        assert!(!super::bootstrap_applied_anything(0));
        assert!(super::bootstrap_applied_anything(3));
    }
}
