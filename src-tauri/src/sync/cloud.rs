use std::collections::{HashMap, HashSet};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::local::{get_or_create_device_id, parse_commit_filename};
use super::merge::{covered_by_vector, load_vector, refresh_vector};
use crate::db::{self, DbPool};
use crate::shared::{
    SyncEnvelope, PROTOCOL_VERSION, SHARED_PAYLOAD_VERSION, SYNC_PAYLOAD_VERSION, aead_decrypt_bytes,
    aead_decrypt_json, aead_encrypt_bytes, current_app_key, data_pool, decrypt_yjs_blob, write_barrier,
    AppError, AppState,
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

/// Split per-item byte sizes into `(start, end)` ranges honouring the 50-item /
/// 5MB server caps. A single item larger than the byte budget is isolated in its
/// own range (it cannot be split further), so the push path can report that one
/// item instead of aborting the whole cycle (finding C6).
pub(crate) fn chunk_sizes(sizes: &[usize]) -> Vec<(usize, usize)> {
    let mut chunks = Vec::new();
    let mut start = 0usize;
    let mut bytes = 0usize;
    for (i, &size) in sizes.iter().enumerate() {
        if i > start && (bytes + size > MAX_BATCH_BODY_BYTES || i - start >= MAX_BATCH_ITEMS) {
            chunks.push((start, i));
            start = i;
            bytes = 0;
        }
        bytes += size;
    }
    if start < sizes.len() {
        chunks.push((start, sizes.len()));
    }
    chunks
}

/// True when bytes are a decodable v1 yjs update. Authentic-but-corrupt
/// payloads (decrypt fine, fail to parse) are treated as failed rows so their
/// note's checkpoint is held rather than silently marked covered (finding C11).
fn is_decodable_update(bytes: &[u8]) -> bool {
    !bytes.is_empty() && y_octo::Update::decode_v1(bytes).is_ok()
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
    /// `note_content.id` this item came from: the push cursor only advances
    /// over rows covered by an accepted chunk, which needs the row id (a
    /// per-note sequence alone cannot tell two chunks apart).
    row_id: i64,
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
/// `decryptJSON` gate: only v4/v5/v6 envelopes with an AAD of `{note}-{ts}`.
/// v5 seals with the account items key, v6 with the note's shared key.
/// `shared_keys` is the note's key ring newest-first: any generation may open a
/// v6 row (so pre-rotation history stays readable), but an unknown key ring
/// fails closed.
/// Returns `(note_id, device, sequence, update_bytes)` after strict
/// filename-vs-payload identity checks (mirrors the JS pull validation).
fn decrypt_remote_update(
    app_key: &[u8; 32],
    shared_keys: &[[u8; 32]],
    raw: &[u8],
    file_note: &str,
    file_device: &str,
    ts: u64,
    file_seq: u64,
) -> Option<(String, String, u64, Vec<u8>)> {
    let env: serde_json::Value = serde_json::from_slice(raw).ok()?;
    let v = env.get("v")?.as_u64()? as u8;
    let aad = format!("{file_note}-{ts}");
    // v5 seals with the account items key, v6 with the note's shared
    // collaboration key. The version field picks the key family; a v6 row may
    // have been sealed by any key in the note's ring, so try each newest-first.
    let (note, device, meta_ts, meta_seq, update) =
        if v == SYNC_PAYLOAD_VERSION || v == SHARED_PAYLOAD_VERSION {
            let iv = env.get("iv")?.as_str()?;
            let enc = env.get("enc")?.as_str()?;
            let update = if v == SHARED_PAYLOAD_VERSION {
                shared_keys
                    .iter()
                    .find_map(|key| aead_decrypt_bytes(key, iv, enc, &aad).ok())?
            } else {
                aead_decrypt_bytes(app_key, iv, enc, &aad).ok()?
            };
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
            let value = aead_decrypt_json(app_key, &legacy, &aad).ok()?;
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
    app_key: &[u8; 32],
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    expected_shared: &HashSet<String>,
    device: &str,
    now_ms: u64,
) -> Result<DirtyBatch, AppError> {
    collect_dirty_filtered(
        pool,
        app_key,
        shared_keys,
        expected_shared,
        device,
        now_ms,
        None,
        &HashSet::new(),
    )
}

/// `only_note` restricts collection to one note (the shared-with-me single-note
/// path). `skip_notes` excludes notes owned by another workspace: the
/// active-workspace push must never copy a shared-with-me note into the
/// caller's own workspace, whose member branch would silently accept it.
#[allow(clippy::too_many_arguments)]
fn collect_dirty_filtered(
    pool: &DbPool,
    app_key: &[u8; 32],
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    expected_shared: &HashSet<String>,
    device: &str,
    now_ms: u64,
    only_note: Option<&str>,
    skip_notes: &HashSet<String>,
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
    let notes: Vec<String> = notes
        .into_iter()
        .filter(|n| match only_note {
            Some(only) => n.as_str() == only,
            None => !skip_notes.contains(n),
        })
        .collect();
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
        // A note the client already knows is shared, but whose collaboration
        // key is not registered yet, must not be sealed with the account items
        // key: peers (other accounts) could never decrypt that envelope. Defer
        // every row (`continue` before the cursor is recorded) so the push
        // cursor stays behind them and `sync_register_shared_key`'s kick
        // re-attempts the push once the key lands. Personal (unmarked) notes
        // keep the exact v5 items-key behaviour.
        let shared = shared_keys.get(&note);
        if shared.is_none() && expected_shared.contains(&note) {
            crate::rs_log!(
                "[sync::cloud] deferring shared note with no registered key: {note}"
            );
            continue;
        }
        let wseq: u64 = db::db_get(pool, &wseq_key(&note), None)?
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        // Highest sequence that will exist after this push; persisted on ack
        // so replays reuse the same (device, sequence) idempotency keys.
        attempted.insert(note.clone(), (rows.last().map(|r| r.0).unwrap_or(since), wseq.wrapping_add(rows.len() as u64)));
        // Shared notes (collaboration note key / workspace meta key) seal with
        // the collaborator-shared key and v6; personal notes keep the items key
        // and v5. Only the *server* envelope changes; rows stay items-key at rest.
        // A rotated note seals with the newest key in its ring.
        let (seal_key, version) = match shared.and_then(|keys| keys.first().copied()) {
            Some(k) => (k, SHARED_PAYLOAD_VERSION),
            None => (*app_key, SYNC_PAYLOAD_VERSION),
        };
        for (idx, (_, stored)) in rows.iter().enumerate() {
            let update = match decrypt_yjs_blob(app_key, stored) {
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
            let (iv, enc) = aead_encrypt_bytes(&seal_key, &update, &aad)?;
            let envelope = serde_json::json!({
                "v": version,
                "meta": { "device": device, "ts": now_ms as i64, "sequence": seq as i64, "noteId": note },
                "iv": iv,
                "enc": enc,
            });
            let data = BASE64.encode(serde_json::to_string(&envelope)?.as_bytes());
            let file_key = format!("{note}~~{device}~~{now_ms}~~{seq}.yjs.json");
            let size = estimate_item_size(&note, &file_key, &data);
            items.push(PushItem {
                note_id: note.clone(),
                row_id: rows[idx].0,
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

/// Push-side sealing writer: resolve the items key and collect the sealed
/// envelopes under the key-migration read barrier (finding C2). The barrier
/// spans the key read + encryption so a concurrent vault join/rotation cannot
/// swap the key in between. `WriterKey::resolve` is called once, here, and the
/// `db.rs` writers below take no further barrier (no nested read guard).
#[allow(clippy::too_many_arguments)]
fn collect_dirty_guarded(
    pool: &DbPool,
    key: WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    expected_shared: &HashSet<String>,
    device: &str,
    now_ms: u64,
    only_note: Option<&str>,
    skip_notes: &HashSet<String>,
) -> Result<DirtyBatch, AppError> {
    let _barrier = write_barrier();
    let app_key = key.resolve()?;
    collect_dirty_filtered(
        pool,
        &app_key,
        shared_keys,
        expected_shared,
        device,
        now_ms,
        only_note,
        skip_notes,
    )
}

struct PushReport {
    pushed: u64,
    unauthorized: bool,
    note_ids: Vec<String>,
    /// Per-note `(max row id, max wseq)` covered by *acked* chunks only. Fed to
    /// `store_push_acks`; unlike the batch-wide high-water mark, a rejected
    /// chunk can never move the cursor past rows it did not deliver.
    attempted: HashMap<String, (i64, u64)>,
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

/// Note ids the server acked for one chunk. Per-note `checkpoints` when
/// present; otherwise, if the response accepted every update in the chunk
/// (`accepted + duplicate >= item_count`), the whole chunk is acked so cursors
/// still advance for multi-note chunks without a checkpoints map (finding C7).
/// The singular `checkpoint` fallback covers the one-note response shape.
fn chunk_acks(order: &[String], item_count: usize, resp: &PushResp) -> HashSet<String> {
    let mut acked: HashSet<String> = HashSet::new();
    match &resp.checkpoints {
        Some(map) if !map.is_empty() => acked.extend(map.keys().cloned()),
        _ => {
            let accepted = resp.accepted.max(0) + resp.duplicate.max(0);
            if accepted >= item_count as i64 {
                acked.extend(order.iter().cloned());
            } else if order.len() == 1 && resp.checkpoint.is_some() {
                acked.insert(order[0].clone());
            }
        }
    }
    acked
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

/// Per-note high-water marks for a single chunk: the max row id and max
/// sequence among the chunk's items, per note. `note_content.id` is the cursor
/// unit, so a note spanning chunks is resolved chunk by chunk.
fn chunk_high_water(chunk: &[PushItem]) -> HashMap<String, (i64, u64, usize)> {
    let mut per_note: HashMap<String, (i64, u64, usize)> = HashMap::new();
    for item in chunk {
        let e = per_note
            .entry(item.note_id.clone())
            .or_insert((item.row_id, item.seq, 0));
        e.0 = e.0.max(item.row_id);
        e.1 = e.1.max(item.seq);
        e.2 += 1;
    }
    per_note
}

/// Fold the per-chunk acks into the cursors `store_push_acks` persists. Only
/// rows covered by an acked chunk advance, so a later 401/403 chunk cannot be
/// skipped by an earlier accepted one. A note whose every item was accepted in
/// this batch may jump to `global_attempted` instead, so rows `collect_dirty`
/// deliberately skipped (undecodable / empty) never pin the queue.
fn acked_cursors(
    items: &[PushItem],
    global_attempted: &HashMap<String, (i64, u64)>,
    chunk_attempts: &[(std::ops::Range<usize>, HashSet<String>)],
) -> HashMap<String, (i64, u64)> {
    let mut total: HashMap<&str, usize> = HashMap::new();
    for item in items {
        *total.entry(item.note_id.as_str()).or_insert(0) += 1;
    }
    let mut cursors: HashMap<String, (i64, u64)> = HashMap::new();
    let mut accepted: HashMap<String, usize> = HashMap::new();
    for (range, acked) in chunk_attempts {
        for (note, (row, seq, count)) in chunk_high_water(&items[range.clone()]) {
            if !acked.contains(&note) {
                continue;
            }
            let e = cursors.entry(note.clone()).or_insert((row, seq));
            e.0 = e.0.max(row);
            e.1 = e.1.max(seq);
            *accepted.entry(note).or_insert(0) += count;
        }
    }
    for (note, total_count) in &total {
        if accepted.get(*note).copied().unwrap_or(0) >= *total_count {
            if let Some(&(row, seq)) = global_attempted.get(*note) {
                cursors.insert((*note).to_string(), (row, seq));
            }
        }
    }
    // Notes with no pushable items at all (every row was undecodable or empty)
    // never enter `total`, so the loop above can't move their cursor. Advance
    // them to the batch-wide high-water mark collected in `collect_dirty`, or
    // the same rows would be re-collected and re-skipped every tick forever
    // (finding C4). Deferred shared notes are absent from `global_attempted`
    // entirely, so they keep their cursor held as C1 requires.
    for (note, &(row, seq)) in global_attempted {
        if total.contains_key(note.as_str()) {
            continue;
        }
        cursors.insert(note.clone(), (row, seq));
    }
    cursors
}

async fn push_items(
    client: &reqwest::Client,
    base: &str,
    workspace_id: &str,
    token: &str,
    device: &str,
    items: &[PushItem],
    global_attempted: &HashMap<String, (i64, u64)>,
) -> Result<PushReport, CloudFail> {
    let mut report = PushReport {
        pushed: 0,
        unauthorized: false,
        note_ids: Vec::new(),
        attempted: HashMap::new(),
    };
    if items.is_empty() {
        return Ok(report);
    }
    let sizes: Vec<usize> = items.iter().map(|i| i.size).collect();
    let url = format!("{base}/yjs/push-batch");
    let mut chunk_attempts: Vec<(std::ops::Range<usize>, HashSet<String>)> = Vec::new();
    for (start, end) in chunk_sizes(&sizes) {
        let chunk = &items[start..end];
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
            // Persist only what earlier chunks actually acked; this chunk and
            // every later one are left for the next tick.
            report.attempted = acked_cursors(items, global_attempted, &chunk_attempts);
            return Ok(report);
        }
        // A 413 means this chunk exceeds the server body cap. Byte-aware
        // chunking isolates an oversized single item, so advance its cursor and
        // report it rather than aborting push+assets every tick (finding C6).
        // A multi-item 413 is left unacked so it retries (and is logged).
        if status == reqwest::StatusCode::PAYLOAD_TOO_LARGE {
            crate::rs_log!(
                "[sync::cloud] push chunk rejected 413 ({} item(s), note ids {:?}); {}",
                chunk.len(),
                order,
                if chunk.len() == 1 {
                    "skipping oversized item once (cursor advanced)"
                } else {
                    "leaving unacked for retry"
                }
            );
            if chunk.len() == 1 {
                chunk_attempts.push((start..end, order.iter().cloned().collect()));
            }
            continue;
        }
        if !status.is_success() {
            return Err(CloudFail::Fatal(AppError::Other(status_snapshot(status))));
        }
        let parsed: PushResp = serde_json::from_str(&resp.text().await.map_err(|e| {
            CloudFail::Fatal(AppError::Other(format!("sync: push response: {e}")))
        })?)
        .map_err(|e| CloudFail::Fatal(AppError::Other(format!("sync: push decode: {e}"))))?;
        report.pushed += (parsed.accepted.max(0) + parsed.duplicate.max(0)) as u64;
        let acked = chunk_acks(&order, chunk.len(), &parsed);
        record_pushed_ids(&mut report.note_ids, &accepted_chunk_ids(&order, &acked));
        chunk_attempts.push((start..end, acked));
    }
    report.attempted = acked_cursors(items, global_attempted, &chunk_attempts);
    Ok(report)
}

/// Persist the per-note `(row id, wseq)` cursors produced by `acked_cursors`.
/// Only rows covered by an accepted chunk are included, so a rejected chunk's
/// rows replay next tick and the server dedupes on `(device, sequence)`.
fn store_push_acks(
    pool: &DbPool,
    attempted: &HashMap<String, (i64, u64)>,
) -> Result<(), AppError> {
    for (note, (max_row, max_seq)) in attempted {
        db::db_set(pool, &pushed_key(note), &max_row.to_string(), None)?;
        db::db_set(pool, &wseq_key(note), &max_seq.to_string(), None)?;
    }
    Ok(())
}

fn load_server_checkpoint(pool: &DbPool, note_id: &str) -> Option<serde_json::Value> {
    db::db_get(pool, &ckpt_key(note_id), None)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
}

/// Build a server-style `{ device: { ts, sequence } }` checkpoint from the
/// delivered update filenames, taking the highest `(ts, sequence)` per device.
/// Used when a pull page delivers updates but omits `next_checkpoint`, so the
/// note can still advance instead of pinning forever (finding C8).
fn checkpoint_from_updates(updates: &[RemoteUpdate]) -> Option<serde_json::Value> {
    let mut map: HashMap<String, (u64, u64)> = HashMap::new();
    for update in updates {
        let Some((_note, device, ts, seq)) = parse_commit_filename(&update.key) else {
            continue;
        };
        let e = map.entry(device).or_insert((ts, seq));
        if (ts, seq) > *e {
            *e = (ts, seq);
        }
    }
    if map.is_empty() {
        return None;
    }
    let obj: serde_json::Map<String, serde_json::Value> = map
        .into_iter()
        .map(|(device, (ts, seq))| {
            (
                device,
                serde_json::json!({ "ts": ts as i64, "sequence": seq as i64 }),
            )
        })
        .collect();
    Some(serde_json::Value::Object(obj))
}

async fn pull_all(
    client: &reqwest::Client,
    base: &str,
    workspace_id: &str,
    token: &str,
    pool: &DbPool,
    only_note: Option<&str>,
) -> Result<
    (
        Vec<(String, RemoteUpdate)>,
        HashMap<String, serde_json::Value>,
        Vec<String>,
    ),
    CloudFail,
> {
    // A shared-with-me note syncs by known id and must not consult
    // `/sync/state`, which is workspace-member scoped. The full path fetches the
    // server-known note list first, mirroring JS `getRemoteState` before
    // `pullUpdates`; a 404/403 is a brand-new or inaccessible workspace, so the
    // pull is skipped this tick rather than failed.
    let docs: Vec<String> = if let Some(note) = only_note {
        vec![note.to_string()]
    } else {
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
        docs
    };
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
            let server_cp = page
                .next_checkpoint
                .as_object()
                .filter(|o| !o.is_empty())
                .map(|_| page.next_checkpoint.clone());
            // A response that delivers updates but omits `next_checkpoint` must
            // not pin the note: derive a checkpoint from the delivered updates'
            // device/ts/sequence keys so the request cursor still advances
            // (finding C8). Otherwise the same page is re-fetched forever.
            let fallback_cp = if got_updates && server_cp.is_none() {
                checkpoint_from_updates(&updates)
            } else {
                None
            };
            for update in updates {
                raw.push((note.clone(), update));
            }
            if page.stale {
                stale.push(note.clone());
            } else if got_updates {
                // Advance the request cursor only on updates (mirrors JS):
                // an empty checkpoint poisons future pulls.
                if let Some(cp) = server_cp.or(fallback_cp) {
                    pending.insert(note.clone(), cp.clone());
                    checkpoints.insert(note.clone(), cp);
                }
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

/// True when every envelope candidate for `note` decoded. A note with any
/// dropped (undecryptable) update must not advance its server checkpoint, so
/// the server re-delivers the missing updates.
fn fully_decoded_counts(
    raw_count: &HashMap<String, usize>,
    decoded_count: &HashMap<String, usize>,
    note: &str,
) -> bool {
    let total = raw_count.get(note).copied().unwrap_or(0);
    total > 0 && decoded_count.get(note).copied().unwrap_or(0) == total
}

fn decode_append_store(
    pool: &DbPool,
    app_key: &[u8; 32],
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
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
        // Snapshot keys and anything off-format are skipped, never applied.
        if update.key.contains("~~snapshot~~") {
            continue;
        }
        let Some((file_note, file_device, ts, seq)) = parse_commit_filename(&update.key) else {
            // A single unparseable row must not wedge the whole workspace
            // (finding C5): count it so the note's checkpoint is held, skip it,
            // and keep applying the rest of the pull.
            *raw_count.entry(note_id.clone()).or_insert(0) += 1;
            crate::rs_log!(
                "[sync::cloud] skipping row with unparseable commit key: {}",
                update.key
            );
            continue;
        };
        if file_device == "snapshot" {
            continue;
        }
        // Count only real update candidates (snapshots excluded), so a
        // snapshot-only delivery never looks like a decrypt failure.
        *raw_count.entry(note_id.clone()).or_insert(0) += 1;
        let data = match BASE64.decode(update.data.trim()) {
            Ok(b) => b,
            Err(_) => {
                crate::rs_log!(
                    "[sync::cloud] skipping row with invalid base64 for {note_id}; checkpoint held"
                );
                continue;
            }
        };
        // v6 rows need the note's shared key; without it we skip and hold the
        // checkpoint so the server re-delivers once the key is registered.
        let shared = shared_keys.get(note_id).map(|keys| keys.as_slice()).unwrap_or(&[]);
        let Some((note, device, _seq, bytes)) =
            decrypt_remote_update(app_key, shared, &data, &file_note, &file_device, ts, seq)
        else {
            continue;
        };
        if note != *note_id {
            crate::rs_log!(
                "[sync::cloud] skipping row whose payload note id ({note}) differs from its batch key ({note_id}); checkpoint held"
            );
            continue;
        }
        // An authentic-but-corrupt update (decrypts but is not a valid yjs
        // update) must not count as decoded, or its checkpoint advances and the
        // update is skipped forever (finding C11).
        if !is_decodable_update(&bytes) {
            crate::rs_log!(
                "[sync::cloud] skipping undecodable yjs update for {note_id}; checkpoint held"
            );
            continue;
        }
        *decoded_count.entry(note.clone()).or_insert(0) += 1;
        decoded.push((note, bytes, device));
    }
    // Per-note failures are non-fatal: surface them in the log, apply whatever
    // did decode, and — below — never advance that note's checkpoint, so the
    // server re-delivers the dropped updates and the rest of the workspace
    // still syncs.
    for (note, total) in &raw_count {
        let decoded_n = decoded_count.get(note).copied().unwrap_or(0);
        if decoded_n < *total {
            crate::rs_log!(
                "[sync::cloud] note {note}: {}/{} updates undecryptable, checkpoint held",
                total - decoded_n,
                total
            );
        }
    }
    let fully_decoded = |note: &str| -> bool {
        fully_decoded_counts(&raw_count, &decoded_count, note)
    };
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
            if fully_decoded(note) {
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
    db::yjs_append_batch(pool, &ids, &updates, &devices, Some(*app_key))?;
    // A pulled note body is now locally live. The asset pass runs later in this
    // same tick and reads it, so this kick is belt-and-braces; it guarantees a
    // reference-driven attachment download is never left to the 30s interval
    // (mirrors `sync_register_shared_key`'s kick for a freshly registered key).
    super::scheduler::kick_if_running();
    // Store per-note vectors after append so the next pull (and compaction)
    // can diff instead of replaying. Best-effort: cursors stay authoritative.
    for note in &note_ids {
        if let Err(e) = refresh_vector(pool, note, Some(*app_key)) {
            crate::rs_log!("[sync::cloud] vector refresh skipped: {e}");
        }
    }
    // Checkpoints only after a successful decode + append, and only for notes
    // whose every candidate decrypted — a dropped update must be re-delivered,
    // not skipped.
    for (note, cp) in &pending {
        if fully_decoded(note) {
            db::db_set(pool, &ckpt_key(note), &cp.to_string(), None)?;
        }
    }
    for note in &stale {
        let _ = db::db_delete(pool, &ckpt_key(note));
    }
    Ok((note_ids, pulled))
}

/// Pull-side append writer: resolve the items key and decode/append under the
/// key-migration read barrier (finding C2), so the key read and the sealed
/// `yjs_append_batch` write are one guarded span.
fn decode_append_store_guarded(
    pool: &DbPool,
    key: WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    raw: Vec<(String, RemoteUpdate)>,
    pending: HashMap<String, serde_json::Value>,
    stale: Vec<String>,
) -> Result<(Vec<String>, u64), CloudFail> {
    let _barrier = write_barrier();
    let app_key = key.resolve().map_err(CloudFail::Fatal)?;
    decode_append_store(pool, &app_key, shared_keys, raw, pending, stale)
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

/// Source of a sync writer's items key. It is resolved **under the
/// key-migration read barrier**, immediately before the sealed write, so a
/// concurrent vault join/rotation cannot swap the key between the read and the
/// ciphertext write (finding C2). App paths read the session; the
/// script/test paths carry an explicit key.
pub(crate) enum WriterKey {
    Explicit([u8; 32]),
    Session(AppHandle),
}

impl WriterKey {
    /// Resolve the items key. The caller must already hold `write_barrier()`.
    pub(crate) fn resolve(&self) -> Result<[u8; 32], AppError> {
        match self {
            WriterKey::Explicit(k) => Ok(*k),
            WriterKey::Session(app) => {
                current_app_key(app.state::<AppState>().inner())?.ok_or(AppError::EncryptionLocked)
            }
        }
    }
}

/// Pool plus a fail-fast locked check for a sealing writer. The sealing key
/// itself is read by the writer closure under the migration barrier
/// (`WriterKey::Session`), never here.
pub(crate) fn writer_gate(app: &AppHandle) -> Result<DbPool, CloudFail> {
    let state = app.state::<AppState>();
    let pool = data_pool(app, state.inner()).map_err(CloudFail::Fatal)?;
    if current_app_key(state.inner())
        .map_err(|_| CloudFail::Typed(SyncError::Locked))?
        .is_none()
    {
        return Err(CloudFail::Typed(SyncError::Locked));
    }
    Ok(pool)
}

fn unconfigured(workspace_id: &str, token: &str) -> bool {
    workspace_id.trim().is_empty() || token.is_empty()
}

/// Cloud pull with an explicit pool + key (no AppHandle): the script-drivable
/// core of `sync_cloud_pull`. Live-server tests use this; the app uses the gate.
/// No shared keys: a single-account/items-key pull (live vault-join harness).
pub(crate) async fn sync_cloud_pull_with(
    pool: &DbPool,
    key: &[u8; 32],
    workspace_id: &str,
    server_url: &str,
    token: &str,
) -> Result<PullOutcome, CloudFail> {
    sync_cloud_pull_with_keys(
        pool,
        WriterKey::Explicit(*key),
        &HashMap::new(),
        workspace_id,
        server_url,
        token,
    )
    .await
}

/// Cloud pull with the note→shared-key map from the app session, so v6
/// envelopes addressed to a collaborator key decrypt instead of being skipped.
pub(crate) async fn sync_cloud_pull_with_keys(
    pool: &DbPool,
    key: WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    workspace_id: &str,
    server_url: &str,
    token: &str,
) -> Result<PullOutcome, CloudFail> {
    sync_cloud_pull_impl(pool, key, shared_keys, workspace_id, None, server_url, token).await
}

/// Single-note pull for the shared-with-me path: exactly one note under the
/// note's owning workspace id, skipping the member-scoped `/sync/state` list.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn sync_cloud_pull_note_with_keys(
    pool: &DbPool,
    key: WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    workspace_id: &str,
    note_id: &str,
    server_url: &str,
    token: &str,
) -> Result<PullOutcome, CloudFail> {
    sync_cloud_pull_impl(pool, key, shared_keys, workspace_id, Some(note_id), server_url, token)
        .await
}

#[allow(clippy::too_many_arguments)]
async fn sync_cloud_pull_impl(
    pool: &DbPool,
    key: WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    workspace_id: &str,
    only_note: Option<&str>,
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
    let (raw, pending, stale) = pull_all(&client, base, workspace_id, token, pool, only_note).await?;
    let pool2 = pool.clone();
    let shared = shared_keys.clone();
    let (applied, pulled) = tokio::task::spawn_blocking(move || {
        decode_append_store_guarded(&pool2, key, &shared, raw, pending, stale)
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
    // Fail fast while locked; the sealing key is read under the migration
    // barrier by the apply closure (`WriterKey::Session`).
    let pool = writer_gate(app)?;
    let shared = crate::shared::shared_note_keys(app.state::<AppState>().inner())
        .map_err(CloudFail::Fatal)?;
    sync_cloud_pull_with_keys(
        &pool,
        WriterKey::Session(app.clone()),
        &shared,
        workspace_id,
        server_url,
        token,
    )
    .await
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
    sync_cloud_push_with_keys(
        pool,
        WriterKey::Explicit(*key),
        &HashMap::new(),
        &HashSet::new(),
        device,
        now_ms,
        workspace_id,
        server_url,
        token,
    )
    .await
}

/// Cloud push with the note→shared-key map from the app session. Shared notes
/// seal under their collaboration key (v6); personal notes stay items-key (v5).
/// Notes in `expected_shared` with no registered key are deferred (finding C1).
pub(crate) async fn sync_cloud_push_with_keys(
    pool: &DbPool,
    key: WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    expected_shared: &HashSet<String>,
    device: &str,
    now_ms: u64,
    workspace_id: &str,
    server_url: &str,
    token: &str,
) -> Result<PushOutcome, CloudFail> {
    sync_cloud_push_impl(
        pool,
        key,
        shared_keys,
        expected_shared,
        device,
        now_ms,
        workspace_id,
        server_url,
        token,
        None,
        &HashSet::new(),
    )
    .await
}

/// Single-note push for the shared-with-me path: exactly one note under the
/// note's owning workspace id.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn sync_cloud_push_note_with_keys(
    pool: &DbPool,
    key: WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    expected_shared: &HashSet<String>,
    device: &str,
    now_ms: u64,
    workspace_id: &str,
    note_id: &str,
    server_url: &str,
    token: &str,
) -> Result<PushOutcome, CloudFail> {
    sync_cloud_push_impl(
        pool,
        key,
        shared_keys,
        expected_shared,
        device,
        now_ms,
        workspace_id,
        server_url,
        token,
        Some(note_id),
        &HashSet::new(),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn sync_cloud_push_impl(
    pool: &DbPool,
    key: WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    expected_shared: &HashSet<String>,
    device: &str,
    now_ms: u64,
    workspace_id: &str,
    server_url: &str,
    token: &str,
    only_note: Option<&str>,
    skip_notes: &HashSet<String>,
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
        let shared = shared_keys.clone();
        let expected = expected_shared.clone();
        let only_note = only_note.map(|s| s.to_string());
        let skip_notes = skip_notes.clone();
        blocking(move || {
            collect_dirty_guarded(
                &pool,
                key,
                &shared,
                &expected,
                &device,
                now_ms,
                only_note.as_deref(),
                &skip_notes,
            )
        })
        .await?
    };
    let client = http_client().map_err(CloudFail::Fatal)?;
    let base = server_url.trim_end_matches('/').to_string();
    let report = push_items(&client, &base, workspace_id, token, device, &items, &attempted).await?;
    if !report.attempted.is_empty() {
        let attempted = report.attempted;
        let pool = pool.clone();
        blocking(move || store_push_acks(&pool, &attempted)).await?;
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
    // Fail fast while locked; the sealing key is read under the migration
    // barrier by the collect closure (`WriterKey::Session`).
    let pool = writer_gate(app)?;
    let shared = crate::shared::shared_note_keys(app.state::<AppState>().inner())
        .map_err(CloudFail::Fatal)?;
    let expected = crate::shared::expected_shared_notes(app.state::<AppState>().inner())
        .map_err(CloudFail::Fatal)?;
    // Notes owned by a *different* workspace (shared-with-me) are excluded from
    // the active-workspace push; their content syncs through `sync_cloud_note`.
    // A note whose owning workspace is the one being pushed is never skipped, so
    // a member who also holds an invitation row still syncs it normally.
    let skip: HashSet<String> =
        crate::shared::foreign_shared_notes(app.state::<AppState>().inner())
            .map_err(CloudFail::Fatal)?
            .into_iter()
            .filter(|(_, owner)| owner != workspace_id)
            .map(|(note, _)| note)
            .collect();
    let device = blocking({
        let pool = pool.clone();
        move || get_or_create_device_id(&pool)
    })
    .await?;
    let now_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    sync_cloud_push_impl(
        &pool,
        WriterKey::Session(app.clone()),
        &shared,
        &expected,
        &device,
        now_ms,
        workspace_id,
        server_url,
        token,
        None,
        &skip,
    )
    .await
}

/// Pull then push exactly one shared-with-me note under its owning workspace
/// id. The background loop stays scoped to the active workspace; this is the
/// note-scoped path an invited non-member uses. Both phases use the session
/// shared-key ring, so the note seals/opens under its collaboration key.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn sync_cloud_note(
    app: &AppHandle,
    note_id: &str,
    workspace_id: &str,
    server_url: &str,
    token: &str,
) -> Result<(PullOutcome, PushOutcome), CloudFail> {
    if unconfigured(workspace_id, token) || note_id.trim().is_empty() {
        return Ok((
            PullOutcome {
                pulled: 0,
                applied: Vec::new(),
            },
            PushOutcome {
                pushed: 0,
                unauthorized: false,
                note_ids: Vec::new(),
            },
        ));
    }
    let pool = writer_gate(app)?;
    let shared = crate::shared::shared_note_keys(app.state::<AppState>().inner())
        .map_err(CloudFail::Fatal)?;
    let expected = crate::shared::expected_shared_notes(app.state::<AppState>().inner())
        .map_err(CloudFail::Fatal)?;
    let device = blocking({
        let pool = pool.clone();
        move || get_or_create_device_id(&pool)
    })
    .await?;
    let now_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    let pull = sync_cloud_pull_note_with_keys(
        &pool,
        WriterKey::Session(app.clone()),
        &shared,
        workspace_id,
        note_id,
        server_url,
        token,
    )
    .await?;
    let push = sync_cloud_push_note_with_keys(
        &pool,
        WriterKey::Session(app.clone()),
        &shared,
        &expected,
        &device,
        now_ms,
        workspace_id,
        note_id,
        server_url,
        token,
    )
    .await?;
    Ok((pull, push))
}

#[cfg(test)]
mod tests {
    #[test]
    fn chunk_caps_match_server_limits() {
        assert_eq!(super::chunk_sizes(&[1024; 101]).len(), 3); // 50-item cap
        assert_eq!(super::chunk_sizes(&[3 * 1024 * 1024; 2]).len(), 2); // 5MB cap
        // A single >5MB item is isolated so a 413 can be reported for that one
        // item instead of wedging the whole push (finding C6).
        assert_eq!(
            super::chunk_sizes(&[6 * 1024 * 1024, 1024]),
            vec![(0, 1), (1, 2)]
        );
        assert_eq!(super::chunk_sizes(&[]), Vec::<(usize, usize)>::new());
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
    fn accepted_without_checkpoints_acks_the_whole_chunk() {
        use std::collections::{HashMap, HashSet};
        let order: Vec<String> = vec!["A".into(), "B".into()];
        // accepted == item count with no checkpoints map: ack the whole chunk
        // so cursors still advance (finding C7).
        let full = super::PushResp {
            accepted: 2,
            duplicate: 0,
            checkpoints: None,
            checkpoint: None,
        };
        let expected: HashSet<String> = ["A".to_string(), "B".to_string()].into_iter().collect();
        assert_eq!(super::chunk_acks(&order, 2, &full), expected);

        // Partial acceptance with no map must NOT ack.
        let partial = super::PushResp {
            accepted: 1,
            duplicate: 0,
            checkpoints: None,
            checkpoint: None,
        };
        assert!(super::chunk_acks(&order, 2, &partial).is_empty());

        // A real per-note checkpoints map still wins.
        let map: HashMap<String, serde_json::Value> = [(
            "A".to_string(),
            serde_json::json!({"d": {"ts": 1, "sequence": 1}}),
        )]
        .into_iter()
        .collect();
        let with_map = super::PushResp {
            accepted: 2,
            duplicate: 0,
            checkpoints: Some(map),
            checkpoint: None,
        };
        assert_eq!(
            super::chunk_acks(&order, 2, &with_map),
            ["A".to_string()].into_iter().collect()
        );

        // Single-note singular checkpoint fallback.
        let single = super::PushResp {
            accepted: 1,
            duplicate: 0,
            checkpoints: None,
            checkpoint: Some(serde_json::json!({"ts": 1})),
        };
        assert!(super::chunk_acks(&["A".to_string()], 1, &single).contains("A"));
    }

    #[test]
    fn checkpoint_from_updates_takes_per_device_high_water() {
        let updates = vec![
            super::RemoteUpdate {
                key: "n~~devA~~1000~~1.yjs.json".into(),
                data: String::new(),
            },
            super::RemoteUpdate {
                key: "n~~devA~~1000~~3.yjs.json".into(),
                data: String::new(),
            },
            super::RemoteUpdate {
                key: "n~~devB~~900~~2.yjs.json".into(),
                data: String::new(),
            },
        ];
        let cp = super::checkpoint_from_updates(&updates).expect("derived checkpoint");
        assert_eq!(cp["devA"]["ts"], 1000);
        assert_eq!(cp["devA"]["sequence"], 3);
        assert_eq!(cp["devB"]["ts"], 900);
        assert_eq!(cp["devB"]["sequence"], 2);
        // Unparseable and snapshot keys contribute nothing.
        assert!(super::checkpoint_from_updates(&[
            super::RemoteUpdate {
                key: "junk".into(),
                data: String::new(),
            },
            super::RemoteUpdate {
                key: "n~~snapshot~~devA~~5.yjs.json".into(),
                data: String::new(),
            },
        ])
        .is_none());
    }

    #[test]
    fn cursor_advances_for_note_with_no_pushable_rows() {
        use std::collections::{HashMap, HashSet};
        let (pool, root) = unique_temp_db("beaver-skip-rows-cursor");
        let app_key = [5u8; 32];
        let foreign = [6u8; 32];
        // Row encrypted under a key this push cannot open: collect_dirty skips
        // it but records the note's high-water mark in `attempted`.
        crate::db::yjs_append(&pool, "bad", b"bytes", "dev", Some(foreign)).expect("append");
        let (items, attempted) =
            super::collect_dirty(&pool, &app_key, &HashMap::new(), &HashSet::new(), "dev", 5000)
                .expect("collect");
        assert!(items.is_empty(), "no pushable items expected");
        assert!(attempted.contains_key("bad"), "high-water recorded");
        let cursors = super::acked_cursors(&items, &attempted, &[]);
        super::store_push_acks(&pool, &cursors).expect("acks");
        assert!(
            crate::db::db_get(&pool, &super::pushed_key("bad"), None)
                .unwrap()
                .is_some(),
            "cursor must advance past un-pushable rows (finding C4)"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The active-workspace push must never collect a note owned by another
    /// workspace (a shared-with-me note in the active db), and the note-scoped
    /// path must collect exactly the one note it names.
    #[test]
    fn collect_dirty_skips_foreign_notes_and_only_note_restricts() {
        use std::collections::{HashMap, HashSet};
        let (pool, root) = unique_temp_db("beaver-foreign-skip");
        let app_key = [5u8; 32];
        crate::db::yjs_append(&pool, "mine", &valid_update("a"), "dev", Some(app_key))
            .expect("append mine");
        crate::db::yjs_append(&pool, "foreign", &valid_update("b"), "dev", Some(app_key))
            .expect("append foreign");

        let skip: HashSet<String> = ["foreign".to_string()].into_iter().collect();
        let (items, _) = super::collect_dirty_filtered(
            &pool,
            &app_key,
            &HashMap::new(),
            &HashSet::new(),
            "dev",
            5000,
            None,
            &skip,
        )
        .expect("collect active");
        let ids: Vec<String> = items.iter().map(|i| i.note_id.clone()).collect();
        assert_eq!(
            ids,
            vec!["mine".to_string()],
            "a foreign-owned note must be excluded from the active push"
        );

        let (items, _) = super::collect_dirty_filtered(
            &pool,
            &app_key,
            &HashMap::new(),
            &HashSet::new(),
            "dev",
            5000,
            Some("foreign"),
            &HashSet::new(),
        )
        .expect("collect one");
        let ids: Vec<String> = items.iter().map(|i| i.note_id.clone()).collect();
        assert_eq!(
            ids,
            vec!["foreign".to_string()],
            "only_note pins the shared note"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn decode_append_store_skips_bad_rows_instead_of_failing() {
        use std::collections::HashMap;
        let (pool, root) = unique_temp_db("beaver-bad-row");
        let key = [5u8; 32];
        let good = v5_envelope(&key, "good", 1000, &valid_update("hello"));
        let raw = vec![
            (
                "bad".to_string(),
                super::RemoteUpdate {
                    key: "bad~~d~~1000~~1.yjs.json".into(),
                    data: "!!!not-base64!!!".into(),
                },
            ),
            (
                "good".to_string(),
                super::RemoteUpdate {
                    key: "good~~d~~1000~~1.yjs.json".into(),
                    data: b64(&good),
                },
            ),
            (
                "bad2".to_string(),
                super::RemoteUpdate {
                    key: "not-a-commit-key".into(),
                    data: b64(&good),
                },
            ),
        ];
        let mut pending = HashMap::new();
        pending.insert(
            "bad".to_string(),
            serde_json::json!({"d": {"ts": 1000, "sequence": 1}}),
        );
        let (applied, pulled) =
            match super::decode_append_store(&pool, &key, &HashMap::new(), raw, pending, Vec::new())
            {
                Ok(v) => v,
                Err(_) => panic!("one bad row must not fail the whole pull (finding C5)"),
            };
        assert!(applied.contains(&"good".to_string()));
        assert_eq!(pulled, 1);
        assert!(
            crate::db::db_get(&pool, &super::ckpt_key("bad"), None)
                .unwrap()
                .is_none(),
            "the malformed note's checkpoint must be held, not advanced"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// C11: an authentic-but-corrupt update (decrypts fine, not a valid yjs
    /// update) must hold its note's checkpoint instead of advancing past it.
    #[test]
    fn decode_append_store_holds_checkpoint_for_corrupt_update() {
        use std::collections::HashMap;
        let (pool, root) = unique_temp_db("beaver-corrupt-update");
        let key = [5u8; 32];
        let envelope = v5_envelope(&key, "n1", 1000, b"authentic but corrupt");
        let raw = vec![(
            "n1".to_string(),
            super::RemoteUpdate {
                key: "n1~~d~~1000~~1.yjs.json".into(),
                data: b64(&envelope),
            },
        )];
        let mut pending = HashMap::new();
        pending.insert(
            "n1".to_string(),
            serde_json::json!({"d": {"ts": 1000, "sequence": 1}}),
        );
        let result =
            super::decode_append_store(&pool, &key, &HashMap::new(), raw, pending, Vec::new());
        assert!(result.is_ok());
        assert!(
            crate::db::db_get(&pool, &super::ckpt_key("n1"), None)
                .unwrap()
                .is_none(),
            "a corrupt-but-authentic update must hold the checkpoint (finding C11)"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn acked_cursors_do_not_jump_over_rejected_chunks() {
        use std::collections::{HashMap, HashSet};
        let item = |note: &str, row_id: i64, seq: u64| super::PushItem {
            note_id: note.to_string(),
            row_id,
            key: String::new(),
            data: String::new(),
            device: "d".to_string(),
            ts: 0,
            seq,
            size: 0,
        };
        // Note A spans two chunks; its batch-wide high-water mark is row 4.
        let items = vec![
            item("A", 1, 11),
            item("A", 2, 12),
            item("A", 3, 13),
            item("A", 4, 14),
        ];
        let global: HashMap<String, (i64, u64)> =
            [("A".to_string(), (4, 14))].into_iter().collect();

        // Chunk 0 (rows 1-2) accepted; chunk 1 (rows 3-4) rejected with a 401.
        let rejected = vec![
            (0..2, ["A".to_string()].into_iter().collect::<HashSet<_>>()),
            (2..4, HashSet::new()),
        ];
        let cursors = super::acked_cursors(&items, &global, &rejected);
        assert_eq!(
            cursors.get("A"),
            Some(&(2, 12)),
            "cursor must stop at the last acked chunk, never jump to the global high-water mark"
        );

        // Every chunk accepted: the note may advance to the global mark so
        // deliberately-skipped trailing rows do not pin the queue.
        let all = vec![
            (0..2, ["A".to_string()].into_iter().collect::<HashSet<_>>()),
            (2..4, ["A".to_string()].into_iter().collect::<HashSet<_>>()),
        ];
        let cursors = super::acked_cursors(&items, &global, &all);
        assert_eq!(cursors.get("A"), Some(&(4, 14)));
    }

    #[test]
    fn checkpoint_held_when_a_note_partially_decrypts() {
        use std::collections::HashMap;
        let raw: HashMap<String, usize> = [("n1".to_string(), 3), ("n2".to_string(), 1)]
            .into_iter()
            .collect();
        // n1 dropped one update, n2 decoded fully.
        let decoded: HashMap<String, usize> = [("n1".to_string(), 2), ("n2".to_string(), 1)]
            .into_iter()
            .collect();
        assert!(!super::fully_decoded_counts(&raw, &decoded, "n1"));
        assert!(super::fully_decoded_counts(&raw, &decoded, "n2"));
        assert!(!super::fully_decoded_counts(&raw, &decoded, "absent"));
        let none: HashMap<String, usize> = HashMap::new();
        assert!(!super::fully_decoded_counts(&raw, &none, "n1"));
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

    fn v6_envelope(seal_key: &[u8; 32], note: &str, ts: u64, update: &[u8]) -> Vec<u8> {
        let aad = format!("{note}-{ts}");
        let (iv, enc) = crate::shared::aead_encrypt_bytes(seal_key, update, &aad).unwrap();
        serde_json::to_vec(&serde_json::json!({
            "v": crate::shared::SHARED_PAYLOAD_VERSION,
            "meta": { "device": "d", "ts": ts as i64, "sequence": 1, "noteId": note },
            "iv": iv,
            "enc": enc,
        }))
        .unwrap()
    }

    fn v5_envelope(seal_key: &[u8; 32], note: &str, ts: u64, update: &[u8]) -> Vec<u8> {
        let aad = format!("{note}-{ts}");
        let (iv, enc) = crate::shared::aead_encrypt_bytes(seal_key, update, &aad).unwrap();
        serde_json::to_vec(&serde_json::json!({
            "v": crate::shared::SYNC_PAYLOAD_VERSION,
            "meta": { "device": "d", "ts": ts as i64, "sequence": 1, "noteId": note },
            "iv": iv,
            "enc": enc,
        }))
        .unwrap()
    }

    fn b64(bytes: &[u8]) -> String {
        use base64::Engine as _;
        super::BASE64.encode(bytes)
    }

    fn valid_update(text: &str) -> Vec<u8> {
        use yrs::{Doc, ReadTxn, StateVector, Text, Transact};
        let doc = Doc::new();
        let t = doc.get_or_insert_text("t");
        let mut txn = doc.transact_mut();
        t.insert(&mut txn, 0, text);
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    #[test]
    fn v6_shared_key_decrypts_across_accounts_but_not_without_it() {
        let account_a = [1u8; 32];
        let account_b = [2u8; 32];
        let shared = [9u8; 32];
        let note = "n-shared";
        let update = b"cross-account update".to_vec();
        let raw = v6_envelope(&shared, note, 1000, &update);

        // A different account's items key cannot open v6, but the shared key can.
        assert!(super::decrypt_remote_update(&account_b, &[], &raw, note, "d", 1000, 1).is_none());
        assert!(super::decrypt_remote_update(&account_a, &[], &raw, note, "d", 1000, 1).is_none());
        let out = super::decrypt_remote_update(&account_b, &[shared], &raw, note, "d", 1000, 1)
            .expect("shared key must decrypt a peer's v6 update");
        assert_eq!(out.3, update);
    }

    /// L8: after a collaborator is removed and the note key rotated, older v6
    /// rows sealed with the previous key must still decrypt while new content
    /// seals under the newest key. An unknown key ring fails closed.
    #[test]
    fn shared_key_ring_decrypts_older_generation_and_seals_newest() {
        let app = [3u8; 32];
        let old = [7u8; 32];
        let new = [8u8; 32];
        let note = "n-rotated";
        let old_raw = v6_envelope(&old, note, 1000, b"pre-rotation");
        let new_raw = v6_envelope(&new, note, 1001, b"post-rotation");

        // Newest-first ring opens both rows.
        assert_eq!(
            super::decrypt_remote_update(&app, &[new, old], &old_raw, note, "d", 1000, 1)
                .expect("previous key must still open pre-rotation history")
                .3,
            b"pre-rotation".to_vec()
        );
        assert_eq!(
            super::decrypt_remote_update(&app, &[new, old], &new_raw, note, "d", 1001, 1)
                .expect("current key opens post-rotation content")
                .3,
            b"post-rotation".to_vec()
        );
        // Dropping the previous generation makes the old row unreadable: the
        // fail-closed property is real, not a fallback to the items key.
        assert!(
            super::decrypt_remote_update(&app, &[new], &old_raw, note, "d", 1000, 1).is_none()
        );
        assert!(
            super::decrypt_remote_update(&app, &[[9u8; 32]], &new_raw, note, "d", 1001, 1).is_none()
        );
    }

    #[test]
    fn legacy_v5_items_key_rows_stay_readable() {
        let account = [3u8; 32];
        let other = [4u8; 32];
        let note = "n-legacy";
        let update = b"personal update".to_vec();
        let raw = v5_envelope(&account, note, 2000, &update);

        let out = super::decrypt_remote_update(&account, &[], &raw, note, "d", 2000, 1)
            .expect("v5 stays readable with the items key");
        assert_eq!(out.3, update);
        // Byte identity holds: the wrong items key fails closed.
        assert!(super::decrypt_remote_update(&other, &[], &raw, note, "d", 2000, 1).is_none());
    }

    #[test]
    fn collect_dirty_seals_registered_shared_note_as_v6() {
        use std::{fs, time::SystemTime};

        let ts = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock ok")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("beaver-shared-seal-{ts}-{}", std::process::id()));
        let _ = fs::create_dir_all(&root);
        let pool = crate::db::open_pool(&root.join("data.db")).expect("pool");

        let app_key = [5u8; 32];
        let shared = [6u8; 32];
        crate::db::yjs_append(&pool, "shared-note", b"update-a", "dev", Some(app_key))
            .expect("append shared");
        crate::db::yjs_append(&pool, "personal-note", b"update-b", "dev", Some(app_key))
            .expect("append personal");

        let shared_keys: std::collections::HashMap<String, Vec<[u8; 32]>> =
            [("shared-note".to_string(), vec![shared])].into_iter().collect();
        let (items, _) = super::collect_dirty(
            &pool,
            &app_key,
            &shared_keys,
            &std::collections::HashSet::new(),
            "dev",
            5000,
        )
        .expect("collect");

        let decode = |s: &str| {
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, s).expect("b64")
        };
        let version_for = |note: &str| -> u8 {
            let item = items.iter().find(|i| i.note_id == note).expect("item");
            let raw = decode(&item.data);
            let env: serde_json::Value = serde_json::from_slice(&raw).expect("json");
            env.get("v").and_then(|v| v.as_u64()).expect("v") as u8
        };
        assert_eq!(version_for("shared-note"), crate::shared::SHARED_PAYLOAD_VERSION);
        assert_eq!(version_for("personal-note"), crate::shared::SYNC_PAYLOAD_VERSION);

        // The shared-note envelope opens with the shared key, not the app key.
        let item = items.iter().find(|i| i.note_id == "shared-note").unwrap();
        let raw = decode(&item.data);
        let note = "shared-note";
        assert!(super::decrypt_remote_update(&app_key, &[shared], &raw, note, "dev", 5000, 1).is_some());
        assert!(super::decrypt_remote_update(&app_key, &[], &raw, note, "dev", 5000, 1).is_none());

        let _ = fs::remove_dir_all(&root);
    }

    /// L8: a rotated note's ring seals new content with the newest key (index 0)
    /// even though an older key is retained for decrypting history.
    #[test]
    fn collect_dirty_seals_rotated_note_with_newest_key() {
        use std::collections::{HashMap, HashSet};

        let (pool, root) = unique_temp_db("beaver-rotate-seal");
        let app_key = [5u8; 32];
        let old = [6u8; 32];
        let new = [7u8; 32];
        crate::db::yjs_append(&pool, "shared-note", b"update-a", "dev", Some(app_key))
            .expect("append shared");

        let ring: HashMap<String, Vec<[u8; 32]>> =
            [("shared-note".to_string(), vec![new, old])].into_iter().collect();
        let (items, _) = super::collect_dirty(
            &pool,
            &app_key,
            &ring,
            &HashSet::new(),
            "dev",
            6000,
        )
        .expect("collect");
        let item = items.iter().find(|i| i.note_id == "shared-note").expect("item");
        let raw = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &item.data)
            .expect("b64");
        let note = "shared-note";
        assert!(
            super::decrypt_remote_update(&app_key, &[new], &raw, note, "dev", 6000, 1).is_some(),
            "new content must seal under the newest key"
        );
        assert!(
            super::decrypt_remote_update(&app_key, &[old], &raw, note, "dev", 6000, 1).is_none(),
            "older key must not open newly sealed content"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    fn unique_temp_db(prefix: &str) -> (crate::db::DbPool, std::path::PathBuf) {
        use std::time::SystemTime;
        let ts = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock ok")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("{prefix}-{ts}-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&root);
        let pool = crate::db::open_pool(&root.join("data.db")).expect("pool");
        (pool, root)
    }

    /// C1: a note the client marks shared, but whose collaboration key is not
    /// registered yet, must not be sealed with the account items key and must
    /// not have its push cursor advanced. Registering the key resumes the push
    /// as v6.
    #[test]
    fn collect_dirty_defers_expected_shared_note_without_key() {
        use std::collections::{HashMap, HashSet};

        let (pool, root) = unique_temp_db("beaver-defer-shared");
        let app_key = [5u8; 32];
        let shared = [6u8; 32];
        crate::db::yjs_append(&pool, "shared-note", b"update-a", "dev", Some(app_key))
            .expect("append shared");
        crate::db::yjs_append(&pool, "personal-note", b"update-b", "dev", Some(app_key))
            .expect("append personal");

        let expected: HashSet<String> = ["shared-note".to_string()].into_iter().collect();
        let no_keys: HashMap<String, Vec<[u8; 32]>> = HashMap::new();

        // Marked shared, no key registered: the note is deferred entirely.
        let (items, attempted) =
            super::collect_dirty(&pool, &app_key, &no_keys, &expected, "dev", 5000).expect("collect");
        assert!(
            !items.iter().any(|i| i.note_id == "shared-note"),
            "expected-shared note with no key must not be sealed"
        );
        assert!(
            !attempted.contains_key("shared-note"),
            "the push cursor must not advance past the deferred rows"
        );
        // Personal notes keep the exact v5 items-key behaviour.
        let personal = items
            .iter()
            .find(|i| i.note_id == "personal-note")
            .expect("personal note still pushed");
        let decode =
            |s: &str| base64::Engine::decode(&base64::engine::general_purpose::STANDARD, s).unwrap();
        let personal_env: serde_json::Value = serde_json::from_slice(&decode(&personal.data)).unwrap();
        assert_eq!(
            personal_env["v"].as_u64().unwrap(),
            crate::shared::SYNC_PAYLOAD_VERSION as u64
        );

        // Ack everything actually sent: only the personal cursor advances.
        let all: HashSet<String> = items.iter().map(|i| i.note_id.clone()).collect();
        let cursors = super::acked_cursors(&items, &attempted, &[(0..items.len(), all)]);
        super::store_push_acks(&pool, &cursors).expect("acks");
        assert!(crate::db::db_get(&pool, &super::pushed_key("personal-note"), None)
            .unwrap()
            .is_some());
        assert!(crate::db::db_get(&pool, &super::pushed_key("shared-note"), None)
            .unwrap()
            .is_none());

        // Registration resumes the push: now the note seals v6 and is eligible.
        let keys: HashMap<String, Vec<[u8; 32]>> =
            [("shared-note".to_string(), vec![shared])].into_iter().collect();
        let (items2, attempted2) =
            super::collect_dirty(&pool, &app_key, &keys, &expected, "dev", 5001).expect("collect");
        let item = items2
            .iter()
            .find(|i| i.note_id == "shared-note")
            .expect("sealed once the key lands");
        let env: serde_json::Value = serde_json::from_slice(&decode(&item.data)).unwrap();
        assert_eq!(
            env["v"].as_u64().unwrap(),
            crate::shared::SHARED_PAYLOAD_VERSION as u64
        );
        assert!(attempted2.contains_key("shared-note"));

        let _ = std::fs::remove_dir_all(&root);
    }

    /// C1: a personal (unmarked) note still seals v5 and round-trips with the
    /// items key, exactly as before the deferral.
    #[test]
    fn collect_dirty_seals_personal_note_v5_and_round_trips() {
        use std::collections::{HashMap, HashSet};

        let (pool, root) = unique_temp_db("beaver-personal-v5");
        let app_key = [5u8; 32];
        let update = b"personal payload".to_vec();
        crate::db::yjs_append(&pool, "personal-note", &update, "dev", Some(app_key))
            .expect("append personal");

        let (items, _) = super::collect_dirty(
            &pool,
            &app_key,
            &HashMap::new(),
            &HashSet::new(),
            "dev",
            7000,
        )
        .expect("collect");
        let item = items
            .iter()
            .find(|i| i.note_id == "personal-note")
            .expect("personal sealed");
        let raw = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &item.data)
            .expect("b64");
        let env: serde_json::Value = serde_json::from_slice(&raw).expect("json");
        assert_eq!(
            env["v"].as_u64().unwrap(),
            crate::shared::SYNC_PAYLOAD_VERSION as u64
        );
        // A peer with the items key round-trips; a different key fails closed.
        let (_, _, _, bytes) =
            super::decrypt_remote_update(&app_key, &[], &raw, "personal-note", "dev", 7000, 1)
                .expect("items key opens v5");
        assert_eq!(bytes, update);
        assert!(
            super::decrypt_remote_update(&[9u8; 32], &[], &raw, "personal-note", "dev", 7000, 1)
                .is_none()
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// C2: the push seal and the pull append are sealing writers that must
    /// block while a key migration holds the barrier, then proceed once it is
    /// released (primitive-level, like the migration guard test).
    #[test]
    fn sync_sealing_writers_block_while_migration_barrier_held() {
        use std::collections::{HashMap, HashSet};
        use std::sync::mpsc;
        use std::time::Duration;

        let (pool, root) = unique_temp_db("beaver-writer-barrier");
        let key = [5u8; 32];
        crate::db::yjs_append(&pool, "personal-note", b"update", "dev", Some(key)).expect("append");

        for writer in ["push-seal", "pull-append"] {
            let guard = crate::shared::begin_migration();
            let (tx, rx) = mpsc::channel();
            let pool = pool.clone();
            let handle = std::thread::spawn(move || {
                if writer == "push-seal" {
                    let _ = super::collect_dirty_guarded(
                        &pool,
                        super::WriterKey::Explicit([5u8; 32]),
                        &HashMap::new(),
                        &HashSet::new(),
                        "dev",
                        5000,
                        None,
                        &HashSet::new(),
                    );
                } else {
                    let _ = super::decode_append_store_guarded(
                        &pool,
                        super::WriterKey::Explicit([5u8; 32]),
                        &HashMap::new(),
                        Vec::new(),
                        HashMap::new(),
                        Vec::new(),
                    );
                }
                tx.send(()).expect("send");
            });

            assert!(
                rx.recv_timeout(Duration::from_millis(75)).is_err(),
                "{writer} must block while the migration guard is held"
            );
            drop(guard);
            assert!(
                rx.recv_timeout(Duration::from_secs(5)).is_ok(),
                "{writer} must proceed once the migration guard is released"
            );
            handle.join().expect("join");
        }

        let _ = std::fs::remove_dir_all(&root);
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
