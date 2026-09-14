use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Deserialize;
use tauri::{AppHandle, Manager};

use super::cloud::{CloudFail, SyncError};
use super::remote::CloudClient;
use crate::commands::security::serialize_v5_envelope;
use crate::db::DbPool;
use crate::shared::{
    aead_decrypt_bytes, aead_decrypt_json, aead_encrypt_bytes, app_storage_dir, data_pool, AppError,
    AppState, SyncEnvelope, PROTOCOL_VERSION, SYNC_PAYLOAD_VERSION,
};

const HEX: &[u8; 16] = b"0123456789ABCDEF";

/// Single local asset root and the JS legacy encrypted-file suffix (mirrors
/// `ASSET_TYPES` / `ENCRYPTED_ASSET_EXT` in `src/utils/sync/constants.js`).
const ASSET_TYPE: &str = "assets";
const ENCRYPTED_ASSET_EXT: &str = ".enc";
/// Upload batching caps mirrored from JS `syncAssets` (10MB / 20 items).
const BATCH_MAX_BYTES: usize = 10 * 1024 * 1024;
const BATCH_MAX_ITEMS: usize = 20;
/// Presigned-GET request chunk, mirroring JS `PRESIGN_CHUNK`.
const PRESIGN_CHUNK: usize = 200;

fn safe_segment(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= 256
        && !value.contains('/')
        && !value.contains('\\')
        && !value.contains('\0')
        && value != "."
        && value != ".."
        && !value.contains("--")
        && !value.starts_with('.')
}

/// Port of ECMAScript `encodeURIComponent`: leaves `A-Z a-z 0-9 - _ . ! ~ * ' ( )`
/// unescaped and percent-encodes the UTF-8 bytes of everything else. The
/// `urlencoding` crate escapes `! * ' ( )`, which would produce different
/// server keys for ordinary filenames, so we encode by hand.
pub(crate) fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c.is_ascii_alphanumeric()
            || matches!(c, '-' | '_' | '.' | '!' | '~' | '*' | '\'' | '(' | ')')
        {
            out.push(c);
        } else {
            let mut buf = [0u8; 4];
            for byte in c.encode_utf8(&mut buf).bytes() {
                out.push('%');
                out.push(HEX[(byte >> 4) as usize] as char);
                out.push(HEX[(byte & 0x0f) as usize] as char);
            }
        }
    }
    out
}

/// Inverse of [`encode_uri_component`]. Returns `None` on malformed escapes or
/// invalid UTF-8, mirroring `decodeURIComponent` throwing.
fn decode_uri_component(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return None;
            }
            let hi = hex_val(bytes[i + 1])?;
            let lo = hex_val(bytes[i + 2])?;
            out.push((hi << 4) | lo);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[derive(Debug, PartialEq)]
pub(crate) struct AssetKey {
    pub ty: String,
    pub note_id: String,
    pub filename: String,
}

pub(crate) fn encode_asset_key(ty: &str, note_id: &str, filename: &str) -> Result<String, AppError> {
    if !safe_segment(ty) || !safe_segment(note_id) || !safe_segment(filename) {
        return Err(AppError::Other("sync: invalid asset key segment".into()));
    }
    Ok(format!(
        "{}--{}--{}",
        encode_uri_component(ty),
        encode_uri_component(note_id),
        encode_uri_component(filename)
    ))
}

pub(crate) fn decode_asset_key(key: &str) -> Option<AssetKey> {
    if key.contains('/') || key.contains('\\') || key.contains('\0') {
        return None;
    }
    let parts: Vec<&str> = key.split("--").collect();
    if parts.len() < 3 {
        return None;
    }
    let ty = decode_uri_component(parts[0])?;
    let note_id = decode_uri_component(parts[1])?;
    let filename = decode_uri_component(&parts[2..].join("--"))?;
    if !safe_segment(&ty) || !safe_segment(&note_id) || !safe_segment(&filename) {
        return None;
    }
    Some(AssetKey {
        ty,
        note_id,
        filename,
    })
}

/// True for a v4/v5 cloud asset envelope (`{"v":4|5,...}`); false for
/// non-JSON, unknown versions, and raw asset bytes. Mirrors JS
/// `isEncryptedEnvelopeBytes` (`crypto.js:112`): a byte-prefix check over the
/// first 64 bytes, never a full-payload parse, so a plaintext asset JSON with
/// a later `"v":5` field is not mistaken for an envelope.
pub(crate) fn is_encrypted_asset_envelope(raw: &[u8]) -> bool {
    if raw.len() < 6 {
        return false;
    }
    let head = &raw[..raw.len().min(64)];
    let mut i = 0;
    let skip_ws = |i: &mut usize| {
        while *i < head.len() && head[*i].is_ascii_whitespace() {
            *i += 1;
        }
    };
    skip_ws(&mut i);
    if head.get(i) != Some(&b'{') {
        return false;
    }
    i += 1;
    skip_ws(&mut i);
    if head.get(i..i + 3) != Some(b"\"v\"") {
        return false;
    }
    i += 3;
    skip_ws(&mut i);
    if head.get(i) != Some(&b':') {
        return false;
    }
    i += 1;
    skip_ws(&mut i);
    matches!(head.get(i), Some(b'4') | Some(b'5'))
}

