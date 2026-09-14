use std::collections::{HashMap, HashSet};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::local::{get_or_create_device_id, parse_commit_filename};
use super::merge::{covered_by_vector, load_vector, refresh_vector};
use crate::db::{self, DbPool};
use crate::shared::{
    SyncEnvelope, PROTOCOL_VERSION, SYNC_PAYLOAD_VERSION, aead_decrypt_bytes, aead_decrypt_json,
    aead_encrypt_bytes, current_app_key, data_pool, decrypt_yjs_blob, AppError, AppState,
};

/// Server caps mirrored from the JS cloud path (`remote-yjs.js`):
/// `/yjs/push-batch` rejects more than 50 items or ~5MB per request.
pub(crate) const MAX_BATCH_ITEMS: usize = 50;
pub(crate) const MAX_BATCH_BODY_BYTES: usize = 5 * 1024 * 1024;
/// Per-note pull page size, mirroring JS `pullUpdates` (`limit = 500`).
const PULL_LIMIT: i64 = 500;
const PULL_MAX_PAGES: usize = 20;
const PUSH_TIMEOUT_SECS: u64 = 60;
/// Mirrors JS `DEFAULT_API_URL` (`lib/api/client.js`); the JS account store
/// passes its own `serverUrl`, this is only the fallback.
pub(crate) const DEFAULT_API_URL: &str = "https://api.beavernotes.com";
/// Informational device label header; the `X-Device-Id` identity header below
/// carries the same kv-persisted id Task 2 writes into `~~` filenames.
const DEVICE_LABEL: &str = "Beaver Notes (Rust)";
/// `Meta` doc id, applied before note updates like the JS pull path.
pub(crate) const META_DOC_ID: &str = "meta";

/// Typed sync failure. Gates surface these as `sync:status` strings
/// (see `status_str`); only unexpected failures become `AppError`.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SyncError {
    Locked,
    DecryptFailed,
    Offline,
    ICloudPending,
    Throttled,
}

impl SyncError {
    pub(crate) fn status_str(&self) -> &'static str {
        match self {
            SyncError::Locked => "unlock-required",
            SyncError::DecryptFailed => "decrypt-failed",
            SyncError::Offline => "offline",
            SyncError::ICloudPending => "pending-icloud",
            SyncError::Throttled => "throttled",
        }
    }
}

impl std::fmt::Display for SyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.status_str())
    }
}

impl From<SyncError> for AppError {
    fn from(e: SyncError) -> Self {
        AppError::Other(format!("sync: {}", e.status_str()))
    }
}

/// Cloud cycle failure: typed gates, auth signal (stop pushing until the
/// identity inputs change), or an unexpected fatal error.
pub(crate) enum CloudFail {
    Typed(SyncError),
    Unauthorized,
    Fatal(AppError),
}

impl From<AppError> for CloudFail {
    fn from(e: AppError) -> Self {
        CloudFail::Fatal(e)
    }
}

/// Status payload returned by `sync_tick` and emitted as `sync:status`.
/// Field shapes mirror the JS engine emits (`engine.js`).
#[derive(Clone, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncStatus {
    pub(crate) status: String,
    pub(crate) pushed: u64,
    pub(crate) pulled: u64,
    pub(crate) pending_icloud: u64,
    pub(crate) note_ids: Vec<String>,
}

impl SyncStatus {
    pub(crate) fn with_status(status: &str) -> Self {
        Self {
            status: status.to_string(),
            ..Default::default()
        }
    }
}

pub(crate) struct PullOutcome {
    pub(crate) pulled: u64,
    pub(crate) applied: Vec<String>,
}

pub(crate) struct PushOutcome {
    pub(crate) pushed: u64,
    pub(crate) unauthorized: bool,
    /// Note ids from the chunks the server accepted, in first-seen order and
    /// deduplicated. Empty when nothing was sent.
    pub(crate) note_ids: Vec<String>,
}

impl PushOutcome {
    /// Whether a `sync:pushed` event should fire: at least one update pushed
    /// and a concrete note id to report.
    pub(crate) fn has_pushed(&self) -> bool {
        self.pushed > 0 && !self.note_ids.is_empty()
    }
}

/// Split `count` items of `bytes` total estimated bytes into per-request
/// chunk sizes honouring the 50-item / 5MB server caps. Items distribute
/// evenly; the push path slices its item list by these sizes.
pub(crate) fn chunk_notes(count: usize, bytes: usize) -> Vec<usize> {
    if count == 0 {
        return Vec::new();
    }
    let chunks = count
        .div_ceil(MAX_BATCH_ITEMS)
        .max(bytes.div_ceil(MAX_BATCH_BODY_BYTES))
        .max(1);
    let base = count / chunks;
    let rem = count % chunks;
    (0..chunks).map(|i| base + usize::from(i < rem)).collect()
}

/// Dirty rows plus the per-note high-water marks advanced on ack.
type DirtyBatch = (Vec<PushItem>, HashMap<String, (i64, u64)>);

fn ckpt_key(note_id: &str) -> String {
    format!("sync:cloud:ckpt:{note_id}")
}

fn pushed_key(note_id: &str) -> String {
    format!("sync:cloud:pushed:{note_id}")
}

fn wseq_key(note_id: &str) -> String {
    format!("sync:cloud:wseq:{note_id}")
}

/// Local-state probe for the scheduler's cloud seed/bootstrap decision.
/// Returns `(has_notes, has_checkpoints)`:
/// - `has_notes`: at least one non-meta `note_content` row exists locally
///   (something this device could seed the cloud with).
/// - `has_checkpoints`: this device stored a server pull checkpoint, i.e. it
///   has already pulled this workspace and does not need snapshot bootstrap.
pub(crate) fn local_cloud_flags(pool: &DbPool) -> Result<(bool, bool), AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let notes: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM note_content WHERE note_id != ?1",
            rusqlite::params![META_DOC_ID],
            |row| row.get(0),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
    let checkpoints: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM kv WHERE key LIKE 'sync:cloud:ckpt:%'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok((notes > 0, checkpoints > 0))
}

