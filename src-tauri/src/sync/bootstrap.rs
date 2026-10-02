//! Cloud workspace seeding: port of `_seedCloudOptimized`
//! (`src/utils/sync/transports/cloud.js:845-1161`). Initializes a fresh cloud
//! workspace from this device's local Yjs state: claim -> publish vault key
//! params -> presigned snapshot upload -> asset seed -> complete -> verify.
//!
//! Wired by Task 10's scheduler; not called from here yet.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Deserialize;
use tauri::{AppHandle, Manager};
use yrs::{updates::decoder::Decode, Doc, Transact, Update};

use super::assets::{encode_asset_key, live_note_ids, list_remote_assets, seed_batch_upload_assets};
use super::cloud::{valid_note_id, CloudFail, META_DOC_ID, WriterKey};
use super::local::get_or_create_device_id;
use super::remote::CloudClient;
use crate::db::{self, DbPool};
use crate::shared::{
    aead_decrypt_bytes, aead_decrypt_json, aead_encrypt_bytes, app_storage_dir, data_pool,
    publish_key_params, sync_key_params_path, write_barrier, AppError, AppState, SyncEnvelope,
    PROTOCOL_VERSION, SHARED_PAYLOAD_VERSION, SYNC_PAYLOAD_VERSION,
};

/// Local asset root (`ASSET_TYPES` in `src/utils/sync/constants.js`); mirrors
/// `sync/assets.rs` and is deliberately not exported there.
const ASSET_DIR: &str = "assets";
/// Backend `/assets/seed-batch` caps, mirroring `buildSeedAssetBatches`
/// (`cloud.js:49-50`).
const SEED_BATCH_MAX_ITEMS: usize = 50;
const SEED_BATCH_MAX_BYTES: usize = 10 * 1024 * 1024;

fn seed_fail(phase: &str, message: &str) -> CloudFail {
    CloudFail::Fatal(AppError::Other(format!("sync: seed[{phase}]: {message}")))
}

fn fail_str(e: &CloudFail) -> String {
    match e {
        CloudFail::Typed(t) => t.status_str().to_string(),
        CloudFail::Unauthorized => "unauthorized".to_string(),
        CloudFail::Fatal(err) => err.to_string(),
    }
}

/// Build the JS-compatible snapshot envelope
/// `{v:5, meta:{device,ts,sequence:0,noteId}, iv, enc}` for a merged Yjs state.
/// AAD is `{note_id}-{ts}`, matching the JS seed (`cloud.js:988`) — the
/// snapshot bytes are the envelope JSON itself, no extra base64 layer.
fn seed_snapshot_envelope(
    key: &[u8; 32],
    device: &str,
    note_id: &str,
    ts: u64,
    update: &[u8],
) -> Result<Vec<u8>, AppError> {
    seed_snapshot_envelope_versioned(key, SYNC_PAYLOAD_VERSION, device, note_id, ts, update)
}

/// Same envelope with an explicit `v`: v5 (items key) for personal notes, v6
/// (shared note/workspace key) for collaborative ones, so a seeded shared
/// workspace is readable by every member, not just the seeding account.
fn seed_snapshot_envelope_versioned(
    key: &[u8; 32],
    version: u8,
    device: &str,
    note_id: &str,
    ts: u64,
    update: &[u8],
) -> Result<Vec<u8>, AppError> {
    let aad = format!("{note_id}-{ts}");
    let (iv, enc) = aead_encrypt_bytes(key, update, &aad)?;
    let envelope = serde_json::json!({
        "v": version,
        "meta": { "device": device, "ts": ts as i64, "sequence": 0, "noteId": note_id },
        "iv": iv,
        "enc": enc,
    });
    Ok(serde_json::to_vec(&envelope)?)
}

/// Key + envelope version to seal a snapshot with: a registered shared key
/// (per-note key, or workspace key for `meta`) yields v6, else v5 + items key.
fn snapshot_seal(
    app_key: &[u8; 32],
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    note_id: &str,
) -> ([u8; 32], u8) {
    match shared_keys.get(note_id).and_then(|keys| keys.first().copied()) {
        Some(k) => (k, SHARED_PAYLOAD_VERSION),
        None => (*app_key, SYNC_PAYLOAD_VERSION),
    }
}

fn json_truthy(v: &serde_json::Value) -> bool {
    match v {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        serde_json::Value::String(s) => !s.is_empty(),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => true,
    }
}

enum Gate {
    Proceed,
    Skip,
}

fn state_path(workspace_id: &str) -> String {
    format!(
        "/sync/state?workspaceId={}",
        urlencoding::encode(workspace_id)
    )
}

/// True only for the exact `initialized` status, the sole outcome the JS
/// claim-conflict path treats as "another device won" (`cloud.js:902`).
fn is_initialized_state(state: &serde_json::Value) -> bool {
    state.get("status").and_then(|s| s.as_str()) == Some("initialized")
}