/// Encrypt an asset payload into the JS-compatible v5 envelope
/// (`{v, meta:{asset}, iv, enc}`) with AAD `asset:<flat_key>`, matching
/// `encryptAssetBytes` -> `syncEncryptPayload`.
pub(crate) fn encrypt_asset_bytes(
    key: &[u8; 32],
    flat_key: &str,
    data: &[u8],
) -> Result<Vec<u8>, AppError> {
    #[derive(serde::Serialize)]
    struct AssetMeta<'a> {
        asset: &'a str,
    }

    let aad = format!("asset:{flat_key}");
    let (iv, enc) = aead_encrypt_bytes(key, data, &aad)?;
    // Shared v-first serializer, so the JS-parity byte-prefix detector sees it.
    let envelope = serialize_v5_envelope(&AssetMeta { asset: flat_key }, &iv, &enc)?;
    Ok(envelope.into_bytes())
}

/// Fail-closed decrypt mirroring `decrypt_remote_update`: only v5 (raw bytes)
/// and legacy v4 (`update` byte array) envelopes with AAD `asset:<flat_key>`
/// decrypt; missing fields or any other version are errors, never passthrough.
pub(crate) fn decrypt_asset_bytes(
    key: &[u8; 32],
    flat_key: &str,
    raw: &[u8],
) -> Result<Vec<u8>, AppError> {
    let env: serde_json::Value = serde_json::from_slice(raw)?;
    let version = env
        .get("v")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| AppError::Other("sync: asset envelope missing version".into()))?
        as u8;
    let iv = env
        .get("iv")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| AppError::Other("sync: asset envelope missing iv".into()))?;
    let enc = env
        .get("enc")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| AppError::Other("sync: asset envelope missing enc".into()))?;
    let aad = format!("asset:{flat_key}");

    if version == SYNC_PAYLOAD_VERSION {
        Ok(aead_decrypt_bytes(key, iv, enc, &aad)?)
    } else if version == PROTOCOL_VERSION {
        let legacy = SyncEnvelope {
            v: version,
            iv: iv.to_string(),
            enc: enc.to_string(),
        };
        let value = aead_decrypt_json(key, &legacy, &aad)?;
        Ok(value
            .get("update")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| AppError::Other("sync: asset envelope missing update".into()))?
            .iter()
            .filter_map(|n| n.as_u64().map(|u| u as u8))
            .collect())
    } else {
        Err(AppError::Other(
            "sync: unsupported asset envelope version".into(),
        ))
    }
}

/// Raw asset bytes keyed by their flat cloud key, the JS `{ key, data }`
/// transfer unit before storage.
pub(crate) struct RemoteAsset {
    pub key: String,
    pub bytes: Vec<u8>,
}

#[derive(Deserialize)]
pub(crate) struct PresignedUrl {
    pub url: String,
    #[serde(default, alias = "assetKey")]
    pub key: Option<String>,
}