/// JS `PUSH_VALID_NOTE_ID_RE` (`/^[a-zA-Z0-9_-]{1,256}$/`): skip anything
/// else rather than have the server reject the whole batch.
pub(crate) fn valid_note_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 256
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// JS `estimateNoteSize` (`remote-yjs.js`): noteId + per-update
/// key/base64-data/metadata overhead. Only needs to be close enough to keep
/// chunks under the 5MB cap.
fn estimate_item_size(note_id: &str, key: &str, data_b64: &str) -> usize {
    note_id.len() + 64 + key.len() + data_b64.len() + 64
}

fn http_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .use_rustls_tls()
        .timeout(std::time::Duration::from_secs(PUSH_TIMEOUT_SECS))
        .build()
        .map_err(|e| AppError::Other(format!("sync: http client: {e}")))
}

fn device_id_header() -> reqwest::header::HeaderName {
    reqwest::header::HeaderName::from_static("x-device-id")
}

fn device_label_header() -> reqwest::header::HeaderName {
    reqwest::header::HeaderName::from_static("x-device-label")
}

#[derive(Deserialize)]
struct PushResp {
    #[serde(default)]
    accepted: i64,
    #[serde(default)]
    duplicate: i64,
    checkpoints: Option<HashMap<String, serde_json::Value>>,
    checkpoint: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct SyncStateResp {
    status: String,
    documents: Option<Vec<StateDoc>>,
}

#[derive(Deserialize)]
struct StateDoc {
    #[serde(rename = "noteId")]
    note_id: Option<String>,
}

#[derive(Deserialize)]
struct PullResp {
    notes: Option<HashMap<String, PullPage>>,
}

#[derive(Deserialize, Clone)]
struct PullPage {
    updates: Option<Vec<RemoteUpdate>>,
    #[serde(rename = "hasMore", default)]
    has_more: bool,
    #[serde(rename = "nextCheckpoint", default)]
    next_checkpoint: serde_json::Value,
    #[serde(default)]
    stale: bool,
}

#[derive(Deserialize, Clone)]
struct RemoteUpdate {
    key: String,
    data: String,
}

struct PushItem {
    note_id: String,
    key: String,
    data: String,
    device: String,
    ts: u64,
    seq: u64,
    size: usize,
}

fn is_offline(err: &reqwest::Error) -> bool {
    err.is_connect() || err.is_timeout()
}

fn status_snapshot(status: reqwest::StatusCode) -> String {
    format!("sync: cloud request failed with status {status}")
}

/// Fail-closed envelope decrypt mirroring Task 2 (`local.rs`) and the JS
/// `decryptJSON` gate: only v4/v5 envelopes with an AAD of `{note}-{ts}`.
/// Returns `(note_id, device, sequence, update_bytes)` after strict
/// filename-vs-payload identity checks (mirrors the JS pull validation).
fn decrypt_remote_update(
    key: &[u8; 32],
    raw: &[u8],
    file_note: &str,
    file_device: &str,
    ts: u64,
    file_seq: u64,
) -> Option<(String, String, u64, Vec<u8>)> {
    let env: serde_json::Value = serde_json::from_slice(raw).ok()?;
    let v = env.get("v")?.as_u64()? as u8;
    let aad = format!("{file_note}-{ts}");
    let (note, device, meta_ts, meta_seq, update) = if v == SYNC_PAYLOAD_VERSION {
        let update =
            aead_decrypt_bytes(key, env.get("iv")?.as_str()?, env.get("enc")?.as_str()?, &aad)
                .ok()?;
        let meta = env.get("meta")?;
        (
            meta.get("noteId")
                .and_then(|n| n.as_str())
                .filter(|n| !n.is_empty())
                .unwrap_or(file_note)
                .to_string(),
            meta.get("device")?.as_str()?.to_string(),
            meta.get("ts")?.as_i64()?,
            meta.get("sequence").and_then(|s| s.as_i64()),
            update,
        )
    } else if v == PROTOCOL_VERSION {
        let legacy = SyncEnvelope {
            v,
            iv: env.get("iv")?.as_str()?.to_string(),
            enc: env.get("enc")?.as_str()?.to_string(),
        };
        let value = aead_decrypt_json(key, &legacy, &aad).ok()?;
        let bytes: Vec<u8> = value
            .get("update")?
            .as_array()?
            .iter()
            .filter_map(|n| n.as_u64().map(|u| u as u8))
            .collect();
        (
            value
                .get("noteId")
                .and_then(|n| n.as_str())
                .filter(|n| !n.is_empty())
                .unwrap_or(file_note)
                .to_string(),
            value.get("device")?.as_str()?.to_string(),
            value.get("ts")?.as_i64()?,
            value.get("sequence").and_then(|s| s.as_i64()),
            bytes,
        )
    } else {
        return None;
    };
    if note != file_note || device != file_device {
        return None;
    }
    if meta_ts < 0 || meta_ts as u64 != ts {
        return None;
    }
    let seq = match meta_seq {
        Some(s) if s >= 0 => s as u64,
        Some(_) => return None,
        None => file_seq,
    };
    Some((note, device, seq, update))
}

fn collect_dirty(
    pool: &DbPool,
    key: &[u8; 32],
    device: &str,
    now_ms: u64,
) -> Result<DirtyBatch, AppError> {
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
    let mut items = Vec::new();
    // Highest row id seen per note (even for skipped rows): on ack the cursor
    // advances past them, so deterministic skips never block the queue.
    let mut attempted: HashMap<String, (i64, u64)> = HashMap::new();
    for note in notes {
        if !valid_note_id(&note) {
            continue;
        }
        let since: i64 = db::db_get(pool, &pushed_key(&note), None)?
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let rows: Vec<(i64, Vec<u8>)> = {
            let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
            let mut stmt = conn
                .prepare(
                    "SELECT id, data FROM note_content WHERE note_id = ?1 AND id > ?2 ORDER BY id ASC",
                )
                .map_err(|e| AppError::Other(e.to_string()))?;
            let mapped = stmt
                .query_map(rusqlite::params![note, since], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .map_err(|e| AppError::Other(e.to_string()))?;
            let rows: Result<Vec<(i64, Vec<u8>)>, _> = mapped.collect();
            rows.map_err(|e| AppError::Other(e.to_string()))?
        };
        if rows.is_empty() {
            continue;
        }
        let wseq: u64 = db::db_get(pool, &wseq_key(&note), None)?
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        // Highest sequence that will exist after this push; persisted on ack
        // so replays reuse the same (device, sequence) idempotency keys.
        attempted.insert(note.clone(), (rows.last().map(|r| r.0).unwrap_or(since), wseq.wrapping_add(rows.len() as u64)));
        for (idx, (_, stored)) in rows.iter().enumerate() {
            let update = match decrypt_yjs_blob(key, stored) {
                Ok(u) => u,
                Err(e) => {
                    crate::rs_log!("[sync::cloud] skipping undecryptable row: {e}");
                    continue;
                }
            };
            if update.is_empty() {
                continue;
            }
            let seq = wseq.wrapping_add(idx as u64 + 1);
            let aad = format!("{note}-{now_ms}");
            let (iv, enc) = aead_encrypt_bytes(key, &update, &aad)?;
            let envelope = serde_json::json!({
                "v": SYNC_PAYLOAD_VERSION,
                "meta": { "device": device, "ts": now_ms as i64, "sequence": seq as i64, "noteId": note },
                "iv": iv,
                "enc": enc,
            });
            let data = BASE64.encode(serde_json::to_string(&envelope)?.as_bytes());
            let file_key = format!("{note}~~{device}~~{now_ms}~~{seq}.yjs.json");
            let size = estimate_item_size(&note, &file_key, &data);
            items.push(PushItem {
                note_id: note.clone(),
                key: file_key,
                data,
                device: device.to_string(),
                ts: now_ms,
                seq,
                size,
            });
        }
    }
    Ok((items, attempted))
}

struct PushReport {
    pushed: u64,
    acked: HashSet<String>,
    unauthorized: bool,
    note_ids: Vec<String>,
}

/// Append chunk note ids in first-seen order, deduplicated across chunks
/// (one note's updates can span multiple batches).
fn record_pushed_ids(note_ids: &mut Vec<String>, order: &[String]) {
    for note in order {
        if !note_ids.contains(note) {
            note_ids.push(note.clone());
        }
    }
}

/// Note ids to report for a chunk: the server's per-note acks (intersected
/// with what was sent) when it returned any, else the whole chunk.
fn accepted_chunk_ids(order: &[String], acked: &HashSet<String>) -> Vec<String> {
    if acked.is_empty() {
        // ponytail: no per-note ack, so which notes the server accepted is
        // unknown; report the whole chunk (superset). Upgrade to exact ids if
        // the server ever omits checkpoints while accepting only some of a batch.
        order.to_vec()
    } else {
        order
            .iter()
            .filter(|note| acked.contains(*note))
            .cloned()
            .collect()
    }
}

async fn push_items(
    client: &reqwest::Client,
    base: &str,
    workspace_id: &str,
    token: &str,
    device: &str,
    items: &[PushItem],
) -> Result<PushReport, CloudFail> {
    let mut report = PushReport {
        pushed: 0,
        acked: HashSet::new(),
        unauthorized: false,
        note_ids: Vec::new(),
    };
    if items.is_empty() {
        return Ok(report);
    }
    let total_bytes: usize = items.iter().map(|i| i.size).sum();
    let url = format!("{base}/yjs/push-batch");
    let mut offset = 0;
    for size in chunk_notes(items.len(), total_bytes) {
        let chunk = &items[offset..offset + size];
        offset += size;
        let mut order: Vec<String> = Vec::new();
        let mut by_note: HashMap<&str, Vec<serde_json::Value>> = HashMap::new();
        for item in chunk {
            by_note
                .entry(item.note_id.as_str())
                .or_insert_with(|| {
                    order.push(item.note_id.clone());
                    Vec::new()
                })
                .push(serde_json::json!({
                    "key": item.key,
                    "data": item.data,
                    "deviceId": item.device,
                    "ts": item.ts,
                    "sequence": item.seq,
                }));
        }
        let notes: Vec<serde_json::Value> = order
            .iter()
            .map(|n| serde_json::json!({ "noteId": n, "updates": by_note[n.as_str()] }))
            .collect();
        let body = serde_json::json!({ "workspaceId": workspace_id, "notes": notes }).to_string();
        let resp = client
            .post(&url)
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
            .header(device_id_header(), device)
            .header(device_label_header(), DEVICE_LABEL)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::ACCEPT, "application/json")
            .body(body)
            .send()
            .await
            .map_err(|e| {
                if is_offline(&e) {
                    CloudFail::Typed(SyncError::Offline)
                } else {
                    CloudFail::Fatal(AppError::Other(format!("sync: push request: {e}")))
                }
            })?;
        let status = resp.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
            return Err(CloudFail::Typed(SyncError::Throttled));
        }
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN
        {
            report.unauthorized = true;
            return Ok(report);
        }
        if !status.is_success() {
            return Err(CloudFail::Fatal(AppError::Other(status_snapshot(status))));
        }
        let parsed: PushResp = serde_json::from_str(&resp.text().await.map_err(|e| {
            CloudFail::Fatal(AppError::Other(format!("sync: push response: {e}")))
        })?)
        .map_err(|e| CloudFail::Fatal(AppError::Other(format!("sync: push decode: {e}"))))?;
        report.pushed += (parsed.accepted.max(0) + parsed.duplicate.max(0)) as u64;
        let mut acked: HashSet<String> = HashSet::new();
        match &parsed.checkpoints {
            Some(map) => acked.extend(map.keys().cloned()),
            None => {
                // Single-note fallback, mirroring JS `acknowledgedCheckpoints`.
                if order.len() == 1 && parsed.checkpoint.is_some() {
                    acked.insert(order[0].clone());
                }
            }
        }
        report.acked.extend(acked.iter().cloned());
        record_pushed_ids(&mut report.note_ids, &accepted_chunk_ids(&order, &acked));
    }
    Ok(report)
}

