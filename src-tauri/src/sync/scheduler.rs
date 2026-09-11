use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::cloud::{
    CloudFail, SyncError, SyncStatus, DEFAULT_API_URL, sync_cloud_pull, sync_cloud_push,
};
use crate::shared::{AppError, AppState, current_app_key};

/// Full-cycle cadence (mirrors the JS engine 30s pull timer).
const TICK_INTERVAL: Duration = Duration::from_secs(30);
/// WS-notify kicks coalesce here before a tick runs.
const KICK_DEBOUNCE: Duration = Duration::from_millis(500);
/// Dirty pushes coalesce here so a keystroke burst becomes one request.
const DIRTY_COALESCE: Duration = Duration::from_millis(1500);
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

fn emit_status(app: &AppHandle, status: &str) {
    let _ = app.emit("sync:status", serde_json::json!({ "status": status }));
}

fn emit_applied(app: &AppHandle, note_ids: &[String]) {
    let _ = app.emit("sync:applied", serde_json::json!({ "noteIds": note_ids }));
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
        if folder.starts_with("scoped:") {
            // Scoped-storage folders sync via the JS prefetch path; the Rust
            // driver only takes filesystem paths (see `local.rs`).
            crate::rs_log!("[sync] skipping scoped-storage folder in rust tick");
        } else {
            match super::sync_local_cycle(app.clone(), folder).await {
                Ok(stats) => {
                    pushed += stats.pushed;
                    pulled += stats.pulled;
                    pending_icloud += stats.pending_icloud;
                }
                Err(AppError::EncryptionLocked) => {
                    emit_status(app, SyncError::Locked.status_str());
                    return Ok(SyncStatus::with_status(SyncError::Locked.status_str()));
                }
                Err(e) => {
                    crate::rs_log!("[sync] local cycle failed, continuing with cloud");
                    let _ = e;
                }
            }
        }
    }

    if !cfg.workspace_id.trim().is_empty() && !cfg.token.is_empty() {
        match sync_cloud_pull(app, &cfg.workspace_id, &cfg.server_url, &cfg.token).await {
            Ok(out) => {
                pulled += out.pulled;
                applied = out.applied;
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

/// Immediate-on-dirty cloud push: budget-gated, no pull, no UI churn on
/// failure (the next tick surfaces persistent problems).
async fn run_dirty_push(app: &AppHandle) {
    let cfg = sched().lock().map(|s| s.config.clone()).unwrap_or(None);
    let Some(cfg) = cfg else { return };
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
) -> Result<tokio::sync::mpsc::UnboundedSender<KickKind>, AppError> {
    let cfg = StoredConfig {
        workspace_id,
        server_url: resolve_server_url(server_url)?,
        token,
        folder_id: folder_id.filter(|s| !s.trim().is_empty()),
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
    }
    state.config = Some(cfg);
    if let Some(tx) = state.tx.clone() {
        return Ok(tx);
    }
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    state.tx = Some(tx.clone());
    state.running = true;
    spawn_loop(app.clone(), rx);
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
) -> Result<SyncStatusPayload, AppError> {
    ensure_loop(&app, workspace_id, server_url, token, folder_id)?;
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
) -> Result<(), AppError> {
    let tx = ensure_loop(&app, workspace_id, server_url, token, folder_id)?;
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
) -> Result<(), AppError> {
    let tx = ensure_loop(&app, workspace_id, server_url, token, folder_id)?;
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
    #[test]
    fn backoff_grows_then_resets() {
        let mut b = super::RetryBudget::new();
        assert!(b.delay_ms(1) < b.delay_ms(4));
        b.record_success();
        assert_eq!(b.delay_ms(1), 1_000); // reset to floor
    }
}