#[derive(Deserialize)]
struct AssetListResp {
    keys: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct PresignBatchResp {
    urls: Option<Vec<PresignedUrl>>,
}

/// `{base}/assets/{encodeURIComponent(flatKey)}` — same escaping as the JS
/// client so server keys line up.
fn asset_url_path(flat_key: &str) -> String {
    format!("/assets/{}", encode_uri_component(flat_key))
}

/// List stored asset keys. `GET /assets`; a 404 is an empty listing. Transient
/// failures retry twice (2s, 4s) then surface, unlike the JS which swallowed
/// the third failure.
pub(crate) async fn list_remote_assets(client: &CloudClient) -> Result<Vec<String>, CloudFail> {
    let mut attempt = 0u32;
    loop {
        match client.get_json_opt::<AssetListResp>("/assets").await {
            Ok(Some(resp)) => return Ok(resp.keys.unwrap_or_default()),
            Ok(None) => return Ok(Vec::new()),
            Err(e) if attempt >= 2 || !matches!(e, CloudFail::Typed(_)) => return Err(e),
            Err(_) => {
                tokio::time::sleep(Duration::from_secs(2 * (attempt as u64 + 1))).await;
                attempt += 1;
            }
        }
    }
}

/// Encrypt-then-`PUT` one asset. A 413 means the server rejected it for size,
/// so the upload is skipped rather than failed.
pub(crate) async fn upload_asset(
    client: &CloudClient,
    key: &[u8; 32],
    flat_key: &str,
    data: &[u8],
) -> Result<(), CloudFail> {
    let encrypted = encrypt_asset_bytes(key, flat_key, data).map_err(CloudFail::Fatal)?;
    let status = client
        .put_bytes_with_status(&asset_url_path(flat_key), encrypted)
        .await?;
    if status == reqwest::StatusCode::PAYLOAD_TOO_LARGE || status.is_success() {
        return Ok(());
    }
    Err(CloudFail::Fatal(AppError::Other(format!(
        "sync: cloud request failed with status {status}"
    ))))
}

/// Encrypt each item and serialize the JS batch body
/// `{"assets":[{"key":<flatKey>,"data":<base64 envelope>}]}`.
pub(crate) fn build_batch_payload(
    key: &[u8; 32],
    items: &[(String, Vec<u8>)],
) -> Result<Vec<u8>, AppError> {
    let mut assets = Vec::with_capacity(items.len());
    for (flat_key, data) in items {
        let encrypted = encrypt_asset_bytes(key, flat_key, data)?;
        assets.push(serde_json::json!({
            "key": flat_key,
            "data": BASE64.encode(encrypted),
        }));
    }
    Ok(serde_json::to_vec(&serde_json::json!({ "assets": assets }))?)
}

async fn post_batch(
    client: &CloudClient,
    path: &str,
    key: &[u8; 32],
    items: &[(String, Vec<u8>)],
) -> Result<(), CloudFail> {
    let payload = build_batch_payload(key, items).map_err(CloudFail::Fatal)?;
    let body: serde_json::Value = serde_json::from_slice(&payload)
        .map_err(|e| CloudFail::Fatal(AppError::Serialization(e.to_string())))?;
    let _: serde_json::Value = client.post_json(path, &body).await?;
    Ok(())
}

pub(crate) async fn batch_upload_assets(
    client: &CloudClient,
    key: &[u8; 32],
    items: &[(String, Vec<u8>)],
) -> Result<(), CloudFail> {
    post_batch(client, "/assets/batch", key, items).await
}

pub(crate) async fn seed_batch_upload_assets(
    client: &CloudClient,
    key: &[u8; 32],
    items: &[(String, Vec<u8>)],
) -> Result<(), CloudFail> {
    post_batch(client, "/assets/seed-batch", key, items).await
}

/// Fetch one asset's raw bytes. A 404 or empty body is `None`; a 429/5xx
/// (mapped to `Throttled`) retries twice (2s, 4s); every other error surfaces
/// instead of being swallowed as a missing asset.
pub(crate) async fn download_asset(
    client: &CloudClient,
    flat_key: &str,
) -> Result<Option<Vec<u8>>, CloudFail> {
    let path = format!("{}/content", asset_url_path(flat_key));
    let mut attempt = 0u32;
    loop {
        match client.get_bytes(&path).await {
            Ok(None) => return Ok(None),
            Ok(Some(bytes)) => {
                return Ok(if bytes.is_empty() { None } else { Some(bytes) });
            }
            Err(CloudFail::Typed(SyncError::Throttled)) if attempt < 2 => {
                tokio::time::sleep(Duration::from_secs(2 * (attempt as u64 + 1))).await;
                attempt += 1;
            }
            Err(e) => return Err(e),
        }
    }
}

pub(crate) async fn presign_get_batch(
    client: &CloudClient,
    keys: &[String],
) -> Result<Vec<PresignedUrl>, CloudFail> {
    let body = serde_json::json!({ "keys": keys });
    let resp: PresignBatchResp = client.post_json("/assets/presign-get-batch", &body).await?;
    Ok(resp.urls.unwrap_or_default())
}

/// `DELETE /assets/{enc}`; non-fatal best-effort: the server may not implement
/// DELETE, and lingering remote assets for dead notes are an accepted Phase A
/// minor (the not-in-live-notes prune will retry next tick).
pub(crate) async fn delete_asset(client: &CloudClient, flat_key: &str) {
    if let Err(e) = client.delete(&asset_url_path(flat_key)).await {
        crate::rs_log!(
            "[sync::assets] remote prune skipped {flat_key}: {}",
            fail_str(&e)
        );
    }
}

fn fail_str(e: &CloudFail) -> String {
    match e {
        CloudFail::Typed(t) => t.status_str().to_string(),
        CloudFail::Unauthorized => "unauthorized".to_string(),
        CloudFail::Fatal(err) => err.to_string(),
    }
}

/// Local name for a remote filename, stripping the legacy `.enc` suffix.
/// Mirrors `localAssetName` (`src/utils/sync/crypto.js:106`).
pub(crate) fn local_asset_name(sync_filename: &str) -> &str {
    sync_filename
        .strip_suffix(ENCRYPTED_ASSET_EXT)
        .unwrap_or(sync_filename)
}

/// One asset transfer decision produced by [`plan_asset_ops`].
#[derive(Debug, PartialEq)]
pub(crate) enum AssetOp {
    Upload {
        flat_key: String,
        note_id: String,
        filename: String,
    },
    Download {
        flat_key: String,
        note_id: String,
        filename: String,
    },
    DeleteRemote {
        flat_key: String,
    },
}

/// Pure differ: liveness is note existence (no tombstones), so remote keys
/// whose note is gone are pruned, local files under dead notes are never
/// uploaded, and remote live keys missing locally are downloaded under their
/// `.enc`-stripped local name. `local_exists(note_id, local_name)` abstracts
/// the filesystem for testing.
pub(crate) fn plan_asset_ops(
    local_files: &[(String, String)],
    remote: &[(String, AssetKey)],
    live_note_ids: &HashSet<String>,
    local_exists: impl Fn(&str, &str) -> bool,
) -> Result<Vec<AssetOp>, AppError> {
    let mut ops = Vec::new();
    let remote_keys: HashSet<&str> = remote.iter().map(|(k, _)| k.as_str()).collect();
    for (note_id, filename) in local_files {
        if !live_note_ids.contains(note_id) {
            continue;
        }
        let flat_key = encode_asset_key(ASSET_TYPE, note_id, filename)?;
        if !remote_keys.contains(flat_key.as_str()) {
            ops.push(AssetOp::Upload {
                flat_key,
                note_id: note_id.clone(),
                filename: filename.clone(),
            });
        }
    }
    for (flat_key, decoded) in remote {
        if decoded.ty != ASSET_TYPE {
            continue;
        }
        if !live_note_ids.contains(&decoded.note_id) {
            ops.push(AssetOp::DeleteRemote {
                flat_key: flat_key.clone(),
            });
            continue;
        }
        let filename = local_asset_name(&decoded.filename);
        if !local_exists(&decoded.note_id, filename) {
            ops.push(AssetOp::Download {
                flat_key: flat_key.clone(),
                note_id: decoded.note_id.clone(),
                filename: filename.to_string(),
            });
        }
    }
    Ok(ops)
}

/// `SELECT DISTINCT note_id FROM note_content` — the liveness set that
/// replaces the JS `deletedAssets` tombstone map.
pub(crate) fn live_note_ids(pool: &DbPool) -> Result<HashSet<String>, AppError> {
    let conn = pool.get().map_err(|e| AppError::Other(e.to_string()))?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT note_id FROM note_content")
        .map_err(|e| AppError::Other(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| AppError::Other(e.to_string()))?;
    let mut ids = HashSet::new();
    for row in rows {
        ids.insert(row.map_err(|e| AppError::Other(e.to_string()))?);
    }
    Ok(ids)
}

/// Enumerate `assets/<noteId>/<file>` as `(note_id, filename)`, skipping dot
/// entries like the JS `readDir` filters. A missing base is empty, not an error.
fn walk_local_assets(base: &Path) -> Result<Vec<(String, String)>, AppError> {
    let mut out = Vec::new();
    let note_dirs = match std::fs::read_dir(base) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e.into()),
    };
    for entry in note_dirs.flatten() {
        let Some(note_id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if note_id.starts_with('.') || !entry.path().is_dir() {
            continue;
        }
        let files = match std::fs::read_dir(entry.path()) {
            Ok(rd) => rd,
            Err(e) => {
                crate::rs_log!("[sync::assets] readDir failed for {note_id}: {e}");
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
            out.push((note_id.clone(), filename));
        }
    }
    Ok(out)
}

#[derive(Deserialize)]
struct AssetSyncState {
    status: String,
}

/// Cloud asset differ: prune dead-note remotes, upload live local files missing
/// remotely, download remote live files missing locally. Returns the number of
/// files transferred (uploads + downloads). Port of `syncAssets`
/// (`src/utils/sync/transports/cloud.js:1211`), minus tombstones and the JS
/// 413-halving / 429-backoff loops (the transport retries what it retries and
/// the scheduler re-runs next tick).
pub(crate) async fn sync_cloud_assets(
    app: &AppHandle,
    workspace_id: &str,
    server_url: &str,
    token: &str,
) -> Result<u64, CloudFail> {
    if workspace_id.trim().is_empty() || token.is_empty() {
        return Ok(0);
    }
    let (key, pool) = super::cloud::unlock_gate(app)?;
    let client = CloudClient::new(server_url, token).map_err(CloudFail::Fatal)?;

    // State gate: only initialized workspaces sync assets (seeding handles the
    // rest). A 404 (`Ok(None)`) or 403 (`Unauthorized`, which `map_status`
    // cannot distinguish from 401) is a skip, not a failure. Any other error
    // (offline/throttled) propagates so the scheduler retries.
    let state_path = format!(
        "/sync/state?workspaceId={}",
        urlencoding::encode(workspace_id)
    );
    let initialized = match client.get_json_opt::<AssetSyncState>(&state_path).await {
        Ok(Some(state)) => state.status == "initialized",
        Ok(None) | Err(CloudFail::Unauthorized) => false,
        Err(e) => return Err(e),
    };
    if !initialized {
        return Ok(0);
    }

    let base = {
        let state = app.state::<AppState>();
        app_storage_dir(app, state.inner())
            .map_err(CloudFail::Fatal)?
            .join(ASSET_TYPE)
    };

    let remote: Vec<(String, AssetKey)> = list_remote_assets(&client)
        .await?
        .iter()
        .filter_map(|k| decode_asset_key(k).map(|d| (k.clone(), d)))
        .collect();

    let ops = {
        let pool = pool.clone();
        let base = base.clone();
        tokio::task::spawn_blocking(move || -> Result<Vec<AssetOp>, AppError> {
            let live = live_note_ids(&pool)?;
            let local = walk_local_assets(&base)?;
            plan_asset_ops(&local, &remote, &live, |note_id, name| {
                base.join(note_id).join(name).is_file()
            })
        })
        .await
        .map_err(|e| CloudFail::Fatal(AppError::Other(e.to_string())))?
        .map_err(CloudFail::Fatal)?
    };

    let mut transferred = 0u64;
    let mut uploads: Vec<(String, String, String)> = Vec::new();
    let mut downloads: Vec<(String, String, String)> = Vec::new();
    for op in ops {
        match op {
            AssetOp::DeleteRemote { flat_key } => delete_asset(&client, &flat_key).await,
            AssetOp::Upload {
                flat_key,
                note_id,
                filename,
            } => uploads.push((flat_key, note_id, filename)),
            AssetOp::Download {
                flat_key,
                note_id,
                filename,
            } => downloads.push((flat_key, note_id, filename)),
        }
    }

    transferred += upload_batches(&client, &key, &base, uploads).await?;
    transferred += download_missing(&client, &key, &base, downloads).await?;
    Ok(transferred)
}

/// Pack uploads into <=20-item / <=10MB batches, falling back to individual
/// `upload_asset` (which skips 413) when a batch fails. `Unauthorized` always
/// propagates; unreadable/empty local files are logged and skipped.
async fn upload_batches(
    client: &CloudClient,
    key: &[u8; 32],
    base: &Path,
    uploads: Vec<(String, String, String)>,
) -> Result<u64, CloudFail> {
    let mut batches: Vec<Vec<(String, Vec<u8>)>> = Vec::new();
    let mut current: Vec<(String, Vec<u8>)> = Vec::new();
    let mut current_bytes = 0usize;
    for (flat_key, note_id, filename) in uploads {
        match std::fs::read(base.join(&note_id).join(&filename)) {
            Ok(data) if !data.is_empty() => {
                if !current.is_empty()
                    && (current_bytes + data.len() > BATCH_MAX_BYTES
                        || current.len() >= BATCH_MAX_ITEMS)
                {
                    batches.push(std::mem::take(&mut current));
                    current_bytes = 0;
                }
                current_bytes += data.len();
                current.push((flat_key, data));
            }
            Ok(_) => crate::rs_log!("[sync::assets] skipping empty local asset {flat_key}"),
            Err(e) => {
                crate::rs_log!("[sync::assets] skipping unreadable local asset {flat_key}: {e}")
            }
        }
    }
    if !current.is_empty() {
        batches.push(current);
    }

    let mut uploaded = 0u64;
    for batch in batches {
        match batch_upload_assets(client, key, &batch).await {
            Ok(()) => uploaded += batch.len() as u64,
            Err(CloudFail::Unauthorized) => return Err(CloudFail::Unauthorized),
            Err(e) => {
                crate::rs_log!(
                    "[sync::assets] batch upload failed ({} items), falling back to individual: {}",
                    batch.len(),
                    fail_str(&e)
                );
                for (flat_key, data) in &batch {
                    match upload_asset(client, key, flat_key, data).await {
                        Ok(()) => uploaded += 1,
                        Err(CloudFail::Unauthorized) => return Err(CloudFail::Unauthorized),
                        Err(e) => crate::rs_log!(
                            "[sync::assets] individual upload failed {flat_key}: {}",
                            fail_str(&e)
                        ),
                    }
                }
            }
        }
    }
    Ok(uploaded)
}

/// Download remote keys missing locally, sequentially. Presigned URLs are
/// tried first; an absent URL or any presigned error (a 403 is an expired
/// signature, never identity loss) falls back to the authenticated
/// `download_asset`. Envelopes decrypt then write plaintext; legacy plaintext
/// writes as-is and is best-effort re-uploaded enveloped (self-healing).
async fn download_missing(
    client: &CloudClient,
    key: &[u8; 32],
    base: &Path,
    downloads: Vec<(String, String, String)>,
) -> Result<u64, CloudFail> {
    if downloads.is_empty() {
        return Ok(0);
    }
    let keys: Vec<String> = downloads.iter().map(|(k, _, _)| k.clone()).collect();
    let mut presigned: HashMap<String, String> = HashMap::new();
    for chunk in keys.chunks(PRESIGN_CHUNK) {
        match presign_get_batch(client, chunk).await {
            Ok(urls) => {
                for url in urls {
                    if let Some(asset_key) = url.key {
                        presigned.insert(asset_key, url.url);
                    }
                }
            }
            Err(e) => crate::rs_log!(
                "[sync::assets] presign-get-batch failed: {}",
                fail_str(&e)
            ),
        }
    }

    let mut downloaded = 0u64;
    for (flat_key, note_id, filename) in downloads {
        let mut raw: Option<Vec<u8>> = None;
        if let Some(url) = presigned.get(&flat_key) {
            match client.get_presigned(url).await {
                Ok(Some(bytes)) if !bytes.is_empty() => raw = Some(bytes),
                Ok(_) => crate::rs_log!(
                    "[sync::assets] presigned empty for {flat_key}; falling back"
                ),
                Err(e) => crate::rs_log!(
                    "[sync::assets] presigned get failed for {flat_key}: {}; falling back",
                    fail_str(&e)
                ),
            }
        }
        let raw = match raw {
            Some(bytes) => bytes,
            None => match download_asset(client, &flat_key).await? {
                Some(bytes) => bytes,
                None => {
                    crate::rs_log!("[sync::assets] remote asset content missing: {flat_key}");
                    continue;
                }
            },
        };

        let dest = base.join(&note_id).join(&filename);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CloudFail::Fatal(e.into()))?;
        }
        write_asset(&dest, &raw)?;
        if is_encrypted_asset_envelope(&raw) {
            let plain = decrypt_asset_bytes(key, &flat_key, &raw).map_err(|e| match e {
                AppError::WrongPassword => CloudFail::Typed(SyncError::DecryptFailed),
                other => CloudFail::Fatal(other),
            })?;
            write_asset(&dest, &plain)?;
        } else if let Err(e) = upload_asset(client, key, &flat_key, &raw).await {
            crate::rs_log!(
                "[sync::assets] legacy asset re-upload failed {flat_key}: {}",
                fail_str(&e)
            );
        }
        downloaded += 1;
    }
    Ok(downloaded)
}