fn store_push_acks(
    pool: &DbPool,
    attempted: &HashMap<String, (i64, u64)>,
    acked: &HashSet<String>,
) -> Result<(), AppError> {
    // Advance row + sequence cursors only for acked notes; anything else
    // replays next tick and the server dedupes on (device, sequence).
    for note in acked {
        if let Some((max_row, max_seq)) = attempted.get(note) {
            db::db_set(pool, &pushed_key(note), &max_row.to_string(), None)?;
            db::db_set(pool, &wseq_key(note), &max_seq.to_string(), None)?;
        }
    }
    Ok(())
}

fn load_server_checkpoint(pool: &DbPool, note_id: &str) -> Option<serde_json::Value> {
    db::db_get(pool, &ckpt_key(note_id), None)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
}

async fn pull_all(
    client: &reqwest::Client,
    base: &str,
    workspace_id: &str,
    token: &str,
    pool: &DbPool,
) -> Result<
    (
        Vec<(String, RemoteUpdate)>,
        HashMap<String, serde_json::Value>,
        Vec<String>,
    ),
    CloudFail,
> {
    // Server-known note list first, mirroring JS `getRemoteState` before
    // `pullUpdates`; a 404/403 is a brand-new or inaccessible workspace, so
    // the pull is skipped this tick rather than failed.
    let state_url = format!(
        "{base}/sync/state?workspaceId={}",
        urlencoding::encode(workspace_id)
    );
    let resp = client
        .get(&state_url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| {
            if is_offline(&e) {
                CloudFail::Typed(SyncError::Offline)
            } else {
                CloudFail::Fatal(AppError::Other(format!("sync: state request: {e}")))
            }
        })?;
    let status = resp.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
        return Err(CloudFail::Typed(SyncError::Throttled));
    }
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(CloudFail::Unauthorized);
    }
    if status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::FORBIDDEN {
        return Ok((Vec::new(), HashMap::new(), Vec::new()));
    }
    if !status.is_success() {
        return Err(CloudFail::Fatal(AppError::Other(status_snapshot(status))));
    }
    let state: SyncStateResp = serde_json::from_str(&resp.text().await.map_err(|e| {
        CloudFail::Fatal(AppError::Other(format!("sync: state response: {e}")))
    })?)
    .map_err(|_| CloudFail::Fatal(AppError::Other("sync: remote sync state payload is malformed".into())))?;
    if !["empty", "initializing", "initialized", "recovering"].contains(&state.status.as_str())
        || state.documents.is_none()
    {
        return Err(CloudFail::Fatal(AppError::Other(
            "sync: remote sync state payload is malformed".into(),
        )));
    }
    let mut docs: Vec<String> = state
        .documents
        .unwrap_or_default()
        .into_iter()
        .filter_map(|d| d.note_id)
        .filter(|n| !n.is_empty())
        .collect();
    docs.sort();
    docs.dedup();
    if docs.is_empty() {
        return Ok((Vec::new(), HashMap::new(), Vec::new()));
    }

    let mut checkpoints: HashMap<String, serde_json::Value> = HashMap::new();
    for note in &docs {
        if let Some(cp) = load_server_checkpoint(pool, note) {
            checkpoints.insert(note.clone(), cp);
        }
    }
    let mut raw: Vec<(String, RemoteUpdate)> = Vec::new();
    let mut pending: HashMap<String, serde_json::Value> = HashMap::new();
    let mut stale: Vec<String> = Vec::new();
    let mut current = docs;
    let pull_url = format!("{base}/yjs/pull-batch");
    for _ in 0..PULL_MAX_PAGES {
        if current.is_empty() {
            break;
        }
        // The pull-batch array stays under the same 50-item discipline as push.
        let mut pages: Vec<(String, PullPage)> = Vec::new();
        for group in current.chunks(MAX_BATCH_ITEMS) {
            let notes: Vec<serde_json::Value> = group
                .iter()
                .map(|n| {
                    serde_json::json!({
                        "noteId": n,
                        "checkpoint": checkpoints.get(n).cloned().unwrap_or(serde_json::Value::Null),
                        "limit": PULL_LIMIT,
                    })
                })
                .collect();
            let body =
                serde_json::json!({ "workspaceId": workspace_id, "notes": notes }).to_string();
            let resp = client
                .post(&pull_url)
                .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .header(reqwest::header::ACCEPT, "application/json")
                .body(body)
                .send()
                .await
                .map_err(|e| {
                    if is_offline(&e) {
                        CloudFail::Typed(SyncError::Offline)
                    } else {
                        CloudFail::Fatal(AppError::Other(format!("sync: pull request: {e}")))
                    }
                })?;
            let status = resp.status();
            if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
                return Err(CloudFail::Typed(SyncError::Throttled));
            }
            if status == reqwest::StatusCode::UNAUTHORIZED
                || status == reqwest::StatusCode::FORBIDDEN
            {
                return Err(CloudFail::Unauthorized);
            }
            if !status.is_success() {
                return Err(CloudFail::Fatal(AppError::Other(status_snapshot(status))));
            }
            let parsed: PullResp = serde_json::from_str(&resp.text().await.map_err(|e| {
                CloudFail::Fatal(AppError::Other(format!("sync: pull response: {e}")))
            })?)
            .map_err(|e| {
                CloudFail::Fatal(AppError::Other(format!("sync: pull decode: {e}")))
            })?;
            let notes_map = parsed.notes.unwrap_or_default();
            for note in group {
                if let Some(page) = notes_map.get(note) {
                    pages.push((note.clone(), page.clone()));
                }
            }
        }
        let mut next_round = Vec::new();
        for (note, page) in pages {
            let updates = page.updates.unwrap_or_default();
            let got_updates = !updates.is_empty();
            for update in updates {
                raw.push((note.clone(), update));
            }
            if page.stale {
                stale.push(note.clone());
            } else if got_updates
                && page.next_checkpoint.is_object()
                && page.next_checkpoint.as_object().is_some_and(|o| !o.is_empty())
            {
                // Advance the request cursor only on updates (mirrors JS):
                // an empty checkpoint poisons future pulls.
                pending.insert(note.clone(), page.next_checkpoint.clone());
                checkpoints.insert(note.clone(), page.next_checkpoint.clone());
            }
            if page.has_more {
                next_round.push(note);
            }
        }
        current = next_round;
        if current.is_empty() {
            break;
        }
    }
    Ok((raw, pending, stale))
}