/// `GET /sync/state` gate. A 404 or 403 is a skip (new/inaccessible
/// workspace), a malformed payload is fatal, and only an authoritatively
/// empty or stalled-init workspace proceeds. An initialized workspace whose
/// `vault` is present but falsy is a hard error (missing encryption params).
async fn state_gate(client: &CloudClient, workspace_id: &str) -> Result<Gate, CloudFail> {
    let state = match client
        .get_json_opt::<serde_json::Value>(&state_path(workspace_id))
        .await
    {
        Ok(Some(state)) => state,
        Ok(None) => {
            crate::rs_log!("[sync::bootstrap] state probe: 404 workspace state -> skip");
            return Ok(Gate::Skip);
        }
        Err(CloudFail::Unauthorized) => {
            crate::rs_log!("[sync::bootstrap] state probe: inaccessible workspace (401/403) -> skip");
            return Ok(Gate::Skip);
        }
        Err(e) => return Err(e),
    };
    let malformed = || {
        CloudFail::Fatal(AppError::Other(
            "sync: remote sync state payload is malformed".into(),
        ))
    };
    let obj = state.as_object().ok_or_else(malformed)?;
    let status = obj
        .get("status")
        .and_then(|s| s.as_str())
        .ok_or_else(malformed)?;
    if !["empty", "initializing", "initialized", "recovering"].contains(&status) {
        return Err(malformed());
    }
    let documents = obj
        .get("documents")
        .and_then(|d| d.as_array())
        .ok_or_else(malformed)?;
    let vault_falsy = obj
        .get("vault")
        .map(|v| !json_truthy(v))
        .unwrap_or(false);
    if status == "initialized" && vault_falsy {
        return Err(seed_fail(
            "verify",
            "cloud sync is initialized but its encryption parameters are missing",
        ));
    }
    let initialization_expired = obj
        .get("initializationExpired")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    // `documents` is non-empty as soon as the workspace has any yjs updates
    // (see `listDocuments`' UNION with `yjs_doc_updates`), so requiring an
    // empty document set would skip a never-initialized workspace forever.
    // Claiming from `empty` is always allowed; contention is resolved by the
    // claim itself (a losing device yields on 409).
    let empty = status == "empty";
    // A completed-but-never-finished init must wait for its claim to expire
    // before the server lets this device re-claim it.
    let stalled = status == "initializing"
        && (documents.is_empty() || initialization_expired);
    if empty || stalled {
        crate::rs_log!("[sync::bootstrap] state gate: proceed (status={status})");
        Ok(Gate::Proceed)
    } else {
        crate::rs_log!("[sync::bootstrap] state gate: skip (status={status})");
        Ok(Gate::Skip)
    }
}

/// Publish this device's vault key params (`vault-key-params.js:74-96`):
/// ensure the local file exists, base64 its RAW bytes, then hand the blob to
/// the shared [`super::vault::publish_cloud_key_params`] (challenge -> proof
/// over the blob -> `PUT`).
async fn publish_seed_key_params(
    app: &AppHandle,
    client: &CloudClient,
    workspace_id: &str,
) -> Result<(), CloudFail> {
    let blob_b64 = {
        let state = app.state::<AppState>();
        let inner = state.inner();
        // Derived from the encryption manifest; JS base64s `readData(p)` and
        // derives the proof over that exact blob (`vault-key-params.js:80-93`).
        publish_key_params(app, inner).map_err(CloudFail::Fatal)?;
        let path = sync_key_params_path(app, inner)
            .map_err(CloudFail::Fatal)?
            .ok_or_else(|| seed_fail("publish", "local vault key params path unavailable"))?;
        let raw = std::fs::read(&path).map_err(|e| {
            CloudFail::Fatal(AppError::Other(format!(
                "sync: seed[publish]: read key params file failed: {e}"
            )))
        })?;
        BASE64.encode(&raw)
    };
    super::vault::publish_cloud_key_params(app, client, workspace_id, &blob_b64).await
}

struct SeedSnapshot {
    note_id: String,
    ts: u64,
    bytes: Vec<u8>,
}

/// `SELECT DISTINCT note_id FROM note_content`, excluding the `meta` doc
/// (seeded separately) and filtered by the same note-id regex the cloud push
/// uses. This is the Rust source of the JS `workspaceDoc.getMap('notes')` set.
fn distinct_note_ids(pool: &DbPool) -> Result<Vec<String>, AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT note_id FROM note_content WHERE note_id != ?1")
        .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = stmt
        .query_map(rusqlite::params![META_DOC_ID], |row| row.get::<_, String>(0))
        .map_err(|e| AppError::Other(e.to_string()))?;
    let mut ids = Vec::new();
    for row in rows {
        let id = row.map_err(|e| AppError::Other(e.to_string()))?;
        if valid_note_id(&id) {
            ids.push(id);
        }
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}