fn write_asset(dest: &Path, bytes: &[u8]) -> Result<(), CloudFail> {
    super::local::atomic_write(dest, bytes).map_err(|e| CloudFail::Fatal(e.into()))
}

/// Mirror the local asset tree into the folder sync root and back, for notes
/// still present in `note_content` (liveness replaces tombstones).
///
/// Raw bytes are copied verbatim: local asset files are already encrypted with
/// the shared vault items key, so any device that joined the vault decrypts
/// them. Filesystem folders only (`scoped:` folders are handled by the scoped
/// commit store path in Phase C).
pub(crate) fn sync_folder_assets(
    app: &AppHandle,
    state: &AppState,
    folder_id: &str,
) -> Result<u64, AppError> {
    let pool = data_pool(app, state)?;
    let live = live_note_ids(&pool)?;
    let local_base = app_storage_dir(app, state)?.join(ASSET_TYPE);
    let sync_base = std::path::PathBuf::from(folder_id)
        .join("BeaverNotesSync")
        .join(ASSET_TYPE);

    let mut transferred = 0u64;
    for note in &live {
        let local_dir = local_base.join(note);
        let sync_dir = sync_base.join(note);
        transferred += mirror_asset_dir(&sync_dir, &local_dir)?;
        transferred += mirror_asset_dir(&local_dir, &sync_dir)?;
    }
    Ok(transferred)
}