fn decode_append_store(
    pool: &DbPool,
    key: &[u8; 32],
    raw: Vec<(String, RemoteUpdate)>,
    pending: HashMap<String, serde_json::Value>,
    stale: Vec<String>,
) -> Result<(Vec<String>, u64), CloudFail> {
    // Per-note decode; fail-closed per item (plaintext or unknown envelopes
    // never reach SQLite).
    let mut decoded: Vec<(String, Vec<u8>, String)> = Vec::new();
    let mut raw_count: HashMap<String, usize> = HashMap::new();
    let mut decoded_count: HashMap<String, usize> = HashMap::new();
    for (note_id, update) in &raw {
        *raw_count.entry(note_id.clone()).or_insert(0) += 1;
        let data = match BASE64.decode(update.data.trim()) {
            Ok(b) => b,
            Err(_) => {
                return Err(CloudFail::Fatal(AppError::Other(
                    "sync: remote update payload is malformed".into(),
                )));
            }
        };
        let Some((file_note, file_device, ts, seq)) = parse_commit_filename(&update.key) else {
            // Snapshot keys and anything off-format are skipped, never applied.
            if update.key.contains("~~snapshot~~") {
                continue;
            }
            return Err(CloudFail::Fatal(AppError::Other(
                "sync: remote update payload is malformed".into(),
            )));
        };
        if file_device == "snapshot" {
            continue;
        }
        let Some((note, device, _seq, bytes)) =
            decrypt_remote_update(key, &data, &file_note, &file_device, ts, seq)
        else {
            continue;
        };
        if note != *note_id {
            return Err(CloudFail::Fatal(AppError::Other(
                "sync: remote update payload is malformed".into(),
            )));
        }
        *decoded_count.entry(note.clone()).or_insert(0) += 1;
        decoded.push((note, bytes, device));
    }
    // Zero survivors among envelope candidates means the key is locked or
    // mismatched: surface it instead of advancing past undecryptable data.
    for (note, total) in &raw_count {
        if decoded_count.get(note).copied().unwrap_or(0) == 0 && *total > 0 {
            crate::rs_log!("[sync::cloud] all updates undecryptable for note");
            return Err(CloudFail::Typed(SyncError::DecryptFailed));
        }
    }
    if decoded.is_empty() {
        return Ok((Vec::new(), 0));
    }
    // Delta pull: drop updates the stored per-note vector (`sync:vec:{note}`)
    // already covers — replayed or duplicate-fanout deliveries skip SQLite
    // entirely. Notes without a vector keep everything; server checkpoints
    // stay the fallback either way.
    let mut by_note: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, (n, _, _)) in decoded.iter().enumerate() {
        by_note.entry(n.as_str()).or_default().push(i);
    }
    let mut skip: HashSet<usize> = HashSet::new();
    for (note, idxs) in &by_note {
        let Some(stored) = load_vector(pool, note) else {
            continue;
        };
        let cands: Vec<Vec<u8>> = idxs.iter().map(|&i| decoded[i].1.clone()).collect();
        if covered_by_vector(&cands, &stored) {
            skip.extend(idxs.iter().copied());
        }
    }
    if !skip.is_empty() {
        let mut kept = Vec::with_capacity(decoded.len() - skip.len());
        for (i, item) in decoded.into_iter().enumerate() {
            if !skip.contains(&i) {
                kept.push(item);
            }
        }
        decoded = kept;
    }
    if decoded.is_empty() {
        // Everything was already integrated: still advance the server
        // checkpoints (data seen, nothing new) but report nothing applied.
        for (note, cp) in &pending {
            if decoded_count.get(note).copied().unwrap_or(0) > 0 {
                db::db_set(pool, &ckpt_key(note), &cp.to_string(), None)?;
            }
        }
        for note in &stale {
            let _ = db::db_delete(pool, &ckpt_key(note));
        }
        return Ok((Vec::new(), 0));
    }
    // Meta-before-note, mirroring the JS pull apply order.
    decoded.sort_by_key(|(n, _, _)| usize::from(n != META_DOC_ID));
    let pulled = decoded.len() as u64;
    let note_ids: Vec<String> = {
        let mut ids: Vec<String> = decoded.iter().map(|(n, _, _)| n.clone()).collect();
        ids.sort();
        ids.dedup();
        ids
    };
    let (ids, updates, devices): (Vec<String>, Vec<Vec<u8>>, Vec<String>) = {
        let mut a = Vec::with_capacity(decoded.len());
        let mut b = Vec::with_capacity(decoded.len());
        let mut c = Vec::with_capacity(decoded.len());
        for (n, u, d) in decoded {
            a.push(n);
            b.push(u);
            c.push(d);
        }
        (a, b, c)
    };
    db::yjs_append_batch(pool, &ids, &updates, &devices, Some(*key))?;
    // Store per-note vectors after append so the next pull (and compaction)
    // can diff instead of replaying. Best-effort: cursors stay authoritative.
    for note in &note_ids {
        if let Err(e) = refresh_vector(pool, note, Some(*key)) {
            crate::rs_log!("[sync::cloud] vector refresh skipped: {e}");
        }
    }
    // Checkpoints only after a successful decode + append, else pulls poison.
    for (note, cp) in &pending {
        if decoded_count.get(note).copied().unwrap_or(0) > 0 {
            db::db_set(pool, &ckpt_key(note), &cp.to_string(), None)?;
        }
    }
    for note in &stale {
        let _ = db::db_delete(pool, &ckpt_key(note));
    }
    Ok((note_ids, pulled))
}