/// Merge each note's stored history (`yjs_snapshots` + `note_content`, via the
/// same helper behind the `yjs:getSnapshot` command) into one state update and
/// encrypt a seed envelope. Empty states are skipped, and a per-note read or
/// encrypt failure is logged and skipped (`cloud.js:995`).
async fn assemble_snapshots(
    pool: &DbPool,
    key: WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    now_ms: u64,
) -> Result<Vec<SeedSnapshot>, CloudFail> {
    let (pool, shared_keys) = (pool.clone(), shared_keys.clone());
    tokio::task::spawn_blocking(move || -> Result<Vec<SeedSnapshot>, AppError> {
        // Resolve the items key and seal every snapshot under the migration
        // read barrier (finding C2): one guarded span for key read + seal.
        let _barrier = write_barrier();
        let key = key.resolve()?;
        let device = get_or_create_device_id(&pool)?;
        let mut out: Vec<SeedSnapshot> = Vec::new();
        let meta = db::yjs_get_snapshot(&pool, META_DOC_ID, Some(key))?;
        if !meta.is_empty() {
            let (seal, version) = snapshot_seal(&key, &shared_keys, META_DOC_ID);
            let bytes =
                seed_snapshot_envelope_versioned(&seal, version, &device, META_DOC_ID, now_ms, &meta)?;
            out.push(SeedSnapshot {
                note_id: META_DOC_ID.to_string(),
                ts: now_ms,
                bytes,
            });
        }
        for note in distinct_note_ids(&pool)? {
            match db::yjs_get_snapshot(&pool, &note, Some(key)) {
                Ok(state) if !state.is_empty() => {
                    let note_ts = now_ms + out.len() as u64;
                    let (seal, version) = snapshot_seal(&key, &shared_keys, &note);
                    match seed_snapshot_envelope_versioned(&seal, version, &device, &note, note_ts, &state) {
                        Ok(bytes) => out.push(SeedSnapshot {
                            note_id: note,
                            ts: note_ts,
                            bytes,
                        }),
                        Err(e) => {
                            crate::rs_log!("[sync::bootstrap] skipping envelope {note}: {e}")
                        }
                    }
                }
                Ok(_) => {}
                Err(e) => crate::rs_log!("[sync::bootstrap] skipping note {note}: {e}"),
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| CloudFail::Fatal(AppError::Other(e.to_string())))?
    .map_err(CloudFail::Fatal)
}

fn enumerate_assets(
    base: &Path,
    workspace_id: &str,
    live: &HashSet<String>,
) -> Vec<(String, String, PathBuf)> {
    let mut out = Vec::new();
    let note_dirs = match std::fs::read_dir(base) {
        Ok(rd) => rd,
        Err(_) => return out,
    };
    for entry in note_dirs.flatten() {
        let Some(note_id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if note_id.starts_with('.') || !entry.path().is_dir() {
            continue;
        }
        // Liveness filter, same as the steady-state asset differ: never seed
        // files under notes that no longer exist in this workspace.
        if !live.contains(&note_id) {
            continue;
        }
        let files = match std::fs::read_dir(entry.path()) {
            Ok(rd) => rd,
            Err(e) => {
                crate::rs_log!("[sync::bootstrap] readDir failed for {note_id}: {e}");
                continue;
            }
        };
        for file in files.flatten() {
            let Some(filename) = file.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if filename.starts_with('.') || !file.path().is_file() {
                continue;
            }
            match encode_asset_key(ASSET_DIR, workspace_id, &note_id, &filename) {
                Ok(flat) => out.push((flat, note_id.clone(), file.path())),
                Err(e) => {
                    crate::rs_log!("[sync::bootstrap] skipping invalid asset key {note_id}/{filename}: {e}")
                }
            }
        }
    }
    out
}

fn seed_asset_batches(
    entries: Vec<(String, String, Vec<u8>)>,
) -> Vec<Vec<(String, String, Vec<u8>)>> {
    seed_asset_batches_with(entries, SEED_BATCH_MAX_ITEMS, SEED_BATCH_MAX_BYTES)
}

/// Port of `buildSeedAssetBatches` (`cloud.js:52-82`): sort ascending by size,
/// oversized items become their own batch, otherwise pack while item count and
/// byte total stay within the caps.
fn seed_asset_batches_with(
    mut entries: Vec<(String, String, Vec<u8>)>,
    max_items: usize,
    max_bytes: usize,
) -> Vec<Vec<(String, String, Vec<u8>)>> {
    entries.sort_by_key(|(_, _, data)| data.len());
    let mut batches: Vec<Vec<(String, String, Vec<u8>)>> = Vec::new();
    let mut current: Vec<(String, String, Vec<u8>)> = Vec::new();
    let mut current_bytes = 0usize;
    for entry in entries {
        let size = entry.2.len();
        if size > max_bytes {
            if !current.is_empty() {
                batches.push(std::mem::take(&mut current));
                current_bytes = 0;
            }
            batches.push(vec![entry]);
            continue;
        }
        if current.len() >= max_items || current_bytes + size > max_bytes {
            batches.push(std::mem::take(&mut current));
            current_bytes = 0;
        }
        current_bytes += size;
        current.push(entry);
    }
    if !current.is_empty() {
        batches.push(current);
    }
    batches
}

/// Seed local assets missing remotely. `required` is every local flat key
/// (sent to `complete`); only the missing subset is uploaded. Remote listing
/// failure, unreadable/empty files, and per-batch upload failures log and
/// continue, mirroring the JS seed.
async fn seed_assets(
    app: &AppHandle,
    client: &CloudClient,
    key: &WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    workspace_id: &str,
) -> Result<Vec<String>, CloudFail> {
    let base = {
        let state = app.state::<AppState>();
        app_storage_dir(app, state.inner())
            .map_err(CloudFail::Fatal)?
            .join(ASSET_DIR)
    };
    let local: Vec<(String, String, PathBuf)> = {
        // Liveness filter, same as the steady-state asset differ: never seed
        // files under notes that no longer exist in this workspace.
        let pool = data_pool(app, app.state::<AppState>().inner()).map_err(CloudFail::Fatal)?;
        let live = live_note_ids(&pool).map_err(CloudFail::Fatal)?;
        enumerate_assets(&base, workspace_id, &live)
    };
    let required: Vec<String> = local.iter().map(|(k, _, _)| k.clone()).collect();
    if local.is_empty() {
        return Ok(required);
    }

    let remote: Option<HashSet<String>> = match list_remote_assets(client).await {
        Ok(keys) => Some(keys.into_iter().collect()),
        Err(e) => {
            crate::rs_log!(
                "[sync::bootstrap] list remote assets failed, uploading all: {}",
                fail_str(&e)
            );
            None
        }
    };
    let mut to_upload: Vec<(String, String, Vec<u8>)> = Vec::new();
    for (flat_key, note_id, path) in &local {
        if remote.as_ref().is_some_and(|r| r.contains(flat_key)) {
            continue;
        }
        match std::fs::read(path) {
            Ok(data) if !data.is_empty() => {
                to_upload.push((flat_key.clone(), note_id.clone(), data))
            }
            Ok(_) => crate::rs_log!("[sync::bootstrap] skipping empty asset {flat_key}"),
            Err(e) => {
                crate::rs_log!("[sync::bootstrap] skipping unreadable asset {flat_key}: {e}")
            }
        }
    }

    let batches = seed_asset_batches(to_upload);
    for (idx, batch) in batches.iter().enumerate() {
        if let Err(e) = seed_batch_upload_assets(client, key, shared_keys, batch).await {
            crate::rs_log!(
                "[sync::bootstrap] asset batch {}/{} failed: {}",
                idx + 1,
                batches.len(),
                fail_str(&e)
            );
        }
    }
    Ok(required)
}

/// Initialize a fresh cloud workspace from this device. Returns `true` when
/// this device seeded it, `false` when there was nothing to seed or another
/// device won initialization.
pub(crate) async fn seed_cloud_workspace(
    app: &AppHandle,
    workspace_id: &str,
    server_url: &str,
    token: &str,
) -> Result<bool, CloudFail> {
    if workspace_id.trim().is_empty() || token.is_empty() {
        return Ok(false);
    }
    let client = CloudClient::new(server_url, token).map_err(CloudFail::Fatal)?;

    match state_gate(&client, workspace_id).await? {
        Gate::Skip => return Ok(false),
        Gate::Proceed => {}
    }

    // Fail fast while locked; the sealing key is read under the migration
    // barrier inside each sealing closure (`WriterKey::Session`, C2).
    let pool = super::cloud::writer_gate(app)?;
    let shared = crate::shared::shared_note_keys(app.state::<AppState>().inner())
        .map_err(CloudFail::Fatal)?;

    // Claim. Any failure re-probes the state: if another device initialized
    // meanwhile, this device simply yields (`cloud.js:894-907`).
    let claim: serde_json::Value = match client
        .post_json(
            "/sync/initialize/claim",
            &serde_json::json!({ "workspaceId": workspace_id }),
        )
        .await
    {
        Ok(claim) => claim,
        Err(e) => {
            // Only an exact `initialized` status means another device won; any
            // other state (initializing/recovering/empty-with-docs) is still
            // this workspace mid-init, so propagate the original claim error.
            match client
                .get_json_opt::<serde_json::Value>(&state_path(workspace_id))
                .await
            {
                Ok(Some(latest)) if is_initialized_state(&latest) => {
                    crate::rs_log!(
                        "[sync::bootstrap] claim failed; workspace initialized elsewhere -> skip"
                    );
                    return Ok(false);
                }
                _ => return Err(e),
            }
        }
    };
    let claim_token = claim
        .get("token")
        .and_then(|t| t.as_str())
        .filter(|t| !t.is_empty())
        .ok_or_else(|| seed_fail("claim", "initialization claim missing token"))?
        .to_string();

    publish_seed_key_params(app, &client, workspace_id).await?;

    let now_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    let snapshots =
        assemble_snapshots(&pool, WriterKey::Session(app.clone()), &shared, now_ms).await?;
    if snapshots.is_empty() {
        return Err(seed_fail("snapshot", "nothing to push"));
    }

    let note_ids: Vec<String> = snapshots.iter().map(|s| s.note_id.clone()).collect();
    let urls_resp: SnapshotUrlsResp = client
        .post_json(
            "/sync/initialize/snapshot-urls",
            &serde_json::json!({
                "workspaceId": workspace_id,
                "token": claim_token,
                "noteIds": note_ids,
            }),
        )
        .await?;
    let urls = urls_resp.urls.unwrap_or_default();
    if urls.len() != snapshots.len() {
        return Err(seed_fail("upload", "presign incomplete"));
    }
    let generation = urls_resp.generation;

    let mut documents = Vec::with_capacity(snapshots.len());
    for snap in &snapshots {
        let Some(presigned) = urls.get(&snap.note_id) else {
            return Err(seed_fail("upload", "presign incomplete"));
        };
        client
            .put_presigned(&presigned.url, snap.bytes.clone())
            .await?;
        documents.push(serde_json::json!({
            "noteId": snap.note_id,
            "snapshotGeneration": generation,
            "snapshotKey": presigned.key,
            "checkpointTs": 0,
            "checkpointSequence": 0,
            "snapshotTs": snap.ts,
        }));
    }

    let required_assets =
        seed_assets(app, &client, &WriterKey::Session(app.clone()), &shared, workspace_id).await?;

    let _: serde_json::Value = client
        .post_json(
            "/sync/initialize/complete",
            &serde_json::json!({
                "workspaceId": workspace_id,
                "token": claim_token,
                "generation": generation,
                "documents": documents,
                "assets": required_assets,
            }),
        )
        .await?;

    // Verify before reporting green: server state initialized and key params readable.
    let ws = urlencoding::encode(workspace_id);
    let verify = client
        .get_json_opt::<serde_json::Value>(&format!("/sync/state?workspaceId={ws}"))
        .await?;
    let initialized = verify
        .as_ref()
        .and_then(|v| v.get("status"))
        .and_then(|s| s.as_str())
        == Some("initialized");
    if !initialized {
        return Err(seed_fail("verify", "server did not confirm initialization"));
    }
    let readable = super::vault::fetch_cloud_key_params(&client, workspace_id)
        .await?
        .is_some();
    if !readable {
        return Err(seed_fail("verify", "vault key params not readable after publish"));
    }

    crate::rs_log!("[sync::bootstrap] seed completed: {} snapshots", snapshots.len());
    Ok(true)
}

#[derive(Deserialize)]
struct SnapshotUrlsResp {
    #[serde(default)]
    urls: Option<HashMap<String, PresignedSnapshot>>,
    #[serde(default)]
    generation: serde_json::Value,
}

#[derive(Deserialize)]
struct PresignedSnapshot {
    url: String,
    key: String,
}

/// Server `documents` entry that carries a seeded snapshot: the same fields
/// the JS bootstrap filters on (`snapshotKey` + `noteId`, `cloud.js:158-160`).
#[derive(Clone)]
struct BootstrapDoc {
    note_id: String,
    snapshot_ts: Option<u64>,
    note_ts: Option<u64>,
}

fn parse_bootstrap_docs(state: &serde_json::Value) -> Vec<BootstrapDoc> {
    let Some(arr) = state.get("documents").and_then(|d| d.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|d| {
            let note_id = d.get("noteId")?.as_str()?.to_string();
            let has_snapshot_key = d
                .get("snapshotKey")
                .and_then(|k| k.as_str())
                .is_some_and(|k| !k.is_empty());
            if !has_snapshot_key {
                return None;
            }
            Some(BootstrapDoc {
                note_id,
                snapshot_ts: d.get("snapshotTs").and_then(|v| v.as_u64()),
                note_ts: d.get("noteTs").and_then(|v| v.as_u64()),
            })
        })
        .collect()
}

/// Yjs decode/apply probe: a cached snapshot is usable only if it decodes and
/// integrates cleanly. Mirrors JS `cachedSnapshotIsCorrupt` (`cloud.js:168-181`).
fn is_valid_yjs_update(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }
    let doc = Doc::new();
    let mut txn = doc.transact_mut();
    match Update::decode_v1(bytes) {
        Ok(update) => txn.apply_update(update).is_ok(),
        Err(_) => false,
    }
}

/// True when the local cached snapshot is missing, empty, or corrupt, so
/// bootstrap re-downloads the authoritative copy (JS `needsBootstrap`,
/// `cloud.js:182-187`).
fn snapshot_needs_bootstrap(cached: Option<&[u8]>) -> bool {
    match cached {
        None => true,
        Some(bytes) => !is_valid_yjs_update(bytes),
    }
}

/// AAD suffixes to try, in order: server `snapshotTs` first, then the document
/// `noteTs` when it differs (`candidateSuffixesFor`, `cloud.js:254-258`).
fn candidate_aad_suffixes(snapshot_ts: Option<u64>, note_ts: Option<u64>) -> Vec<u64> {
    let mut out = Vec::new();
    if let Some(ts) = snapshot_ts {
        out.push(ts);
    }
    if let Some(ts) = note_ts {
        if !out.contains(&ts) {
            out.push(ts);
        }
    }
    out
}

/// Document-side fallback AAD timestamp: the document `noteTs` when present,
/// else its `snapshotTs` (JS `doc.noteTs ?? doc.snapshotTs`, `cloud.js:223,255`).
/// Rust-seeded workspaces write only `snapshotTs`, so this keeps a candidate
/// available even when the download-URL response omits/differs `snapshotTs`.
fn doc_fallback_aad_ts(note_ts: Option<u64>, snapshot_ts: Option<u64>) -> Option<u64> {
    note_ts.or(snapshot_ts)
}

/// Decrypt a seeded snapshot envelope, trying each candidate AAD in turn and
/// returning the first that authenticates; `None` (fail closed) if none do.
///
/// v5 carries the raw Yjs update bytes under `iv`/`enc`; legacy v4 carries a
/// JSON number array in the decrypted `update` field. Both mirror
/// `sync_decrypt_batch` (`commands/security.rs`), so a v4-seeded workspace
/// bootstraps instead of failing closed per note.
fn decrypt_snapshot_envelope(
    key: &[u8; 32],
    note_id: &str,
    snapshot_ts: Option<u64>,
    note_ts: Option<u64>,
    raw: &[u8],
) -> Option<Vec<u8>> {
    decrypt_snapshot_envelope_shared(key, &[], note_id, snapshot_ts, note_ts, raw)
}

/// Same as [`decrypt_snapshot_envelope`], plus v6 support: a v6 snapshot was
/// sealed with the note's shared collaboration key (per-note key, or the
/// workspace key for `meta`), so a non-seeding member can bootstrap it.
fn decrypt_snapshot_envelope_shared(
    key: &[u8; 32],
    shared_keys: &[[u8; 32]],
    note_id: &str,
    snapshot_ts: Option<u64>,
    note_ts: Option<u64>,
    raw: &[u8],
) -> Option<Vec<u8>> {
    let env: serde_json::Value = serde_json::from_slice(raw).ok()?;
    let v = env.get("v").and_then(|v| v.as_u64())? as u8;
    if v != SYNC_PAYLOAD_VERSION && v != PROTOCOL_VERSION && v != SHARED_PAYLOAD_VERSION {
        return None;
    }
    let iv = env.get("iv")?.as_str()?;
    let enc = env.get("enc")?.as_str()?;
    for ts in candidate_aad_suffixes(snapshot_ts, note_ts) {
        let aad = format!("{note_id}-{ts}");
        if v == SHARED_PAYLOAD_VERSION {
            if let Some(bytes) = shared_keys
                .iter()
                .find_map(|shared| aead_decrypt_bytes(shared, iv, enc, &aad).ok())
            {
                return Some(bytes);
            }
        } else if v == SYNC_PAYLOAD_VERSION {
            if let Ok(bytes) = aead_decrypt_bytes(key, iv, enc, &aad) {
                return Some(bytes);
            }
        } else {
            let legacy = SyncEnvelope {
                v,
                iv: iv.to_string(),
                enc: enc.to_string(),
            };
            if let Ok(value) = aead_decrypt_json(key, &legacy, &aad) {
                return Some(
                    value
                        .get("update")?
                        .as_array()?
                        .iter()
                        .filter_map(|n| n.as_u64().map(|u| u as u8))
                        .collect(),
                );
            }
        }
    }
    None
}

#[derive(Deserialize)]
struct SnapshotDownloadResp {
    #[serde(default)]
    urls: Option<HashMap<String, SnapshotDownloadUrl>>,
}

#[derive(Deserialize)]
struct SnapshotDownloadUrl {
    url: String,
    #[serde(rename = "snapshotTs", default)]
    snapshot_ts: Option<u64>,
}

struct DownloadedSnapshot {
    note_id: String,
    bytes: Vec<u8>,
    snapshot_ts: Option<u64>,
    note_ts: Option<u64>,
}

/// Bootstrap a fresh device from the server's seeded snapshots: download,
/// decrypt (multi-AAD fallback), append, compact, and advance the per-note
/// vector. Returns the note ids applied locally.
///
/// History restore is deliberately deferred to Phase B (ledger ruling T8):
/// rebuilding a note from `GET /commits/history` + `GET /commits/{hash}`
/// requires Tiptap `generateJSON` and `y-prosemirror`
/// `prosemirrorJSONToYDoc`, which are JS-only with no Rust equivalent. No
/// fake port and no JS shim lives here; notes without a usable snapshot are
/// left for the Phase B JS path.
pub(crate) async fn bootstrap_from_snapshots(
    app: &AppHandle,
    workspace_id: &str,
    server_url: &str,
    token: &str,
) -> Result<(Vec<String>, bool), CloudFail> {
    if workspace_id.trim().is_empty() || token.is_empty() {
        return Ok((Vec::new(), false));
    }
    let (key, pool) = super::cloud::unlock_gate(app)?;
    let shared = crate::shared::shared_note_keys(app.state::<AppState>().inner())
        .map_err(CloudFail::Fatal)?;
    let client = CloudClient::new(server_url, token).map_err(CloudFail::Fatal)?;

    let state = match client
        .get_json_opt::<serde_json::Value>(&state_path(workspace_id))
        .await?
    {
        Some(state) => state,
        None => return Ok((Vec::new(), false)),
    };
    let docs = parse_bootstrap_docs(&state);
    if docs.is_empty() {
        return Ok((Vec::new(), false));
    }

    // Cached local snapshots decide which notes actually need a download. A
    // read failure mirrors the JS `.catch(() => ({}))`: treat all as missing
    // and re-download the authoritative copies.
    let all_ids: Vec<String> = docs.iter().map(|d| d.note_id.clone()).collect();
    let cached = {
        let (pool, ids) = (pool.clone(), all_ids);
        match tokio::task::spawn_blocking(move || db::yjs_get_snapshots(&pool, &ids, Some(key)))
            .await
            .map_err(|e| CloudFail::Fatal(AppError::Other(e.to_string())))?
        {
            Ok(map) => map,
            Err(e) => {
                crate::rs_log!("[sync::bootstrap] local snapshot read failed, treating all as missing: {e}");
                HashMap::new()
            }
        }
    };
    let needs: Vec<&BootstrapDoc> = docs
        .iter()
        .filter(|d| snapshot_needs_bootstrap(cached.get(&d.note_id).map(Vec::as_slice)))
        .collect();
    if needs.is_empty() {
        // Nothing outstanding: the device already has every snapshot.
        return Ok((Vec::new(), true));
    }
    crate::rs_log!(
        "[sync::bootstrap] {} notes need snapshot download",
        needs.len()
    );

    // Presign download URLs, 50 notes per request.
    let mut urls: HashMap<String, SnapshotDownloadUrl> = HashMap::new();
    for batch in needs.chunks(50) {
        let note_ids: Vec<&str> = batch.iter().map(|d| d.note_id.as_str()).collect();
        let resp: SnapshotDownloadResp = match client
            .post_json(
                "/sync/snapshot-download-urls",
                &serde_json::json!({ "workspaceId": workspace_id, "noteIds": note_ids }),
            )
            .await
        {
            Ok(resp) => resp,
            Err(CloudFail::Unauthorized) => return Err(CloudFail::Unauthorized),
            Err(e) => {
                crate::rs_log!(
                    "[sync::bootstrap] snapshot download urls failed: {}",
                    fail_str(&e)
                );
                return Ok((Vec::new(), false));
            }
        };
        urls.extend(resp.urls.unwrap_or_default());
    }
    if urls.is_empty() {
        crate::rs_log!("[sync::bootstrap] no snapshot urls returned");
        return Ok((Vec::new(), false));
    }

    // Download with bounded concurrency; a per-note failure logs and skips.
    let doc_fallback_ts: HashMap<&str, Option<u64>> = docs
        .iter()
        .map(|d| (d.note_id.as_str(), doc_fallback_aad_ts(d.note_ts, d.snapshot_ts)))
        .collect();
    let entries: Vec<(String, SnapshotDownloadUrl)> = urls.into_iter().collect();
    let mut downloaded: Vec<DownloadedSnapshot> = Vec::new();
    for chunk in entries.chunks(4) {
        let futures = chunk.iter().map(|(note_id, dl)| {
            let client = &client;
            let note_id = note_id.clone();
            async move {
                match client.get_presigned(&dl.url).await {
                    Ok(Some(bytes)) if !bytes.is_empty() => {
                        Some((note_id, dl.snapshot_ts, bytes))
                    }
                    Ok(_) => {
                        crate::rs_log!("[sync::bootstrap] empty snapshot for {note_id}");
                        None
                    }
                    Err(e) => {
                        crate::rs_log!(
                            "[sync::bootstrap] snapshot download failed for {note_id}: {}",
                            fail_str(&e)
                        );
                        None
                    }
                }
            }
        });
        for (note_id, snapshot_ts, bytes) in futures_util::future::join_all(futures)
            .await
            .into_iter()
            .flatten()
        {
            let note_ts = doc_fallback_ts
                .get(note_id.as_str())
                .copied()
                .flatten()
                .or(snapshot_ts);
            downloaded.push(DownloadedSnapshot {
                note_id,
                bytes,
                snapshot_ts,
                note_ts,
            });
        }
    }
    if downloaded.is_empty() {
        crate::rs_log!("[sync::bootstrap] no snapshots downloaded");
        return Ok((Vec::new(), false));
    }

    // Decrypt each snapshot, trying both AAD forms; fail closed per note.
    let mut decrypted: Vec<(String, Vec<u8>)> = Vec::new();
    for item in &downloaded {
        match decrypt_snapshot_envelope_shared(
            &key,
            shared.get(&item.note_id).map(|v| v.as_slice()).unwrap_or(&[]),
            &item.note_id,
            item.snapshot_ts,
            item.note_ts,
            &item.bytes,
        ) {
            Some(update) => decrypted.push((item.note_id.clone(), update)),
            None => crate::rs_log!(
                "[sync::bootstrap] snapshot failed to decrypt for {} (fail closed)",
                item.note_id
            ),
        }
    }
    if decrypted.is_empty() {
        return Ok((Vec::new(), false));
    }

    // Append + compact + advance vector, per-note log-and-continue.
    let writer = WriterKey::Session(app.clone());
    let applied = tokio::task::spawn_blocking(move || -> Result<Vec<String>, AppError> {
        // Resolve the items key under the migration read barrier and keep it
        // for the whole append/compact/vector span (finding C2).
        let _barrier = write_barrier();
        let key = writer.resolve()?;
        let device = get_or_create_device_id(&pool)?;
        let mut applied = Vec::new();
        for (note_id, update) in decrypted {
            if let Err(e) = db::yjs_append(&pool, &note_id, &update, &device, Some(key)) {
                crate::rs_log!("[sync::bootstrap] append failed for {note_id}: {e}");
                continue;
            }
            if let Err(e) = db::yjs_compact_batch(&pool, &note_id, Some(key)) {
                crate::rs_log!("[sync::bootstrap] compact failed for {note_id}: {e}");
            }
            if let Err(e) = super::merge::refresh_vector(&pool, &note_id, Some(key)) {
                crate::rs_log!("[sync::bootstrap] vector refresh failed for {note_id}: {e}");
            }
            applied.push(note_id);
        }
        Ok(applied)
    })
    .await
    .map_err(|e| CloudFail::Fatal(AppError::Other(e.to_string())))?
    .map_err(CloudFail::Fatal)?;

    crate::rs_log!(
        "[sync::bootstrap] applied {}/{} snapshots",
        applied.len(),
        downloaded.len()
    );
    // Latch the retry guard only when every needed note applied; a partial
    // pass leaves the guard clear so the failed notes retry next tick (the
    // successful ones now have a local snapshot and drop out of `needs`).
    let complete = bootstrap_complete(applied.len(), needs.len());
    Ok((applied, complete))
}

/// Bootstrap may latch its retry guard only once every needed snapshot applied.
pub(crate) fn bootstrap_complete(applied: usize, needed: usize) -> bool {
    needed > 0 && applied >= needed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::aead_decrypt_bytes;

    #[test]
    fn seed_snapshot_envelope_round_trips() {
        let key = [7u8; 32];
        let update = b"merged-yjs-state-bytes".to_vec();
        let raw = seed_snapshot_envelope(&key, "device-1", "note-1", 1234, &update).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&raw).unwrap();
        assert_eq!(value["v"], SYNC_PAYLOAD_VERSION);
        assert_eq!(value["meta"]["device"], "device-1");
        assert_eq!(value["meta"]["noteId"], "note-1");
        assert_eq!(value["meta"]["sequence"], 0);
        let iv = value["iv"].as_str().unwrap();
        let enc = value["enc"].as_str().unwrap();

        let out = aead_decrypt_bytes(&key, iv, enc, "note-1-1234").unwrap();
        assert_eq!(out, update);

        // Wrong AAD and wrong key both fail closed.
        assert!(aead_decrypt_bytes(&key, iv, enc, "note-1-9999").is_err());
        assert!(aead_decrypt_bytes(&[8u8; 32], iv, enc, "note-1-1234").is_err());
    }

    #[test]
    fn is_initialized_state_only_matches_initialized() {
        assert!(is_initialized_state(
            &serde_json::json!({ "status": "initialized", "documents": [] })
        ));
        // Any other state is still an in-progress init, never "another device won".
        for status in ["empty", "initializing", "recovering"] {
            assert!(!is_initialized_state(
                &serde_json::json!({ "status": status, "documents": [{"noteId": "n1"}] })
            ));
        }
        assert!(!is_initialized_state(&serde_json::json!({})));
    }

    #[test]
    fn seed_asset_batches_respect_item_cap() {
        let entries: Vec<(String, String, Vec<u8>)> = (0..51)
            .map(|i| (format!("k{i}"), "n".to_string(), vec![0u8; 1]))
            .collect();
        let batches = seed_asset_batches(entries);
        assert_eq!(batches.len(), 2);
        assert_eq!(batches[0].len(), 50);
        assert_eq!(batches[1].len(), 1);
    }

    #[test]
    fn seed_asset_batches_respect_byte_cap_and_oversized() {
        let entries = vec![
            ("a".to_string(), "n".to_string(), vec![0u8; 6]),
            ("b".to_string(), "n".to_string(), vec![0u8; 6]),
            ("c".to_string(), "n".to_string(), vec![0u8; 11]),
        ];
        let batches = seed_asset_batches_with(entries, 50, 10);
        // 6+6 would exceed 10, and 11 alone exceeds the cap -> three batches.
        assert_eq!(batches.len(), 3);
        assert_eq!(batches[0][0].0, "a");
        assert_eq!(batches[1][0].0, "b");
        assert_eq!(batches[2][0].0, "c");
    }

    #[test]
    fn seed_asset_batches_packs_ascending_by_size() {
        let entries = vec![
            ("big".to_string(), "n".to_string(), vec![0u8; 4]),
            ("small".to_string(), "n".to_string(), vec![0u8; 1]),
            ("mid".to_string(), "n".to_string(), vec![0u8; 2]),
        ];
        let batches = seed_asset_batches_with(entries, 50, 100);
        assert_eq!(batches.len(), 1);
        let order: Vec<&str> = batches[0].iter().map(|(k, _, _)| k.as_str()).collect();
        assert_eq!(order, vec!["small", "mid", "big"]);
    }

    fn valid_yjs_update() -> Vec<u8> {
        use yrs::{ReadTxn, StateVector, Text};
        let doc = Doc::new();
        let text = doc.get_or_insert_text("t");
        let mut txn = doc.transact_mut();
        text.insert(&mut txn, 0, "bootstrap");
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    #[test]
    fn snapshot_decrypt_falls_back_from_snapshot_ts_to_note_ts() {
        let key = [3u8; 32];
        let note = "note-abc";
        let snapshot_ts = 1000u64;
        let note_ts = 2000u64;
        // Seed encrypts with the document `noteTs`, while the server reports a
        // different `snapshotTs`: the first AAD fails, the second must succeed.
        let raw = seed_snapshot_envelope(&key, "device", note, note_ts, b"payload").unwrap();
        let out = decrypt_snapshot_envelope(&key, note, Some(snapshot_ts), Some(note_ts), &raw);
        assert_eq!(out.as_deref(), Some(b"payload".as_slice()));

        // The primary AAD also decrypts when it matches.
        let raw_primary =
            seed_snapshot_envelope(&key, "device", note, snapshot_ts, b"payload").unwrap();
        assert_eq!(
            decrypt_snapshot_envelope(&key, note, Some(snapshot_ts), Some(note_ts), &raw_primary)
                .as_deref(),
            Some(b"payload".as_slice())
        );

        // URL snapshotTs absent/differs: the document `snapshotTs` is the only
        // authenticating suffix. The doc-side fallback (`noteTs ?? snapshotTs`)
        // must supply it, else every note gets zero candidates and fails.
        assert_eq!(doc_fallback_aad_ts(None, Some(snapshot_ts)), Some(snapshot_ts));
        assert_eq!(doc_fallback_aad_ts(Some(note_ts), Some(snapshot_ts)), Some(note_ts));
        let raw_doc_ts = seed_snapshot_envelope(&key, "device", note, snapshot_ts, b"payload").unwrap();
        let doc_fallback = doc_fallback_aad_ts(None, Some(snapshot_ts));
        assert_eq!(candidate_aad_suffixes(None, doc_fallback), vec![snapshot_ts]);
        assert_eq!(
            decrypt_snapshot_envelope(&key, note, None, doc_fallback, &raw_doc_ts).as_deref(),
            Some(b"payload".as_slice())
        );

        // Wrong note id, wrong key, and wrong timestamps all fail closed.
        assert!(
            decrypt_snapshot_envelope(&key, "other-note", Some(snapshot_ts), Some(note_ts), &raw)
                .is_none()
        );
        assert!(
            decrypt_snapshot_envelope(&[9u8; 32], note, Some(snapshot_ts), Some(note_ts), &raw)
                .is_none()
        );
        assert!(
            decrypt_snapshot_envelope(&key, note, Some(42), Some(43), &raw).is_none()
        );
    }

    #[test]
    fn snapshot_decrypts_legacy_v4_update_array() {
        let key = [3u8; 32];
        let note = "note-legacy";
        let update = b"legacy-yjs-state".to_vec();
        let snapshot_ts = 1000u64;
        let note_ts = 2000u64;
        // v4 carries the update as a JSON number array inside the encrypted JSON.
        let plaintext = serde_json::json!({
            "update": update.iter().map(|b| *b as u64).collect::<Vec<u64>>(),
            "noteId": note,
            "device": "device",
            "ts": note_ts as i64,
            "sequence": 0,
        });
        let env = crate::shared::aead_encrypt_json(&key, &plaintext, &format!("{note}-{note_ts}"))
            .unwrap();
        let raw = serde_json::to_vec(&serde_json::json!({
            "v": PROTOCOL_VERSION,
            "iv": env.iv,
            "enc": env.enc,
        }))
        .unwrap();

        // Seeded with the document `noteTs` while the URL reports a different
        // `snapshotTs`: the AAD fallback must reach the second candidate.
        let out = decrypt_snapshot_envelope(&key, note, Some(snapshot_ts), Some(note_ts), &raw);
        assert_eq!(out.as_deref(), Some(update.as_slice()));

        // Wrong note id and wrong key fail closed.
        assert!(
            decrypt_snapshot_envelope(&key, "other-note", Some(snapshot_ts), Some(note_ts), &raw)
                .is_none()
        );
        assert!(
            decrypt_snapshot_envelope(&[9u8; 32], note, Some(snapshot_ts), Some(note_ts), &raw)
                .is_none()
        );
    }

    #[test]
    fn snapshot_needs_bootstrap_covers_missing_empty_and_corrupt() {
        assert!(snapshot_needs_bootstrap(None));
        assert!(snapshot_needs_bootstrap(Some(&[])));
        assert!(snapshot_needs_bootstrap(Some(b"definitely not a yjs update")));
        assert!(!snapshot_needs_bootstrap(Some(&valid_yjs_update())));
    }
}