/// Copy files from `from` into `to` when missing or newer there.
fn mirror_asset_dir(from: &Path, to: &Path) -> Result<u64, AppError> {
    if !from.is_dir() {
        return Ok(0);
    }
    std::fs::create_dir_all(to)?;
    let mut copied = 0u64;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') || name_str == "Thumbs.db" {
            continue;
        }
        let src = entry.path();
        if !src.is_file() {
            continue;
        }
        let dst = to.join(&name);
        if asset_is_newer(&src, &dst)? {
            std::fs::copy(&src, &dst)?;
            copied += 1;
        }
    }
    Ok(copied)
}

fn asset_is_newer(src: &Path, dst: &Path) -> Result<bool, AppError> {
    let src_meta = std::fs::metadata(src)?;
    match std::fs::metadata(dst) {
        Ok(dst_meta) => Ok(match (src_meta.modified().ok(), dst_meta.modified().ok()) {
            (Some(a), Some(b)) => a > b,
            _ => src_meta.len() != dst_meta.len(),
        }),
        Err(_) => Ok(true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_key_round_trips() {
        let k = encode_asset_key("image", "note_1", "photo (1).png").unwrap();
        let d = decode_asset_key(&k).unwrap();
        assert_eq!(
            (d.ty.as_str(), d.note_id.as_str(), d.filename.as_str()),
            ("image", "note_1", "photo (1).png")
        );
    }

    #[test]
    fn rejects_unsafe_or_double_dash_segments() {
        assert!(encode_asset_key("image", "a--b", "x.png").is_err());
        assert_eq!(decode_asset_key("image--note--"), None);
        assert_eq!(decode_asset_key("image/note/file"), None);
    }

    #[test]
    fn encode_matches_encode_uri_component() {
        assert_eq!(encode_uri_component("photo (1).png"), "photo%20(1).png");
        assert_eq!(encode_uri_component("a'b!c"), "a'b!c");

        let k = encode_asset_key("image", "note_1", "photo (1).png").unwrap();
        assert_eq!(k, "image--note_1--photo%20(1).png");
    }

    #[test]
    fn encodes_utf8_bytes_and_decodes_malformed_as_none() {
        assert_eq!(encode_uri_component("café+"), "caf%C3%A9%2B");
        assert_eq!(encode_uri_component("caf%C3%A9%2B"), "caf%25C3%25A9%252B");
        assert_eq!(decode_uri_component("caf%C3%A9%2B").as_deref(), Some("café+"));
        assert_eq!(decode_uri_component("bad%2"), None);
        assert_eq!(decode_uri_component("bad%zz"), None);
    }

    #[test]
    fn length_uses_utf16_code_units_like_js() {
        assert_eq!(encode_uri_component("😀"), "%F0%9F%98%80");

        // 'é' is one UTF-16 code unit: boundary at 256.
        assert!(encode_asset_key("image", &"é".repeat(256), "x.png").is_ok());
        assert!(encode_asset_key("image", &"é".repeat(257), "x.png").is_err());

        // '😀' is two UTF-16 code units (astral): boundary at 128.
        assert!(encode_asset_key("image", &"😀".repeat(128), "x.png").is_ok());
        assert!(encode_asset_key("image", &"😀".repeat(129), "x.png").is_err());

        // Percent-encoded JS keys decode under the same UTF-16 semantics.
        let at_limit = encode_asset_key("image", &"é".repeat(256), "x.png").unwrap();
        assert!(decode_asset_key(&at_limit).is_some());
        assert!(decode_asset_key(&format!("image--{}--x.png", "😀".repeat(128))).is_some());
        assert_eq!(
            decode_asset_key(&format!("image--{}--x.png", "😀".repeat(129))),
            None
        );
    }

    #[test]
    fn asset_envelope_round_trips_and_rejects_plaintext() {
        let key = [7u8; 32];
        let enc = encrypt_asset_bytes(&key, "image--note1--a.png", b"hello").unwrap();
        assert!(is_encrypted_asset_envelope(&enc));
        let out = decrypt_asset_bytes(&key, "image--note1--a.png", &enc).unwrap();
        assert_eq!(out, b"hello");
        assert!(decrypt_asset_bytes(&key, "image--note1--a.png", b"plain").is_err());
    }

    #[test]
    fn asset_envelope_is_exact_js_v5_shape() {
        let key = [7u8; 32];
        let enc = encrypt_asset_bytes(&key, "image--note1--a.png", b"hello").unwrap();
        // `v` must lead so the JS-parity byte-prefix detector accepts it.
        assert!(enc.starts_with(br#"{"v":5"#));
        let value: serde_json::Value = serde_json::from_slice(&enc).unwrap();
        assert_eq!(value["v"], SYNC_PAYLOAD_VERSION);
        assert_eq!(value["meta"]["asset"], "image--note1--a.png");
        assert!(value["iv"].is_string());
        assert!(value["enc"].is_string());
    }

    #[test]
    fn asset_envelope_rejects_wrong_key_and_wrong_flat_key() {
        let key = [7u8; 32];
        let other = [8u8; 32];
        let enc = encrypt_asset_bytes(&key, "image--note1--a.png", b"hello").unwrap();
        assert!(matches!(
            decrypt_asset_bytes(&other, "image--note1--a.png", &enc),
            Err(AppError::WrongPassword)
        ));
        assert!(matches!(
            decrypt_asset_bytes(&key, "image--note2--a.png", &enc),
            Err(AppError::WrongPassword)
        ));
    }

    #[test]
    fn asset_envelope_detector_rejects_non_envelopes() {
        assert!(!is_encrypted_asset_envelope(b"plain"));
        assert!(!is_encrypted_asset_envelope(b"not json"));
        assert!(is_encrypted_asset_envelope(br#"{"v":4}"#));
        assert!(is_encrypted_asset_envelope(br#"{"v":5}"#));
        // Leading whitespace is tolerated; only the first 64 bytes are read.
        assert!(is_encrypted_asset_envelope(b"  \n {\"v\":5,\"iv\":\"x\"}"));
        assert!(!is_encrypted_asset_envelope(br#"{"v":3}"#));
        assert!(!is_encrypted_asset_envelope(br#"{"v":"5"}"#));
        // Byte-prefix only: a plaintext asset JSON with a later `"v":5` field
        // is not an envelope, so `download_missing` never misroutes it to
        // decrypt.
        assert!(!is_encrypted_asset_envelope(br#"{"name":"photo","v":5}"#));
        assert!(!is_encrypted_asset_envelope(b"\x00\x01\x02{\"v\":5}"));
    }

    #[test]
    fn asset_envelope_decrypt_rejects_missing_fields_and_versions() {
        let key = [7u8; 32];
        // v5 without iv/enc must fail, not pass through.
        assert!(decrypt_asset_bytes(&key, "image--note1--a.png", br#"{"v":5}"#).is_err());
        // Absent / unknown version is rejected, never treated as plaintext.
        assert!(decrypt_asset_bytes(&key, "image--note1--a.png", br#"{"meta":{}}"#).is_err());
        assert!(decrypt_asset_bytes(&key, "image--note1--a.png", br#"{"v":3}"#).is_err());
        assert!(decrypt_asset_bytes(&key, "image--note1--a.png", b"plain").is_err());
    }

    #[test]
    fn asset_envelope_decrypts_legacy_v4_update_array() {
        let key = [7u8; 32];
        let flat_key = "image--note1--a.png";
        let plaintext = serde_json::json!({
            "update": [104, 101, 108, 108, 111],
            "asset": flat_key,
        });
        let env = crate::shared::aead_encrypt_json(&key, &plaintext, &format!("asset:{flat_key}"))
            .unwrap();
        // Legacy v4 envelopes were written `{v, iv, enc}` (JS insertion order),
        // which the byte-prefix detector must still recognize.
        let raw = format!(
            r#"{{"v":{},"iv":"{}","enc":"{}"}}"#,
            PROTOCOL_VERSION, env.iv, env.enc
        )
        .into_bytes();
        assert!(is_encrypted_asset_envelope(&raw));
        assert_eq!(decrypt_asset_bytes(&key, flat_key, &raw).unwrap(), b"hello");
    }

    #[test]
    fn batch_payload_encrypts_each_item() {
        let key = [9u8; 32];
        let payload =
            build_batch_payload(&key, &[("image--n1--a.png".into(), b"x".to_vec())]).unwrap();
        let json: serde_json::Value = serde_json::from_slice(&payload).unwrap();
        let first = &json["assets"][0];
        assert_eq!(first["key"], "image--n1--a.png");
        let data = BASE64.decode(first["data"].as_str().unwrap()).unwrap();
        assert!(is_encrypted_asset_envelope(&data));
        assert_eq!(
            decrypt_asset_bytes(&key, "image--n1--a.png", &data).unwrap(),
            b"x"
        );
    }

    #[test]
    fn asset_url_path_encodes_unsafe_chars() {
        assert_eq!(
            asset_url_path("image--note_1--photo (1).png"),
            "/assets/image--note_1--photo%20(1).png"
        );
    }

    fn key(note_id: &str, filename: &str) -> AssetKey {
        AssetKey {
            ty: ASSET_TYPE.into(),
            note_id: note_id.into(),
            filename: filename.into(),
        }
    }

    #[test]
    fn local_asset_name_strips_legacy_enc() {
        assert_eq!(local_asset_name("a.png.enc"), "a.png");
        assert_eq!(local_asset_name("a.png"), "a.png");
        assert_eq!(local_asset_name("archive.enc.zip"), "archive.enc.zip");
    }

    #[test]
    fn plan_uploads_live_local_file_missing_remotely() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let ops = plan_asset_ops(&[("n1".into(), "a.png".into())], &[], &live, |_, _| false).unwrap();
        assert_eq!(
            ops,
            vec![AssetOp::Upload {
                flat_key: "assets--n1--a.png".into(),
                note_id: "n1".into(),
                filename: "a.png".into(),
            }]
        );
    }

    #[test]
    fn plan_skips_upload_for_dead_note() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let ops =
            plan_asset_ops(&[("dead".into(), "a.png".into())], &[], &live, |_, _| false).unwrap();
        assert!(ops.is_empty());
    }

    #[test]
    fn plan_prunes_dead_remote_and_downloads_with_stripped_name() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let remote = vec![
            ("assets--n1--a.png.enc".into(), key("n1", "a.png.enc")),
            ("assets--dead--b.png".into(), key("dead", "b.png")),
        ];
        let ops = plan_asset_ops(&[], &remote, &live, |_, _| false).unwrap();
        assert!(ops.contains(&AssetOp::DeleteRemote {
            flat_key: "assets--dead--b.png".into()
        }));
        assert!(ops.contains(&AssetOp::Download {
            flat_key: "assets--n1--a.png.enc".into(),
            note_id: "n1".into(),
            filename: "a.png".into(),
        }));
        assert!(!ops.iter().any(|o| matches!(
            o,
            AssetOp::Download { note_id, .. } if note_id == "dead"
        )));
    }

    #[test]
    fn plan_skips_download_when_local_file_exists() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let remote = vec![("assets--n1--a.png".into(), key("n1", "a.png"))];
        let ops = plan_asset_ops(&[], &remote, &live, |n, f| n == "n1" && f == "a.png").unwrap();
        assert!(ops.is_empty());
    }

    #[test]
    fn plan_ignores_non_assets_remote_keys() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let remote = vec![(
            "notes-assets--n1--a.png".into(),
            AssetKey {
                ty: "notes-assets".into(),
                note_id: "n1".into(),
                filename: "a.png".into(),
            },
        )];
        let ops = plan_asset_ops(&[], &remote, &live, |_, _| false).unwrap();
        assert!(ops.is_empty());
    }

    #[test]
    fn presigned_url_accepts_key_and_asset_key() {
        let with_key: PresignedUrl =
            serde_json::from_str(r#"{"url":"https://x/a","key":"assets--n1--a.png"}"#).unwrap();
        assert_eq!(with_key.url, "https://x/a");
        assert_eq!(with_key.key.as_deref(), Some("assets--n1--a.png"));

        let with_asset_key: PresignedUrl =
            serde_json::from_str(r#"{"url":"https://x/b","assetKey":"assets--n1--b.png"}"#).unwrap();
        assert_eq!(with_asset_key.url, "https://x/b");
        assert_eq!(with_asset_key.key.as_deref(), Some("assets--n1--b.png"));
    }

    fn unique_temp_dir(prefix: &str) -> std::path::PathBuf {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock ok")
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{ts}-{}", std::process::id()))
    }

    #[test]
    fn live_note_ids_reads_distinct_rows() {
        let root = unique_temp_dir("beaver-notes-asset-live-ids");
        let _ = std::fs::create_dir_all(&root);
        let pool = crate::db::open_pool(&root.join("data.db")).expect("pool");
        {
            let conn = pool.get().expect("conn");
            let mut insert = conn
                .prepare("INSERT INTO note_content (note_id, data, created_at) VALUES (?1, ?2, 0)")
                .expect("prepare");
            for (note_id, data) in [("n1", b"a".as_slice()), ("n1", b"b".as_slice()), ("n2", b"c".as_slice())] {
                insert.execute(rusqlite::params![note_id, data]).expect("insert");
            }
        }
        let ids = live_note_ids(&pool).expect("live ids");
        let expected: HashSet<String> = ["n1".to_string(), "n2".to_string()].into_iter().collect();
        assert_eq!(ids, expected);
        drop(pool);
        let _ = std::fs::remove_dir_all(&root);
    }
}