async fn blocking<T, F>(f: F) -> Result<T, CloudFail>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| CloudFail::Fatal(AppError::Other(e.to_string())))?
        .map_err(CloudFail::Fatal)
}

pub(crate) fn unlock_gate(app: &AppHandle) -> Result<([u8; 32], DbPool), CloudFail> {
    let state = app.state::<AppState>();
    let pool = data_pool(app, state.inner()).map_err(CloudFail::Fatal)?;
    let key = current_app_key(state.inner())
        .map_err(|_| CloudFail::Typed(SyncError::Locked))?
        .ok_or(CloudFail::Typed(SyncError::Locked))?;
    Ok((key, pool))
}

fn unconfigured(workspace_id: &str, token: &str) -> bool {
    workspace_id.trim().is_empty() || token.is_empty()
}

/// Cloud pull with an explicit pool + key (no AppHandle): the script-drivable
/// core of `sync_cloud_pull`. Live-server tests use this; the app uses the gate.
pub(crate) async fn sync_cloud_pull_with(
    pool: &DbPool,
    key: &[u8; 32],
    workspace_id: &str,
    server_url: &str,
    token: &str,
) -> Result<PullOutcome, CloudFail> {
    if unconfigured(workspace_id, token) {
        return Ok(PullOutcome {
            pulled: 0,
            applied: Vec::new(),
        });
    }
    let client = http_client().map_err(CloudFail::Fatal)?;
    let base = server_url.trim_end_matches('/');
    let (raw, pending, stale) = pull_all(&client, base, workspace_id, token, pool).await?;
    let pool2 = pool.clone();
    let key = *key;
    let (applied, pulled) = tokio::task::spawn_blocking(move || {
        decode_append_store(&pool2, &key, raw, pending, stale)
    })
    .await
    .map_err(|e| CloudFail::Fatal(AppError::Other(e.to_string())))??;
    Ok(PullOutcome { pulled, applied })
}

/// Cloud pull: fetch unseen updates, decrypt fail-closed, append via
/// `yjs_append_batch`, store server checkpoints only on success.
pub(crate) async fn sync_cloud_pull(
    app: &AppHandle,
    workspace_id: &str,
    server_url: &str,
    token: &str,
) -> Result<PullOutcome, CloudFail> {
    if unconfigured(workspace_id, token) {
        return Ok(PullOutcome {
            pulled: 0,
            applied: Vec::new(),
        });
    }
    let (key, pool) = unlock_gate(app)?;
    sync_cloud_pull_with(&pool, &key, workspace_id, server_url, token).await
}

/// Cloud push with an explicit pool + key + device (no AppHandle): the
/// script-drivable core of `sync_cloud_push`. `now_ms` is a parameter so live
/// tests can pin it; the app passes wall-clock time.
pub(crate) async fn sync_cloud_push_with(
    pool: &DbPool,
    key: &[u8; 32],
    device: &str,
    now_ms: u64,
    workspace_id: &str,
    server_url: &str,
    token: &str,
) -> Result<PushOutcome, CloudFail> {
    if unconfigured(workspace_id, token) {
        return Ok(PushOutcome {
            pushed: 0,
            unauthorized: false,
            note_ids: Vec::new(),
        });
    }
    let (items, attempted) = {
        let pool = pool.clone();
        let device = device.to_string();
        let key = *key;
        blocking(move || collect_dirty(&pool, &key, &device, now_ms)).await?
    };
    let client = http_client().map_err(CloudFail::Fatal)?;
    let base = server_url.trim_end_matches('/').to_string();
    let report = push_items(&client, &base, workspace_id, token, device, &items).await?;
    if !report.acked.is_empty() {
        let pool = pool.clone();
        blocking(move || store_push_acks(&pool, &attempted, &report.acked)).await?;
    }
    Ok(PushOutcome {
        pushed: report.pushed,
        unauthorized: report.unauthorized,
        note_ids: report.note_ids,
    })
}

/// Cloud push: dirty rows since the kv cursor → envelope encrypt → chunked
/// `push-batch` (50 items / 5MB) → advance cursors only on ack. Idempotent
/// replay: unacked rows reuse the same (device, sequence) keys.
pub(crate) async fn sync_cloud_push(
    app: &AppHandle,
    workspace_id: &str,
    server_url: &str,
    token: &str,
) -> Result<PushOutcome, CloudFail> {
    if unconfigured(workspace_id, token) {
        return Ok(PushOutcome {
            pushed: 0,
            unauthorized: false,
            note_ids: Vec::new(),
        });
    }
    let (key, pool) = unlock_gate(app)?;
    let device = blocking({
        let pool = pool.clone();
        move || get_or_create_device_id(&pool)
    })
    .await?;
    let now_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    sync_cloud_push_with(&pool, &key, &device, now_ms, workspace_id, server_url, token).await
}

#[cfg(test)]
mod tests {
    #[test]
    fn chunk_caps_match_server_limits() {
        assert_eq!(super::chunk_notes(101, 1024).len(), 3); // 50-item cap
        assert_eq!(super::chunk_notes(2, 6 * 1024 * 1024).len(), 2); // 5MB cap
    }

    #[test]
    fn record_pushed_ids_dedupes_across_chunks() {
        let mut ids: Vec<String> = Vec::new();
        super::record_pushed_ids(&mut ids, &["n1".into(), "n2".into()]);
        super::record_pushed_ids(&mut ids, &["n2".into(), "n3".into()]);
        assert_eq!(ids, vec!["n1", "n2", "n3"]);
    }

    #[test]
    fn accepted_chunk_ids_prefers_acked_and_falls_back() {
        use std::collections::HashSet;
        let order: Vec<String> = vec!["A".into(), "B".into()];
        // Server acked only A: report A, not B.
        let acked: HashSet<String> = ["A".to_string()].into_iter().collect();
        assert_eq!(super::accepted_chunk_ids(&order, &acked), vec!["A"]);
        // No per-note ack: fall back to the whole chunk.
        let none: HashSet<String> = HashSet::new();
        assert_eq!(super::accepted_chunk_ids(&order, &none), vec!["A", "B"]);
    }

    #[test]
    fn pushed_event_requires_count_and_ids() {
        let mk = |pushed: u64, ids: Vec<String>| super::PushOutcome {
            pushed,
            unauthorized: false,
            note_ids: ids,
        };
        assert!(mk(1, vec!["n1".into()]).has_pushed());
        assert!(!mk(0, vec!["n1".into()]).has_pushed());
        assert!(!mk(1, Vec::new()).has_pushed());
        assert!(!mk(0, Vec::new()).has_pushed());
    }

    #[test]
    fn local_cloud_flags_detect_notes_and_checkpoints() {
        use std::{fs, path::PathBuf, time::SystemTime};

        fn unique_temp_dir(prefix: &str) -> PathBuf {
            let ts = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("clock ok")
                .as_nanos();
            std::env::temp_dir().join(format!("{prefix}-{ts}-{}", std::process::id()))
        }

        let root = unique_temp_dir("beaver-notes-cloud-flags");
        let _ = fs::create_dir_all(&root);
        let pool = crate::db::open_pool(&root.join("data.db")).expect("pool");

        assert_eq!(super::local_cloud_flags(&pool).unwrap(), (false, false));

        // The `meta` doc alone is not a local note.
        crate::db::yjs_append(&pool, super::META_DOC_ID, b"x", "dev", None).expect("append meta");
        assert_eq!(super::local_cloud_flags(&pool).unwrap(), (false, false));

        crate::db::yjs_append(&pool, "n1", b"x", "dev", None).expect("append note");
        crate::db::db_set(&pool, "sync:cloud:ckpt:n1", "{}", None).expect("ckpt");
        assert_eq!(super::local_cloud_flags(&pool).unwrap(), (true, true));

        let _ = fs::remove_dir_all(&root);
    }

    /// Live-server harness: drives the real push/pull code against a running
    /// Beaver-Sync instance. Hermetic `cargo test` never runs these (`#[ignore]`;
    /// they also self-skip without env). Run via scripts/cloud-live/engine.sh:
    /// `cargo test -- --ignored live_`.
    mod live {
        use yrs::{updates::decoder::Decode, Doc, GetString, ReadTxn, StateVector, Text, Transact, Update};

        use crate::sync::cloud::{
            sync_cloud_pull_with, sync_cloud_push_with, CloudFail,
        };
        use crate::sync::local::get_or_create_device_id;

        fn unwrap<T>(r: Result<T, CloudFail>, what: &str) -> T {
            match r {
                Ok(v) => v,
                Err(CloudFail::Unauthorized) => panic!("{what}: unauthorized"),
                Err(CloudFail::Typed(e)) => panic!("{what}: {}", e.status_str()),
                Err(CloudFail::Fatal(e)) => panic!("{what}: fatal {e:?}"),
            }
        }

        fn cfg() -> Option<(String, String, String)> {
            let url = std::env::var("BEAVER_LIVE_URL").ok()?;
            let token = std::env::var("BEAVER_LIVE_TOKEN").ok()?;
            let ws = std::env::var("BEAVER_LIVE_WS").ok()?;
            if url.is_empty() || token.is_empty() || ws.is_empty() {
                return None;
            }
            Some((url, token, ws))
        }

        fn pool(tag: &str) -> (crate::db::DbPool, std::path::PathBuf) {
            // ponytail: temp-dir pools, no AppHandle; add shared-vault key setup if live tests ever need distinct keys.
            let dir = std::env::temp_dir().join(format!(
                "beaver-live-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .expect("clock ok")
                    .as_nanos()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            let pool = crate::db::open_pool(&dir.join("data.db")).expect("pool");
            (pool, dir)
        }

        fn update(text: &str) -> Vec<u8> {
            let doc = Doc::new();
            let t = doc.get_or_insert_text("content");
            let mut txn = doc.transact_mut();
            t.insert(&mut txn, 0, text);
            txn.encode_state_as_update_v1(&StateVector::default())
        }

        fn read_text(pool: &crate::db::DbPool, key: &[u8; 32], note: &str) -> String {
            let doc = Doc::new();
            let t = doc.get_or_insert_text("content");
            let rows =
                crate::db::yjs_get_updates(pool, note, Some(*key)).expect("read rows");
            assert!(!rows.is_empty(), "expected rows for {note}");
            for (_, blob) in rows {
                let update = Update::decode_v1(&blob).expect("decode update");
                doc.transact_mut().apply_update(update).expect("apply");
            }
            let txn = doc.transact_mut();
            t.get_string(&txn)
        }

        fn now_ms() -> u64 {
            chrono::Utc::now().timestamp_millis().max(0) as u64
        }

        #[tokio::test]
        #[ignore]
        async fn live_push_pull_roundtrip() {
            let Some((url, token, ws)) = cfg() else {
                eprintln!("skip: set BEAVER_LIVE_URL/_TOKEN/_WS");
                return;
            };
            // Same vault key on both sides = two vault-joined devices.
            let key = [7u8; 32];
            let (pool_a, dir_a) = pool("a");
            let (pool_b, dir_b) = pool("b");
            let dev_a = unwrap(
                get_or_create_device_id(&pool_a).map_err(CloudFail::from),
                "device a",
            );
            let dev_b = unwrap(
                get_or_create_device_id(&pool_b).map_err(CloudFail::from),
                "device b",
            );
            assert_ne!(dev_a, dev_b);

            crate::db::yjs_append(&pool_a, "liveprobe", &update("hello from a"), "t", Some(key))
                .expect("append a");
            let push = unwrap(
                sync_cloud_push_with(
                    &pool_a, &key, &dev_a, now_ms(), &ws, &url, &token,
                )
                .await,
                "push a",
            );
            assert!(push.pushed >= 1, "nothing pushed");
            assert!(push.note_ids.contains(&"liveprobe".to_string()));

            let pull = unwrap(
                sync_cloud_pull_with(&pool_b, &key, &ws, &url, &token).await,
                "pull b",
            );
            assert!(pull.applied.contains(&"liveprobe".to_string()));
            assert_eq!(read_text(&pool_b, &key, "liveprobe"), "hello from a");

            // And back: B's edit must reach A.
            crate::db::yjs_append(&pool_b, "liveprobe", &update("hello from a + b"), "t", Some(key))
                .expect("append b");
            // NOTE: appending a full-state update supersedes; text converges to latest writer.
            let push_b = unwrap(
                sync_cloud_push_with(
                    &pool_b, &key, &dev_b, now_ms(), &ws, &url, &token,
                )
                .await,
                "push b",
            );
            assert!(push_b.pushed >= 1);
            let pull_a = unwrap(
                sync_cloud_pull_with(&pool_a, &key, &ws, &url, &token).await,
                "pull a",
            );
            assert!(pull_a.applied.contains(&"liveprobe".to_string()));

            // Echo dynamics (same as folder transport): rows that arrived via
            // pull are new local rows, so the next push relays them once.
            // First relay round: B's vector predates its own local append, so
            // the relay of B's own update looks new and lands as one duplicate
            // row (idempotent bytes, vector then catches up). Second round
            // must be fully quiet — this locks termination, not silence.
            let echo = unwrap(
                sync_cloud_push_with(
                    &pool_a, &key, &dev_a, now_ms(), &ws, &url, &token,
                )
                .await,
                "echo push",
            );
            assert!(echo.pushed >= 1);
            let pull_b2 = unwrap(
                sync_cloud_pull_with(&pool_b, &key, &ws, &url, &token).await,
                "pull b2",
            );
            // Duplicate row is dirty on B: one more relay, then coverage holds.
            let echo2 = unwrap(
                sync_cloud_push_with(
                    &pool_b, &key, &dev_b, now_ms(), &ws, &url, &token,
                )
                .await,
                "echo push 2",
            );
            let _ = (pull_b2, echo2);
            let pull_a2 = unwrap(
                sync_cloud_pull_with(&pool_a, &key, &ws, &url, &token).await,
                "pull a2",
            );
            assert!(
                pull_a2.applied.is_empty(),
                "second relay round must be covered-skipped, applied={:?}",
                pull_a2.applied
            );
            let quiet_a = unwrap(
                sync_cloud_push_with(
                    &pool_a, &key, &dev_a, now_ms(), &ws, &url, &token,
                )
                .await,
                "quiet push a",
            );
            assert_eq!(quiet_a.pushed, 0);
            let quiet_b = unwrap(
                sync_cloud_push_with(
                    &pool_b, &key, &dev_b, now_ms(), &ws, &url, &token,
                )
                .await,
                "quiet push b",
            );
            assert_eq!(quiet_b.pushed, 0);

            let _ = std::fs::remove_dir_all(&dir_a);
            let _ = std::fs::remove_dir_all(&dir_b);
        }

        #[tokio::test]
        #[ignore]
        async fn live_failed_push_keeps_cursor() {
            let Some((url, token, ws)) = cfg() else {
                eprintln!("skip: set BEAVER_LIVE_URL/_TOKEN/_WS");
                return;
            };
            let key = [7u8; 32];
            let (pool_a, dir_a) = pool("c");
            let dev_a = unwrap(
                get_or_create_device_id(&pool_a).map_err(CloudFail::from),
                "device",
            );
            crate::db::yjs_append(&pool_a, "liveprobe2", &update("unauthorized first"), "t", Some(key))
                .expect("append");

            // Bad token: server 401/403 → unauthorized flag, cursor NOT advanced.
            let bad = unwrap(
                sync_cloud_push_with(
                    &pool_a, &key, &dev_a, now_ms(), &ws, &url, "bogus-token",
                )
                .await,
                "bad-token push returns report",
            );
            assert!(bad.unauthorized, "expected unauthorized flag");
            assert_eq!(bad.pushed, 0);

            // Good token replays the same rows (idempotent device+sequence keys).
            let good = unwrap(
                sync_cloud_push_with(
                    &pool_a, &key, &dev_a, now_ms(), &ws, &url, &token,
                )
                .await,
                "good push",
            );
            assert!(good.pushed >= 1);
            assert!(good.note_ids.contains(&"liveprobe2".to_string()));

            let _ = std::fs::remove_dir_all(&dir_a);
        }
    }
}
