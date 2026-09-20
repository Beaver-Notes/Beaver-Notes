use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Duration;

use base64::{
    engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD},
    Engine as _,
};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305,
};
use serde::Deserialize;
use tauri::{AppHandle, Manager};
use yrs::{
    types::AsPrelim as _, updates::decoder::Decode as _, Any, Array as YrsArray, Doc as YrsDoc,
    GetString, In as YrsIn, Map as YrsMap, Out as YrsOut, ReadTxn, Transact, Update as YrsUpdate,
    Xml, XmlFragment as YrsXmlFragment,
};

use super::cloud::{CloudFail, SyncError, WriterKey};
use super::remote::CloudClient;
use crate::commands::security::serialize_sync_envelope;
use crate::db::DbPool;
use crate::shared::{
    aead_decrypt_bytes, aead_decrypt_json, aead_encrypt_bytes, app_storage_dir, current_shared_key,
    data_pool, write_barrier, AppError, AppState, SyncEnvelope, PROTOCOL_VERSION,
    SHARED_PAYLOAD_VERSION, SYNC_PAYLOAD_VERSION,
};

const HEX: &[u8; 16] = b"0123456789ABCDEF";

/// Single local asset root and the JS legacy encrypted-file suffix (mirrors
/// `ASSET_TYPES` / `ENCRYPTED_ASSET_EXT` in `src/utils/sync/constants.js`).
const ASSET_TYPE: &str = "assets";
const ENCRYPTED_ASSET_EXT: &str = ".enc";
/// Asset keys are `assets--<uri(workspaceId)>--<uri(noteId)>--<base64url(hash)>`.
/// The workspace and note ids are in the clear (the server and the client
/// differ need the note association for deterministic per-note tombstone
/// cleanup), but the final segment is a one-way salted hash of the filename, so
/// neither the server nor a client can read the filename from the key. Legacy
/// 3/4-segment and item-3 opaque keys stay readable forever (see
/// [`decode_asset_key`]).
const ASSET_KEY_WIRE_PREFIX: &str = "assets--";
/// Domain separation for the per-note filename salt. The salt is derived from
/// the (clear) note id, so it is stable across a vault-key change and a shared
/// note-key rotation; a filename therefore always maps to the same key. It is
/// not a secret and is not meant to be: it only stops one rainbow table from
/// covering every note at once.
const ASSET_KEY_FILENAME_SALT_CONTEXT: &str = "BeaverNotes asset-key filename salt v1";
/// Version of the *legacy* item-3 encrypted-key plaintext record. Kept only so
/// old opaque keys still decode.
const ASSET_KEY_TOKEN_VERSION: &str = "v1";
/// AAD of the legacy item-3 opaque token. Non-secret and stable.
const ASSET_KEY_TOKEN_AAD: &str = "asset-key:v1";

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
    /// Workspace the asset belongs to. `None` for legacy 3-segment keys
    /// (`assets--<note>--<file>`), which predate workspace scoping and are
    /// treated as workspace-unknown: never deleted by the client.
    pub workspace_id: Option<String>,
    pub note_id: String,
    /// Original filename for legacy keys. For new-scheme keys this is the
    /// base64url hash segment and carries no readable name.
    pub filename: String,
    /// True for new-scheme keys, whose `filename` is a one-way hash. The differ
    /// uses this to refuse a filename-driven download and to match uploads by
    /// exact key instead of decoded structure.
    pub hashed_filename: bool,
}

/// Domain-separated subkeys for the *legacy* item-3 opaque token only.
fn asset_key_subkeys(protection_key: &[u8; 32]) -> ([u8; 32], [u8; 32]) {
    (
        blake3::derive_key("BeaverNotes asset-key encryption v1", protection_key),
        blake3::derive_key("BeaverNotes asset-key nonce v1", protection_key),
    )
}

/// The new-scheme filename hash: `base64url-no-pad(blake3_keyed(salt, filename))`
/// over the full 32-byte digest, with `salt = derive_key(context, note_id)`.
/// Pure and rotation-independent: no vault/items/shared key is an input.
fn filename_hash(note_id: &str, filename: &str) -> String {
    let salt = blake3::derive_key(ASSET_KEY_FILENAME_SALT_CONTEXT, note_id.as_bytes());
    URL_SAFE_NO_PAD.encode(blake3::keyed_hash(&salt, filename.as_bytes()).as_bytes())
}

/// Whether a 4th segment is a new-scheme filename hash: 43 base64url-no-pad
/// chars that decode to exactly 32 bytes. Mirrored by the server's
/// `isFilenameHash` so the GC keeps ignoring new keys.
fn is_filename_hash(segment: &str) -> bool {
    if segment.len() != 43 {
        return false;
    }
    matches!(URL_SAFE_NO_PAD.decode(segment), Ok(bytes) if bytes.len() == 32)
}

fn parse_asset_key_plaintext(bytes: &[u8]) -> Option<AssetKey> {
    let text = std::str::from_utf8(bytes).ok()?;
    // `splitn(4)` keeps the filename intact even when it contains `|`.
    let mut parts = text.splitn(4, '|');
    if parts.next()? != ASSET_KEY_TOKEN_VERSION {
        return None;
    }
    let workspace_id = parts.next()?;
    let note_id = parts.next()?;
    let filename = parts.next()?;
    if !safe_segment(workspace_id) || !safe_segment(note_id) || !safe_segment(filename) {
        return None;
    }
    Some(AssetKey {
        ty: ASSET_TYPE.to_string(),
        workspace_id: Some(workspace_id.to_string()),
        note_id: note_id.to_string(),
        filename: filename.to_string(),
        hashed_filename: false,
    })
}

fn decode_opaque_asset_key(
    key: &str,
    protection_keys: impl Iterator<Item = [u8; 32]>,
) -> Option<AssetKey> {
    let token = key.strip_prefix(ASSET_KEY_WIRE_PREFIX)?;
    let blob = URL_SAFE_NO_PAD.decode(token).ok()?;
    if blob.len() < 24 + 16 {
        return None;
    }
    let nonce: [u8; 24] = blob[..24].try_into().ok()?;
    let ciphertext = &blob[24..];
    for protection_key in protection_keys {
        let (enc_key, _) = asset_key_subkeys(&protection_key);
        let Ok(cipher) = XChaCha20Poly1305::new_from_slice(&enc_key) else {
            continue;
        };
        if let Ok(plaintext) = cipher.decrypt(
            &nonce.into(),
            Payload {
                msg: ciphertext,
                aad: ASSET_KEY_TOKEN_AAD.as_bytes(),
            },
        ) {
            if let Some(parsed) = parse_asset_key_plaintext(&plaintext) {
                return Some(parsed);
            }
        }
    }
    None
}

/// Build the new-scheme wire key for one asset:
/// `assets--<uri(workspace)>--<uri(note)>--<base64url(hash)>`. The same
/// `(workspace, note, filename)` always yields the same key; no vault/items/
/// shared key is an input, so a key rotation can never change it.
pub(crate) fn encode_asset_key(
    ty: &str,
    workspace_id: &str,
    note_id: &str,
    filename: &str,
) -> Result<String, AppError> {
    if ty != ASSET_TYPE || !safe_segment(workspace_id) || !safe_segment(note_id) || !safe_segment(filename)
    {
        return Err(AppError::Other("sync: invalid asset key segment".into()));
    }
    let hash = filename_hash(note_id, filename);
    Ok(format!(
        "{ASSET_KEY_WIRE_PREFIX}{}--{}--{hash}",
        encode_uri_component(workspace_id),
        encode_uri_component(note_id),
    ))
}

/// Decode a flat cloud key: the new-scheme structural form, then the item-3
/// opaque token (decrypt the structure with any protection key this device
/// holds), then the legacy 3/4-segment forms. An opaque token sealed under a key
/// this device does not hold returns `None` (skip), never a partial structure.
pub(crate) fn decode_asset_key_with(
    key: &str,
    app_key: &[u8; 32],
    shared: &HashMap<String, Vec<[u8; 32]>>,
) -> Option<AssetKey> {
    if let Some(parsed) = parse_new_scheme_key(key) {
        return Some(parsed);
    }
    if key.starts_with(ASSET_KEY_WIRE_PREFIX) {
        // The token does not reveal which note (hence which shared key) sealed
        // it, so try every key this device holds; a wrong key fails closed.
        let mut candidates: Vec<[u8; 32]> = vec![*app_key];
        for keys in shared.values() {
            for key in keys {
                if !candidates.contains(key) {
                    candidates.push(*key);
                }
            }
        }
        // Opaque tokens are tried before structural parsing because their
        // base64url payload may itself contain `--` and be misread as segments.
        if let Some(parsed) = decode_opaque_asset_key(key, candidates.into_iter()) {
            return Some(parsed);
        }
    }
    decode_asset_key(key)
}

/// Parse the new-scheme structural form only:
/// `assets--<uri(ws)>--<uri(note)>--<43-char base64url hash>`. No key material
/// is needed. Returns `None` for anything else (legacy keys, opaque tokens).
fn parse_new_scheme_key(key: &str) -> Option<AssetKey> {
    if key.contains('/') || key.contains('\\') || key.contains('\0') {
        return None;
    }
    let mut parts = key.splitn(4, "--");
    if parts.next()? != ASSET_TYPE {
        return None;
    }
    let workspace_id = decode_uri_component(parts.next()?)?;
    let note_id = decode_uri_component(parts.next()?)?;
    // `splitn(4)` keeps a hash's own `--` inside the final segment.
    let hash = parts.next()?;
    if !safe_segment(&workspace_id) || !safe_segment(&note_id) || !is_filename_hash(hash) {
        return None;
    }
    Some(AssetKey {
        ty: ASSET_TYPE.to_string(),
        workspace_id: Some(workspace_id),
        note_id,
        filename: hash.to_string(),
        hashed_filename: true,
    })
}

/// Parse a legacy flat cloud key by structure: 4 segments is
/// `ty--workspace--note--file`, 3 is `ty--note--file` (workspace unknown, never
/// deleted by the client). New-scheme keys are handled by
/// [`parse_new_scheme_key`]; anything else is rejected (legacy segments may not
/// contain `--`, so a legacy filename never smuggles an extra separator).
pub(crate) fn decode_asset_key(key: &str) -> Option<AssetKey> {
    if let Some(parsed) = parse_new_scheme_key(key) {
        return Some(parsed);
    }
    if key.contains('/') || key.contains('\\') || key.contains('\0') {
        return None;
    }
    let mut parts = key.splitn(4, "--");
    let ty = decode_uri_component(parts.next()?)?;
    if !safe_segment(&ty) {
        return None;
    }
    let second = parts.next()?;
    let third = parts.next()?;
    match parts.next() {
        // 3 segments: ty--note--file.
        None => {
            let note_id = decode_uri_component(second)?;
            let filename = decode_uri_component(third)?;
            if !safe_segment(&note_id) || !safe_segment(&filename) {
                return None;
            }
            Some(AssetKey {
                ty,
                workspace_id: None,
                note_id,
                filename,
                hashed_filename: false,
            })
        }
        Some(fourth) => {
            let workspace_id = decode_uri_component(second)?;
            if !safe_segment(&workspace_id) {
                return None;
            }
            let note_id = decode_uri_component(third)?;
            let filename = decode_uri_component(fourth)?;
            if !safe_segment(&note_id) || !safe_segment(&filename) {
                return None;
            }
            Some(AssetKey {
                ty,
                workspace_id: Some(workspace_id),
                note_id,
                filename,
                hashed_filename: false,
            })
        }
    }
}

/// Envelope version (`v4`/`v5`/`v6`) of a cloud asset byte-prefix, or `None`
/// for non-JSON, unknown versions, and raw asset bytes. Mirrors JS
/// `isEncryptedEnvelopeBytes` (`crypto.js:112`): a byte-prefix check over the
/// first 64 bytes, never a full-payload parse, so a plaintext asset JSON with
/// a later `"v":5` field is not mistaken for an envelope. v6 (shared key) must
/// be recognized, else `download_missing` would write it as plaintext.
fn asset_envelope_version(raw: &[u8]) -> Option<u8> {
    if raw.len() < 6 {
        return None;
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
        return None;
    }
    i += 1;
    skip_ws(&mut i);
    if head.get(i..i + 3) != Some(b"\"v\"") {
        return None;
    }
    i += 3;
    skip_ws(&mut i);
    if head.get(i) != Some(&b':') {
        return None;
    }
    i += 1;
    skip_ws(&mut i);
    match head.get(i) {
        Some(b'4') => Some(PROTOCOL_VERSION),
        Some(b'5') => Some(SYNC_PAYLOAD_VERSION),
        Some(b'6') => Some(SHARED_PAYLOAD_VERSION),
        _ => None,
    }
}

/// True for a v4/v5/v6 cloud asset envelope (`{"v":4|5|6,...}`).
pub(crate) fn is_encrypted_asset_envelope(raw: &[u8]) -> bool {
    asset_envelope_version(raw).is_some()
}

/// Key + envelope version to seal one asset with, chosen from its flat key's
/// note id: a registered shared note key (the same map the durable note path
/// uses) yields v6, else the account items key yields v5. Personal assets are
/// unchanged; a shared note's attachments become readable by every
/// collaborator. The AAD (`asset:<flat_key>`) is identical across versions, so
/// identity binding is unchanged and only the key source differs.
fn asset_seal_for_key(
    app_key: &[u8; 32],
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    note_id: &str,
) -> ([u8; 32], u8) {
    match current_shared_key(shared_keys, note_id) {
        Some(k) => (k, SHARED_PAYLOAD_VERSION),
        None => (*app_key, SYNC_PAYLOAD_VERSION),
    }
}

/// Encrypt an asset payload into the JS-compatible v5 envelope
/// (`{v, meta:{asset}, iv, enc}`) with AAD `asset:<flat_key>`, matching
/// `encryptAssetBytes` -> `syncEncryptPayload`.
pub(crate) fn encrypt_asset_bytes(
    key: &[u8; 32],
    flat_key: &str,
    data: &[u8],
) -> Result<Vec<u8>, AppError> {
    encrypt_asset_bytes_versioned(key, SYNC_PAYLOAD_VERSION, flat_key, data)
}

/// [`encrypt_asset_bytes`] with an explicit envelope version: v5 seals with the
/// account items key, v6 with a note's shared collaboration key. Same JSON
/// shape and AAD; only the key and version byte differ, so the reader picks the
/// key from `v` and pre-existing v5 rows stay items-key readable forever.
pub(crate) fn encrypt_asset_bytes_versioned(
    key: &[u8; 32],
    version: u8,
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
    let envelope = serialize_sync_envelope(version, &AssetMeta { asset: flat_key }, &iv, &enc)?;
    Ok(envelope.into_bytes())
}

/// Fail-closed decrypt mirroring `decrypt_remote_update`: only v5/v6 (raw bytes)
/// and legacy v4 (`update` byte array) envelopes with AAD `asset:<flat_key>`
/// decrypt; missing fields or any other version are errors, never passthrough.
/// v5 (and legacy v4) use the account items key; v6 uses the note's shared key.
pub(crate) fn decrypt_asset_bytes(
    key: &[u8; 32],
    flat_key: &str,
    raw: &[u8],
) -> Result<Vec<u8>, AppError> {
    decrypt_asset_bytes_with_shared(key, &[], flat_key, raw)
}

/// `shared_keys` is the note's key ring newest-first: a v6 asset sealed by any
/// generation stays readable, and an empty ring fails closed.
pub(crate) fn decrypt_asset_bytes_with_shared(
    app_key: &[u8; 32],
    shared_keys: &[[u8; 32]],
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
        Ok(aead_decrypt_bytes(app_key, iv, enc, &aad)?)
    } else if version == SHARED_PAYLOAD_VERSION {
        shared_keys
            .iter()
            .find_map(|key| aead_decrypt_bytes(key, iv, enc, &aad).ok())
            .ok_or_else(|| {
                AppError::Other(
                    "sync: asset sealed with a shared key that is not registered".into(),
                )
            })
    } else if version == PROTOCOL_VERSION {
        let legacy = SyncEnvelope {
            v: version,
            iv: iv.to_string(),
            enc: enc.to_string(),
        };
        let value = aead_decrypt_json(app_key, &legacy, &aad)?;
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

/// Resolve one downloaded encrypted envelope to plaintext. `Ok(None)` means
/// this device must **skip** the file for now: a v6 (shared-key) envelope whose
/// note's collaboration key is not registered in this session, so it cannot be
/// decrypted yet. That is a per-file skip, never fatal, and nothing is written.
/// v5 envelopes and registered v6 keys decrypt as usual.
fn decrypt_downloaded_envelope(
    app_key: &[u8; 32],
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    expected_shared: &HashSet<String>,
    note_id: &str,
    flat_key: &str,
    raw: &[u8],
) -> Result<Option<Vec<u8>>, AppError> {
    let shared = shared_keys.get(note_id);
    let version = asset_envelope_version(raw);
    if shared.is_none() && version == Some(SHARED_PAYLOAD_VERSION) {
        return Ok(None);
    }
    // Expected-shared note with no key yet: do not force-decrypt a v5
    // (items-key) envelope — it belongs to a key the peers will never hold, and
    // a decrypt error here would abort the whole asset pass. Skip it; the note
    // seals v6 once `sync_register_shared_key` lands (findings C1/C9).
    if shared.is_none()
        && version == Some(SYNC_PAYLOAD_VERSION)
        && expected_shared.contains(note_id)
    {
        return Ok(None);
    }
    Ok(Some(decrypt_asset_bytes_with_shared(
        app_key,
        shared.map(|keys| keys.as_slice()).unwrap_or(&[]),
        flat_key,
        raw,
    )?))
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
/// so the upload is skipped rather than failed. A shared note's asset seals
/// under its collaboration key (v6) so every collaborator can read it.
pub(crate) async fn upload_asset(
    client: &CloudClient,
    key: &WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    flat_key: &str,
    note_id: &str,
    data: &[u8],
) -> Result<(), CloudFail> {
    // Seal under the key-migration read barrier: the key is read and the
    // ciphertext produced in one guarded span (finding C2).
    let encrypted = {
        let _barrier = write_barrier();
        let app_key = key.resolve().map_err(CloudFail::Fatal)?;
        let (seal_key, version) = asset_seal_for_key(&app_key, shared_keys, note_id);
        encrypt_asset_bytes_versioned(&seal_key, version, flat_key, data)
            .map_err(CloudFail::Fatal)?
    };
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
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    items: &[(String, String, Vec<u8>)],
) -> Result<Vec<u8>, AppError> {
    let mut assets = Vec::with_capacity(items.len());
    for (flat_key, note_id, data) in items {
        let (seal_key, version) = asset_seal_for_key(key, shared_keys, note_id);
        let encrypted = encrypt_asset_bytes_versioned(&seal_key, version, flat_key, data)?;
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
    key: &WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    items: &[(String, String, Vec<u8>)],
) -> Result<(), CloudFail> {
    // Encrypt under the key-migration read barrier (finding C2), then send.
    let payload = {
        let _barrier = write_barrier();
        let app_key = key.resolve().map_err(CloudFail::Fatal)?;
        build_batch_payload(&app_key, shared_keys, items).map_err(CloudFail::Fatal)?
    };
    let body: serde_json::Value = serde_json::from_slice(&payload)
        .map_err(|e| CloudFail::Fatal(AppError::Serialization(e.to_string())))?;
    let _: serde_json::Value = client.post_json(path, &body).await?;
    Ok(())
}

pub(crate) async fn batch_upload_assets(
    client: &CloudClient,
    key: &WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    items: &[(String, String, Vec<u8>)],
) -> Result<(), CloudFail> {
    post_batch(client, "/assets/batch", key, shared_keys, items).await
}

pub(crate) async fn seed_batch_upload_assets(
    client: &CloudClient,
    key: &WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    items: &[(String, String, Vec<u8>)],
) -> Result<(), CloudFail> {
    post_batch(client, "/assets/seed-batch", key, shared_keys, items).await
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

/// `DELETE /assets/{enc}`. Best-effort; returns whether the remote key is
/// confirmed gone (the client treats a 404 as already-gone success). Only a
/// success lets the caller clear the note's tombstone.
pub(crate) async fn delete_asset(client: &CloudClient, flat_key: &str) -> bool {
    match client.delete(&asset_url_path(flat_key)).await {
        Ok(()) => true,
        Err(e) => {
            crate::rs_log!(
                "[sync::assets] remote prune skipped {flat_key}: {}",
                fail_str(&e)
            );
            false
        }
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

/// Parse one `assets://<noteId>/<filename>` URI (or its legacy
/// `file-assets://` form). The filename is the rest of the URI verbatim
/// (spaces included); a nested path is rejected because the editor only ever
/// writes a basename.
fn parse_asset_uri(uri: &str) -> Option<(String, String)> {
    let rest = uri
        .strip_prefix("assets://")
        .or_else(|| uri.strip_prefix("file-assets://"))?;
    let (note_id, filename) = rest.split_once('/')?;
    if note_id.is_empty() || filename.is_empty() || filename.contains('/') {
        return None;
    }
    Some((note_id.to_string(), filename.to_string()))
}

/// Recover a ref embedded in free text (a pasted link, say). Tiptap keeps
/// attachment refs in node attributes, so this is a best-effort fallback:
/// brackets/punctuation that typically follow a URL are trimmed.
fn scan_asset_uri_text(text: &str, refs: &mut Vec<(String, String)>) {
    for token in text.split_whitespace() {
        let Some(start) = token
            .find("assets://")
            .or_else(|| token.find("file-assets://"))
        else {
            continue;
        };
        let candidate = token[start..]
            .trim_end_matches(|c: char| matches!(c, '"' | '\'' | ')' | ']' | '>' | '}' | ',' | ';'));
        if let Some(pair) = parse_asset_uri(candidate) {
            refs.push(pair);
        }
    }
}

fn collect_asset_refs(out: &YrsOut, txn: &yrs::Transaction, refs: &mut Vec<(String, String)>) {
    match out {
        YrsOut::YXmlElement(el) => {
            for (_, value) in el.attributes(txn) {
                if let YrsOut::Any(Any::String(value)) = value {
                    if let Some(pair) = parse_asset_uri(value.as_ref()) {
                        refs.push(pair);
                    }
                }
            }
            for child in el.children(txn) {
                let child: YrsOut = child.into();
                collect_asset_refs(&child, txn, refs);
            }
        }
        YrsOut::YXmlFragment(fragment) => {
            for child in fragment.children(txn) {
                let child: YrsOut = child.into();
                collect_asset_refs(&child, txn, refs);
            }
        }
        YrsOut::YXmlText(text) => scan_asset_uri_text(&text.get_string(txn), refs),
        YrsOut::YText(text) => scan_asset_uri_text(&text.get_string(txn), refs),
        // Non-schema roots (a `YMap`/`YArray` the editor does not currently
        // write, or an XML fragment that yrs inferred as an array because it
        // cannot distinguish the two from content alone): recurse into every
        // child so a reference is found regardless of the root's declared type.
        YrsOut::YArray(array) => {
            for value in array.iter(txn) {
                collect_asset_refs(&value, txn, refs);
            }
        }
        YrsOut::YMap(map) => {
            for (_, value) in map.iter(txn) {
                collect_asset_refs(&value, txn, refs);
            }
        }
        YrsOut::Any(Any::String(value)) => {
            if let Some(pair) = parse_asset_uri(value.as_ref()) {
                refs.push(pair);
            }
        }
        _ => {}
    }
}

/// Extract `(note_id, filename)` pairs from every `assets://<note>/<file>`
/// reference in a merged note Yjs update. The tiptap image/file/audio/video
/// nodes keep their ref in a node attribute (`src`/`href`), which Yjs stores as
/// an XML attribute, so a walk over the note's XML content finds them without
/// any ProseMirror schema.
///
/// The walk is **schema-agnostic**: it does not assume the `content`/`title`
/// root names. yrs resolves a root shared type only when the doc declares it,
/// so an update replayed into a doc that never declared its roots decodes
/// them as `UndefinedRef`, whose children are unreachable. This runs two
/// passes:
///
/// 1. apply the update to a throwaway doc so every root the update touches is
///    materialised (as `UndefinedRef`), then read each root's name and its
///    content-inferred type via [`AsPrelim`];
/// 2. declare those roots on a second throwaway doc with the inferred type,
///    re-apply, and walk every root.
///
/// The inferred type is not always exact (yrs cannot tell an `XmlFragment`
/// from a `YArray` by content alone), which is why [`collect_asset_refs`]
/// recurses into `YArray`/`YMap`/`YText` as well as XML nodes. Both throwaway
/// docs are discarded, so stored data is never mutated.
pub(crate) fn extract_asset_refs(update: &[u8]) -> Vec<(String, String)> {
    if update.is_empty() {
        return Vec::new();
    }
    // Pass 1: probe roots and their inferred types.
    let Ok(probe_update) = YrsUpdate::decode_v1(update) else {
        return Vec::new();
    };
    let probe = YrsDoc::new();
    {
        let mut txn = probe.transact_mut();
        // A partially-integrating update still contributes what it can; a bad
        // note must never abort the asset pass.
        let _ = txn.apply_update(probe_update);
    }
    let roots: Vec<(String, YrsIn)> = {
        let txn = probe.transact();
        txn.root_refs()
            .map(|(name, out)| (name.to_string(), out.as_prelim(&txn)))
            .collect()
    };
    if roots.is_empty() {
        return Vec::new();
    }
    // Pass 2: declare each root with its inferred type, replay, walk.
    let doc = YrsDoc::new();
    for (name, prelim) in &roots {
        match prelim {
            YrsIn::Text(_) | YrsIn::XmlText(_) => {
                let _ = doc.get_or_insert_text(name.as_str());
            }
            YrsIn::Map(_) | YrsIn::Any(_) => {
                let _ = doc.get_or_insert_map(name.as_str());
            }
            YrsIn::Array(_) => {
                let _ = doc.get_or_insert_array(name.as_str());
            }
            YrsIn::XmlFragment(_) | YrsIn::XmlElement(_) => {
                let _ = doc.get_or_insert_xml_fragment(name.as_str());
            }
            _ => {}
        }
    }
    {
        let Ok(parsed) = YrsUpdate::decode_v1(update) else {
            return Vec::new();
        };
        let mut txn = doc.transact_mut();
        let _ = txn.apply_update(parsed);
    }
    let txn = doc.transact();
    let mut refs = Vec::new();
    for (_, root) in txn.root_refs() {
        collect_asset_refs(&root, &txn, &mut refs);
    }
    refs.sort();
    refs.dedup();
    refs
}

/// Byte markers of an asset reference. A Yjs update stores these strings
/// inline, so a cheap byte scan skips the expensive Yjs decode for the common
/// text-only note before `extract_asset_refs` runs.
const ASSET_REF_MARKERS: [&[u8]; 2] = [b"assets://", b"file-assets://"];

fn snapshot_may_reference_assets(snapshot: &[u8]) -> bool {
    ASSET_REF_MARKERS
        .iter()
        .any(|marker| snapshot.windows(marker.len()).any(|window| window == *marker))
}

/// Filenames referenced by live notes that resolve to a remote new-scheme
/// object with no local counterpart. The map is keyed by the **referenced** note
/// id (parsed from the URI), never by the note being read: a file can be
/// referenced from note X while belonging to note Y, and ownership must stay
/// with Y for liveness, tombstone and prune decisions.
///
/// Three cheap bounds keep the common case from re-scanning the vault:
///  1. read each unsatisfied key's own note — its content normally references
///     the missing file, which resolves the key deterministically;
///  2. skip the Yjs decode for a note whose decrypted bytes cannot contain an
///     `assets://` marker (the common text-only note);
///  3. only when a key stays unresolved (its ref lives in *another* note) read
///     the rest of the live vault, stopping as soon as the key is resolved.
/// A fully-synced vault has no unsatisfied key and reads nothing.
fn referenced_assets(
    pool: &DbPool,
    remote: &[(String, AssetKey)],
    local: &[(String, String)],
    live: &HashSet<String>,
    workspace_id: &str,
    key: [u8; 32],
) -> Result<HashMap<String, HashSet<String>>, AppError> {
    referenced_assets_with(remote, local, live, workspace_id, |note_id| {
        crate::db::yjs_get_snapshot(pool, note_id, Some(key))
    })
}

/// Testable core of [`referenced_assets`]. `read_snapshot` is the DB seam so a
/// test can count reads against an in-memory vault.
fn referenced_assets_with<F>(
    remote: &[(String, AssetKey)],
    local: &[(String, String)],
    live: &HashSet<String>,
    workspace_id: &str,
    mut read_snapshot: F,
) -> Result<HashMap<String, HashSet<String>>, AppError>
where
    F: FnMut(&str) -> Result<Vec<u8>, AppError>,
{
    let local_keys: HashSet<String> = local
        .iter()
        .filter(|(note_id, _)| live.contains(note_id))
        .filter_map(|(note_id, filename)| {
            encode_asset_key(ASSET_TYPE, workspace_id, note_id, filename).ok()
        })
        .collect();
    let unsatisfied: Vec<(&str, &str)> = remote
        .iter()
        .filter(|(flat_key, decoded)| {
            decoded.ty == ASSET_TYPE
                && decoded.hashed_filename
                && decoded.workspace_id.as_deref() == Some(workspace_id)
                && live.contains(&decoded.note_id)
                && !local_keys.contains(flat_key)
        })
        .map(|(flat_key, decoded)| (flat_key.as_str(), decoded.note_id.as_str()))
        .collect();
    if unsatisfied.is_empty() {
        return Ok(HashMap::new());
    }

    let mut unresolved: HashSet<&str> = unsatisfied.iter().map(|(flat, _)| *flat).collect();
    let mut owners: Vec<&str> = unsatisfied.iter().map(|(_, note)| *note).collect();
    owners.sort();
    owners.dedup();

    let mut referenced: HashMap<String, HashSet<String>> = HashMap::new();
    let mut scanned: HashSet<&str> = HashSet::new();
    for owner in &owners {
        let snapshot = read_snapshot(owner)?;
        scanned.insert(owner);
        // Skip the Yjs decode for a note whose bytes cannot hold a reference.
        if !snapshot_may_reference_assets(&snapshot) {
            continue;
        }
        for (ref_note, filename) in extract_asset_refs(&snapshot) {
            if ref_note == *owner {
                if let Ok(flat) = encode_asset_key(ASSET_TYPE, workspace_id, &ref_note, &filename) {
                    unresolved.remove(flat.as_str());
                }
            }
            referenced.entry(ref_note).or_default().insert(filename);
        }
    }
    // Every key resolved from its owner's own content: a cross-note reference
    // cannot add anything, so do not read the rest of the vault.
    if unresolved.is_empty() {
        return Ok(referenced);
    }

    // Cross-note fallback: a reference to an unresolved owner lives in another
    // note, so scan the remaining live notes and collect what they point at.
    // `scanned` guarantees each note is read at most once; the loop stops as
    // soon as every unsatisfied key is resolved, so a resolvable cross-note
    // reference does not force a full-vault scan.
    let mut rest: Vec<&str> = live
        .iter()
        .map(String::as_str)
        .filter(|note| !scanned.contains(note))
        .collect();
    rest.sort();
    for note in rest {
        let snapshot = read_snapshot(note)?;
        if !snapshot_may_reference_assets(&snapshot) {
            continue;
        }
        for (ref_note, filename) in extract_asset_refs(&snapshot) {
            if let Ok(flat) = encode_asset_key(ASSET_TYPE, workspace_id, &ref_note, &filename) {
                unresolved.remove(flat.as_str());
            }
            referenced.entry(ref_note).or_default().insert(filename);
        }
        if unresolved.is_empty() {
            break;
        }
    }
    Ok(referenced)
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
        note_id: String,
    },
}

/// Pure differ. Uploads/downloads are gated by local liveness; remote
/// deletion is **tombstone-gated and workspace-scoped**, never inferred:
/// `GET /assets` is account-global (`${userId}/assets/`), so a note missing
/// from this device's local set may simply not have been pulled yet, or may
/// belong to another workspace. Only a key that (a) carries this device's
/// active `workspace_id` and (b) names a note in `deleted_note_ids` (an
/// explicit local deletion record) is pruned. Legacy keys (`workspace_id ==
/// None`) are never deleted.
/// `local_exists(note_id, local_name)` abstracts the filesystem for testing.
/// `encode(workspace_id, note_id, filename)` produces the flat key for an
/// upload (injected so this differ stays pure and testable). New-scheme keys are
/// deterministic and independent of every vault/shared key, so uploads are
/// matched by **exact key**: a key rotation can never re-upload an object.
/// Legacy keys keep their readable filename and are matched structurally so a
/// pre-existing legacy object is not duplicated either.
/// `referenced` maps a note id to the filenames its content references
/// (`assets://<note>/<file>`); it is the only way a hashed remote key can be
/// given a download destination, since the key hides the filename.
pub(crate) fn plan_asset_ops(
    workspace_id: &str,
    local_files: &[(String, String)],
    remote: &[(String, AssetKey)],
    live_note_ids: &HashSet<String>,
    deleted_note_ids: &HashSet<String>,
    referenced: &HashMap<String, HashSet<String>>,
    encode: impl Fn(&str, &str, &str) -> Result<String, AppError>,
    local_exists: impl Fn(&str, &str) -> bool,
) -> Result<Vec<AssetOp>, AppError> {
    let mut ops = Vec::new();
    // Every remote key string, for the deterministic exact-key upload match.
    let remote_keys: HashSet<&str> = remote.iter().map(|(k, _)| k.as_str()).collect();
    // Legacy keys still carry a readable filename; a local `a.png` matches a
    // remote `a.png` but not a remote `a.png.enc` (raw filename, no stripping),
    // preserving the legacy upload behaviour. Hashed keys are excluded: their
    // "filename" is a digest and must never suppress a real upload.
    let remote_structures: HashSet<(&str, &str)> = remote
        .iter()
        .filter(|(_, d)| d.ty == ASSET_TYPE && !d.hashed_filename)
        .map(|(_, d)| (d.note_id.as_str(), d.filename.as_str()))
        .collect();
    for (note_id, filename) in local_files {
        if !live_note_ids.contains(note_id) {
            continue;
        }
        if remote_structures.contains(&(note_id.as_str(), filename.as_str())) {
            continue;
        }
        let flat_key = encode(workspace_id, note_id, filename)?;
        if remote_keys.contains(flat_key.as_str()) {
            continue;
        }
        ops.push(AssetOp::Upload {
            flat_key,
            note_id: note_id.clone(),
            filename: filename.clone(),
        });
    }
    for (flat_key, decoded) in remote {
        if decoded.ty != ASSET_TYPE {
            continue;
        }
        // Deletion: only our workspace's keys, only tombstoned notes. Legacy
        // (workspace-unknown) keys are left to the server GC. Works for both
        // new-scheme and legacy keys: the workspace and note are clear.
        if decoded.workspace_id.as_deref() == Some(workspace_id)
            && deleted_note_ids.contains(&decoded.note_id)
        {
            ops.push(AssetOp::DeleteRemote {
                flat_key: flat_key.clone(),
                note_id: decoded.note_id.clone(),
            });
            continue;
        }
        // A key from another workspace must never be touched.
        if decoded.workspace_id.as_deref().is_some_and(|w| w != workspace_id) {
            continue;
        }
        if !live_note_ids.contains(&decoded.note_id) {
            // Unknown to this device (peer not yet pulled): leave it alone.
            continue;
        }
        // A new-scheme key hides the filename, so the only destination for it
        // is the note's own `assets://` references: recompute each referenced
        // filename's deterministic key and take the one that matches. Legacy
        // keys download by their decoded name instead.
        if decoded.hashed_filename {
            if let Some(files) = referenced.get(&decoded.note_id) {
                for filename in files {
                    if encode(workspace_id, &decoded.note_id, filename)? == *flat_key
                        && !local_exists(&decoded.note_id, filename)
                    {
                        ops.push(AssetOp::Download {
                            flat_key: flat_key.clone(),
                            note_id: decoded.note_id.clone(),
                            filename: filename.clone(),
                        });
                        break;
                    }
                }
            }
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

/// `SELECT DISTINCT note_id FROM note_content` — local liveness, used only to
/// gate uploads/downloads. It must never drive remote deletion (see
/// [`plan_asset_ops`]).
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
    let pool = super::cloud::writer_gate(app)?;
    // Same shared-key map the durable note path uses: a shared note's assets
    // seal under its collaboration key (v6) instead of the account items key.
    // The key itself is read under the migration barrier at each seal (C2).
    let key = WriterKey::Session(app.clone());
    let (shared, expected) = {
        let state = app.state::<AppState>();
        let shared = crate::shared::shared_note_keys(state.inner()).map_err(CloudFail::Fatal)?;
        // Notes the client knows are shared but that have no registered key
        // yet: their assets must not be sealed v5 (undecryptable by peers) —
        // defer them.
        let expected =
            crate::shared::expected_shared_notes(state.inner()).map_err(CloudFail::Fatal)?;
        (shared, expected)
    };
    let client = CloudClient::new(server_url, token).map_err(CloudFail::Fatal)?;

    // State gate: only initialized workspaces sync assets (seeding handles the
    // rest). A 404 (`Ok(None)`) or 403 (`Unauthorized`, which `map_status`
    // cannot distinguish from 401) is a skip, not a failure. Any other error
    // (offline/throttled) propagates so the scheduler retries.
    let state_path = format!(
        "/sync/state?workspaceId={}",
        urlencoding::encode(workspace_id)
    );
    let (initialized, state_status) = match client.get_json_opt::<AssetSyncState>(&state_path).await {
        Ok(Some(state)) => {
            let is_initialized = state.status == "initialized";
            (is_initialized, state.status)
        }
        Ok(None) => (false, "missing".to_string()),
        Err(CloudFail::Unauthorized) => (false, "unauthorized".to_string()),
        Err(e) => return Err(e),
    };
    if !initialized {
        crate::rs_log!(
            "[sync::assets] skipped: workspace not initialized (status={state_status})"
        );
        return Ok(0);
    }

    let base = {
        let state = app.state::<AppState>();
        app_storage_dir(app, state.inner())
            .map_err(CloudFail::Fatal)?
            .join(ASSET_TYPE)
    };

    // Items key for decoding opaque remote keys and deriving new ones. Read
    // under the migration barrier like every other key read.
    let app_key = {
        let _barrier = write_barrier();
        key.resolve().map_err(CloudFail::Fatal)?
    };

    let remote: Vec<(String, AssetKey)> = list_remote_assets(&client)
        .await?
        .iter()
        .filter_map(|k| decode_asset_key_with(k, &app_key, &shared).map(|d| (k.clone(), d)))
        .collect();

    let ops = {
        let pool = pool.clone();
        let base = base.clone();
        let workspace_id = workspace_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Vec<AssetOp>, AppError> {
            let live = live_note_ids(&pool)?;
            let local = walk_local_assets(&base)?;
            // Explicit local deletion records are the ONLY remote-delete input.
            // Never inference: the account-global listing cannot distinguish a
            // peer's not-yet-pulled asset from a deleted one.
            let deleted: HashSet<String> =
                crate::db::deleted_note_ids(&pool, &workspace_id)?.into_iter().collect();
            // Recover download destinations for the new-scheme remote keys from
            // the owning notes' `assets://` content (the key itself hides the
            // filename). Only unsatisfied notes are read, so a synced vault
            // pays nothing.
            let referenced =
                referenced_assets(&pool, &remote, &local, &live, &workspace_id, app_key)?;
            let encode = |ws: &str, note: &str, file: &str| encode_asset_key(ASSET_TYPE, ws, note, file);
            plan_asset_ops(
                &workspace_id,
                &local,
                &remote,
                &live,
                &deleted,
                &referenced,
                encode,
                |note_id, name| base.join(note_id).join(name).is_file(),
            )
        })
        .await
        .map_err(|e| CloudFail::Fatal(AppError::Other(e.to_string())))?
        .map_err(CloudFail::Fatal)?
    };

    let mut transferred = 0u64;
    let mut uploads: Vec<(String, String, String)> = Vec::new();
    let mut downloads: Vec<(String, String, String)> = Vec::new();
    let mut pruned_notes: Vec<String> = Vec::new();
    let mut failed_notes: Vec<String> = Vec::new();
    for op in ops {
        match op {
            AssetOp::DeleteRemote { flat_key, note_id } => {
                if delete_asset(&client, &flat_key).await {
                    pruned_notes.push(note_id);
                } else {
                    failed_notes.push(note_id);
                }
            }
            AssetOp::Upload {
                flat_key,
                note_id,
                filename,
            } => {
                // Same deferral as the durable note push (C1): a note known to
                // be shared, with no registered key yet, must not have its
                // asset sealed under the account items key.
                if expected.contains(&note_id) {
                    crate::rs_log!(
                        "[sync::assets] deferring asset upload for expected-shared note {note_id} (no key registered)"
                    );
                    continue;
                }
                uploads.push((flat_key, note_id, filename));
            }
            AssetOp::Download {
                flat_key,
                note_id,
                filename,
            } => downloads.push((flat_key, note_id, filename)),
        }
    }

    // Clear a tombstone only when every remote key for the note was confirmed
    // deleted; a note with any failed DELETE retries next tick.
    pruned_notes.sort();
    pruned_notes.dedup();
    let failed: HashSet<&str> = failed_notes.iter().map(String::as_str).collect();
    let cleared: Vec<String> = pruned_notes
        .into_iter()
        .filter(|n| !failed.contains(n.as_str()))
        .collect();
    if !cleared.is_empty() {
        let pool = pool.clone();
        tokio::task::spawn_blocking(move || crate::db::clear_deleted_notes(&pool, &cleared))
            .await
            .map_err(|e| CloudFail::Fatal(AppError::Other(e.to_string())))?
            .map_err(CloudFail::Fatal)?;
    }

    transferred += upload_batches(&client, &key, &shared, &base, uploads).await?;
    transferred += download_missing(&client, &key, &shared, &expected, &base, downloads).await?;
    Ok(transferred)
}

/// Pack uploads into <=20-item / <=10MB batches, falling back to individual
/// `upload_asset` (which skips 413) when a batch fails. `Unauthorized` always
/// propagates; unreadable/empty local files are logged and skipped.
async fn upload_batches(
    client: &CloudClient,
    key: &WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    base: &Path,
    uploads: Vec<(String, String, String)>,
) -> Result<u64, CloudFail> {
    let mut batches: Vec<Vec<(String, String, Vec<u8>)>> = Vec::new();
    let mut current: Vec<(String, String, Vec<u8>)> = Vec::new();
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
                current.push((flat_key, note_id, data));
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
        match batch_upload_assets(client, key, shared_keys, &batch).await {
            Ok(()) => uploaded += batch.len() as u64,
            Err(CloudFail::Unauthorized) => return Err(CloudFail::Unauthorized),
            Err(e) => {
                crate::rs_log!(
                    "[sync::assets] batch upload failed ({} items), falling back to individual: {}",
                    batch.len(),
                    fail_str(&e)
                );
                for (flat_key, note_id, data) in &batch {
                    match upload_asset(client, key, shared_keys, flat_key, note_id, data).await {
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
    key: &WriterKey,
    shared_keys: &HashMap<String, Vec<[u8; 32]>>,
    expected_shared: &HashSet<String>,
    base: &Path,
    downloads: Vec<(String, String, String)>,
) -> Result<u64, CloudFail> {
    if downloads.is_empty() {
        return Ok(0);
    }
    // Reads need the raw key; sealing (legacy re-upload) resolves it under the
    // migration barrier inside `upload_asset`.
    let app_key = key.resolve().map_err(CloudFail::Fatal)?;
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
    let mut skipped_needs_key = 0u64;
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

        // Resolve the plaintext (or decide to skip) before touching the live
        // path: writing the ciphertext envelope first (then overwriting with
        // plaintext) leaves a JSON envelope at `dest` if the process dies
        // mid-way, and `local_exists` would then never re-fetch it. A v6
        // envelope with no registered note key is skipped whole — no file and
        // no directory is created for it.
        let plain = if is_encrypted_asset_envelope(&raw) {
            match decrypt_downloaded_envelope(
                &app_key,
                shared_keys,
                expected_shared,
                &note_id,
                &flat_key,
                &raw,
            ) {
                Ok(Some(plain)) => Some(plain),
                Ok(None) => {
                    skipped_needs_key += 1;
                    continue;
                }
                Err(e) => {
                    return Err(match e {
                        AppError::WrongPassword => CloudFail::Typed(SyncError::DecryptFailed),
                        other => CloudFail::Fatal(other),
                    })
                }
            }
        } else {
            None
        };

        let dest = base.join(&note_id).join(&filename);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CloudFail::Fatal(e.into()))?;
        }
        match plain {
            Some(plain) => write_asset(&dest, &plain)?,
            None => {
                write_asset(&dest, &raw)?;
                // Don't self-heal a legacy plaintext asset for a note that is
                // expected-shared but keyless: the re-upload would seal v5 for
                // peers (same policy as the upload differ, C1).
                if expected_shared.contains(&note_id) {
                    crate::rs_log!(
                        "[sync::assets] deferring legacy re-upload for expected-shared note {note_id}"
                    );
                } else if let Err(e) =
                    upload_asset(client, key, shared_keys, &flat_key, &note_id, &raw).await
                {
                    crate::rs_log!(
                        "[sync::assets] legacy asset re-upload failed {flat_key}: {}",
                        fail_str(&e)
                    );
                }
            }
        }
        downloaded += 1;
    }
    if skipped_needs_key > 0 {
        crate::rs_log!(
            "[sync::assets] skipped {skipped_needs_key} asset(s): shared note key not registered on this device"
        );
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

        // A locally-deleted attachment must not be resurrected from the shared
        // folder. We cannot delete from the folder (a peer may still own it), so
        // we record a per-note tombstone for files we previously mirrored and
        // skip folder→local for them (finding F7). Re-adding the file locally
        // clears its tombstone. `manifest` is the previous cycle's local set.
        let local_files = list_dir_names(&local_dir);
        let prev_manifest = read_name_set(&pool, &folder_manifest_key(note))?;
        let tombstones = updated_folder_tombstones(&local_files, &prev_manifest, read_name_set(&pool, &folder_tombstone_key(note))?);
        transferred += mirror_asset_dir_skipping(&sync_dir, &local_dir, &tombstones)?;
        transferred += mirror_asset_dir_skipping(&local_dir, &sync_dir, &HashSet::new())?;

        write_name_set(&pool, &folder_manifest_key(note), &list_dir_names(&local_dir))?;
        write_name_set(&pool, &folder_tombstone_key(note), &tombstones)?;
    }
    Ok(transferred)
}

const MAX_FOLDER_ASSET_TOMBSTONES: usize = 512;

fn folder_manifest_key(note: &str) -> String {
    format!("sync:folder:assets:{note}")
}

fn folder_tombstone_key(note: &str) -> String {
    format!("sync:folder:assets-deleted:{note}")
}

/// Files present in a directory (names only), skipping dot entries.
fn list_dir_names(dir: &Path) -> HashSet<String> {
    let mut out = HashSet::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if !name.starts_with('.') && entry.path().is_file() {
                    out.insert(name.to_string());
                }
            }
        }
    }
    out
}

fn read_name_set(pool: &DbPool, key: &str) -> Result<HashSet<String>, AppError> {
    Ok(crate::db::db_get(pool, key, None)?
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .map(|v| v.into_iter().collect())
        .unwrap_or_default())
}

fn write_name_set(pool: &DbPool, key: &str, set: &HashSet<String>) -> Result<(), AppError> {
    let mut names: Vec<&String> = set.iter().collect();
    names.sort();
    crate::db::db_set(pool, key, &serde_json::to_string(&names)?, None)
}

/// Update the folder-asset tombstones: files that were mirrored last cycle
/// (`prev_manifest`) but are gone locally now are newly deleted; files present
/// locally again clear their tombstone. Bounded so it cannot grow forever.
fn updated_folder_tombstones(
    local_files: &HashSet<String>,
    prev_manifest: &HashSet<String>,
    mut tombstones: HashSet<String>,
) -> HashSet<String> {
    tombstones.retain(|name| !local_files.contains(name));
    let mut deleted: Vec<&String> = prev_manifest.difference(local_files).collect();
    deleted.sort();
    for name in deleted {
        if tombstones.len() >= MAX_FOLDER_ASSET_TOMBSTONES {
            break;
        }
        tombstones.insert(name.clone());
    }
    tombstones
}

/// Copy files from `from` into `to` when missing or newer there. `skip` names
/// are left alone in the source (used to avoid resurrecting local deletions).
fn mirror_asset_dir_skipping(
    from: &Path,
    to: &Path,
    skip: &HashSet<String>,
) -> Result<u64, AppError> {
    if !from.is_dir() {
        return Ok(0);
    }
    std::fs::create_dir_all(to)?;
    let mut copied = 0u64;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') || name_str == "Thumbs.db" || skip.contains(name_str.as_ref())
        {
            continue;
        }
        let src = entry.path();
        if !src.is_file() {
            continue;
        }
        let dst = to.join(&name);
        if asset_should_copy(&src, &dst)? {
            atomic_copy_file(&src, &dst)?;
            copied += 1;
        }
    }
    Ok(copied)
}

/// Copy files from `from` into `to` when missing or newer there.
fn mirror_asset_dir(from: &Path, to: &Path) -> Result<u64, AppError> {
    mirror_asset_dir_skipping(from, to, &HashSet::new())
}

/// Copy `src` over `dst` through a hidden temp file in `dst`'s directory, then
/// rename. A crash mid-copy leaves the old file or the complete new one — never
/// a truncated destination.
fn atomic_copy_file(src: &Path, dst: &Path) -> Result<(), AppError> {
    let name = dst.file_name().and_then(|n| n.to_str()).unwrap_or("asset");
    let tmp = dst.with_file_name(format!(".{name}.mirror-{}", std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut from = std::fs::File::open(src)?;
        let mut to = std::fs::File::create(&tmp)?;
        std::io::copy(&mut from, &mut to)?;
        to.sync_all()?;
        drop(to);
        std::fs::rename(&tmp, dst)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result.map_err(AppError::from)
}

/// Whether `src` should supersede `dst` in the folder mirror.
///
/// mtime is authoritative, but a size mismatch is a truncation signal, not a
/// trump: an interrupted copy leaves a shorter file with a *newer* mtime, so
/// mtime-only logic would never repair it. Treat the strictly larger side as
/// the complete copy and repair the smaller one — regardless of mtime — but
/// never let a smaller (truncated) source overwrite the larger destination.
fn asset_should_copy(src: &Path, dst: &Path) -> Result<bool, AppError> {
    let src_meta = std::fs::metadata(src)?;
    let dst_meta = match std::fs::metadata(dst) {
        Ok(m) => m,
        Err(_) => return Ok(true),
    };
    if src_meta.len() > dst_meta.len() {
        return Ok(true);
    }
    if src_meta.len() < dst_meta.len() {
        return Ok(false);
    }
    Ok(match (src_meta.modified().ok(), dst_meta.modified().ok()) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_four_segment_key_parses_with_workspace() {
        let d = decode_asset_key("image--ws-1--note_1--photo%20(1).png").unwrap();
        assert_eq!(
            (
                d.ty.as_str(),
                d.workspace_id.as_deref(),
                d.note_id.as_str(),
                d.filename.as_str()
            ),
            ("image", Some("ws-1"), "note_1", "photo (1).png")
        );
    }

    #[test]
    fn decodes_legacy_three_segment_key_as_workspace_unknown() {
        let d = decode_asset_key("image--note_1--photo%20(1).png").unwrap();
        assert_eq!(d.workspace_id, None);
        assert_eq!(d.note_id, "note_1");
        assert_eq!(d.filename, "photo (1).png");
        // A legacy key must never look like a workspace-scoped one.
        assert_ne!(d.workspace_id.as_deref(), Some("note_1"));
    }

    const APP_KEY: [u8; 32] = [7u8; 32];
    const SHARED_KEY: [u8; 32] = [9u8; 32];

    fn shared_map(note_id: &str, key: [u8; 32]) -> HashMap<String, Vec<[u8; 32]>> {
        let mut map = HashMap::new();
        map.insert(note_id.to_string(), vec![key]);
        map
    }

    /// The new-scheme key is `assets--<uri(ws)>--<uri(note)>--<base64url(hash)>`:
    /// workspace and note are in the clear (the differ needs the note
    /// association for tombstone cleanup) but the filename is a one-way salted
    /// hash, so the server never learns it.
    #[test]
    fn new_asset_key_hides_filename_but_keeps_note_association() {
        let key =
            encode_asset_key(ASSET_TYPE, "ws~secret", "note~secret", "zzz~filename.png").unwrap();
        // `~` survives URI encoding and `.` is absent from base64url, so a
        // substring hit here would be a real plaintext leak, not a fluke.
        assert!(!key.contains("zzz~filename"));
        assert!(!key.contains(".png"));
        assert!(key.starts_with("assets--ws~secret--note~secret--"));
        let d = decode_asset_key_with(&key, &APP_KEY, &HashMap::new()).unwrap();
        assert_eq!(d.ty, ASSET_TYPE);
        assert_eq!(d.workspace_id.as_deref(), Some("ws~secret"));
        assert_eq!(d.note_id, "note~secret");
        assert!(d.hashed_filename, "new-scheme keys carry no readable filename");
    }

    /// The key must not depend on the vault/items key or a note's shared key:
    /// the same (note, filename) always maps to the same key, so a key rotation
    /// never churns the remote object (no re-upload, no orphan).
    #[test]
    fn new_asset_key_is_stable_across_key_rotation() {
        let first = encode_asset_key(ASSET_TYPE, "ws-1", "note_1", "a.png").unwrap();
        let second = encode_asset_key(ASSET_TYPE, "ws-1", "note_1", "a.png").unwrap();
        assert_eq!(first, second, "same (note, filename) must map to the same key");
        // `decode_asset_key` alone (no key material) returns the note id.
        let direct = decode_asset_key(&first).unwrap();
        assert_eq!(direct.note_id, "note_1");
        assert_eq!(direct.workspace_id.as_deref(), Some("ws-1"));
        assert!(direct.hashed_filename);
        // Decoding the same key needs no items key and no shared key at all.
        assert_eq!(
            decode_asset_key_with(&first, &[0u8; 32], &HashMap::new())
                .map(|d| (d.note_id, d.workspace_id)),
            Some(("note_1".to_string(), Some("ws-1".to_string())))
        );
        assert_eq!(
            decode_asset_key_with(&first, &APP_KEY, &shared_map("note_1", SHARED_KEY))
                .map(|d| d.note_id),
            Some("note_1".to_string())
        );
    }

    /// The filename only feeds a 32-byte hash: a 255-byte filename still yields
    /// a fixed-length (43-char) hash segment, so the key can never blow the
    /// server/R2 length budget regardless of the filename.
    #[test]
    fn new_asset_key_length_is_independent_of_filename_length() {
        let long = format!("{}.bin", "a".repeat(251));
        let key = encode_asset_key(ASSET_TYPE, "ws-1", "note-1", &long).unwrap();
        let hash = key.splitn(4, "--").nth(3).unwrap();
        assert_eq!(hash.len(), 43, "base64url-no-pad of 32 bytes is 43 chars");
        let d = decode_asset_key_with(&key, &APP_KEY, &HashMap::new()).unwrap();
        assert!(d.hashed_filename);
    }

    /// The item-3 opaque token produced by the previous encoder (items key
    /// `APP_KEY`) with plaintext `v1|ws-1|note_2|photo (1).png`. Hardcoded so a
    /// future format change cannot silently break old remote objects.
    const LEGACY_OPAQUE_KEY: &str =
        "assets--_AYnbH3RxVZ9xgCyu8TvD1RjN3YKXMdmMLg1HrbzkqHhVpYL0SgWe24nhZNOqUWIHC9g38qHKNUMp3FoIB1p8m-zFk4";

    #[test]
    fn decode_asset_key_with_falls_back_to_legacy_keys() {
        // New scheme.
        let current = encode_asset_key(ASSET_TYPE, "ws-1", "note_1", "a.png").unwrap();
        let d = decode_asset_key_with(&current, &APP_KEY, &HashMap::new()).unwrap();
        assert_eq!(d.note_id, "note_1");
        assert!(d.hashed_filename);
        // Legacy plain 4-segment.
        let scoped =
            decode_asset_key_with("assets--ws-1--note_1--photo%20(1).png", &APP_KEY, &HashMap::new())
                .unwrap();
        assert_eq!(scoped.workspace_id.as_deref(), Some("ws-1"));
        assert_eq!(scoped.note_id, "note_1");
        assert_eq!(scoped.filename, "photo (1).png");
        assert!(!scoped.hashed_filename);
        // Legacy plain 3-segment.
        let legacy =
            decode_asset_key_with("assets--note_1--a.png", &APP_KEY, &HashMap::new()).unwrap();
        assert_eq!(legacy.workspace_id, None);
        assert_eq!(legacy.note_id, "note_1");
        assert_eq!(legacy.filename, "a.png");
        // Item-3 opaque token: still decrypts with the items key.
        let opaque = decode_asset_key_with(LEGACY_OPAQUE_KEY, &APP_KEY, &HashMap::new()).unwrap();
        assert_eq!(opaque.workspace_id.as_deref(), Some("ws-1"));
        assert_eq!(opaque.note_id, "note_2");
        assert_eq!(opaque.filename, "photo (1).png");
        assert!(!opaque.hashed_filename);
        // Wrong key: an opaque token this device cannot open is skipped, never
        // partially decoded.
        assert_eq!(
            decode_asset_key_with(LEGACY_OPAQUE_KEY, &[8u8; 32], &HashMap::new()),
            None
        );
        // Non-keys and traversal still parse to nothing.
        assert_eq!(
            decode_asset_key_with("assets--note_1", &APP_KEY, &HashMap::new()),
            None
        );
        assert_eq!(
            decode_asset_key_with("assets/ws/note", &APP_KEY, &HashMap::new()),
            None
        );
    }

    #[test]
    fn rejects_unsafe_or_double_dash_segments() {
        assert!(encode_asset_key(ASSET_TYPE, "ws", "a--b", "x.png").is_err());
        assert!(encode_asset_key(ASSET_TYPE, "a--b", "note", "x.png").is_err());
        assert_eq!(decode_asset_key("image--note--"), None);
        assert_eq!(decode_asset_key("image/note/file"), None);
        // Two segments or five are rejected outright.
        assert_eq!(decode_asset_key("image--note"), None);
        assert_eq!(decode_asset_key("a--b--c--d--e"), None);
    }

    #[test]
    fn encode_matches_encode_uri_component() {
        assert_eq!(encode_uri_component("photo (1).png"), "photo%20(1).png");
        assert_eq!(encode_uri_component("a'b!c"), "a'b!c");
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
        assert!(encode_asset_key(ASSET_TYPE, "ws", "note", &"é".repeat(256)).is_ok());
        assert!(encode_asset_key(ASSET_TYPE, "ws", "note", &"é".repeat(257)).is_err());

        // '😀' is two UTF-16 code units (astral): boundary at 128.
        assert!(encode_asset_key(ASSET_TYPE, "ws", "note", &"😀".repeat(128)).is_ok());
        assert!(encode_asset_key(ASSET_TYPE, "ws", "note", &"😀".repeat(129)).is_err());

        // Percent-encoded JS keys decode under the same UTF-16 semantics.
        let at_limit =
            encode_asset_key(ASSET_TYPE, "ws", "note", &"é".repeat(256)).unwrap();
        assert!(decode_asset_key_with(&at_limit, &APP_KEY, &HashMap::new()).is_some());
        assert!(decode_asset_key(&format!("image--ws--{}--x.png", "😀".repeat(128))).is_some());
        assert_eq!(
            decode_asset_key(&format!("image--ws--{}--x.png", "😀".repeat(129))),
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
        assert!(is_encrypted_asset_envelope(br#"{"v":6}"#));
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
    fn asset_seal_prefers_shared_note_key() {
        let app = [7u8; 32];
        let shared = [9u8; 32];
        let mut map = HashMap::new();
        map.insert("note1".to_string(), vec![shared]);
        // Shared note: v6 + shared key.
        assert_eq!(
            asset_seal_for_key(&app, &map, "note1"),
            (shared, SHARED_PAYLOAD_VERSION)
        );
        // Personal note (no shared entry): v5 + items key.
        assert_eq!(
            asset_seal_for_key(&app, &map, "other"),
            (app, SYNC_PAYLOAD_VERSION)
        );
        // Unknown note: items key, never a panic.
        assert_eq!(
            asset_seal_for_key(&app, &map, "not-a-note"),
            (app, SYNC_PAYLOAD_VERSION)
        );
    }

    /// A shared note's asset is sealed v6 under the collaboration key: only
    /// that key decrypts it (fail-closed without it), while a pre-existing v5
    /// items-key asset stays readable by the items key alone.
    #[test]
    fn shared_asset_envelope_round_trips_and_needs_shared_key() {
        let shared = [9u8; 32];
        let app = [7u8; 32];
        let flat = "assets--ws-1--note1--a.png";
        let enc =
            encrypt_asset_bytes_versioned(&shared, SHARED_PAYLOAD_VERSION, flat, b"payload").unwrap();
        assert!(is_encrypted_asset_envelope(&enc));
        assert!(enc.starts_with(br#"{"v":6"#));
        assert_eq!(
            decrypt_asset_bytes_with_shared(&app, &[shared], flat, &enc).unwrap(),
            b"payload"
        );
        // No shared key registered: fail closed, never items-key fallback.
        assert!(decrypt_asset_bytes_with_shared(&app, &[], flat, &enc).is_err());
        assert!(decrypt_asset_bytes_with_shared(&app, &[app], flat, &enc).is_err());
        // Personal (v5) asset stays items-key readable even when a shared key
        // is registered for the note.
        let v5 = encrypt_asset_bytes(&app, flat, b"legacy").unwrap();
        assert!(v5.starts_with(br#"{"v":5"#));
        assert_eq!(
            decrypt_asset_bytes_with_shared(&app, &[shared], flat, &v5).unwrap(),
            b"legacy"
        );
    }

    /// A v6 asset whose note key is not registered on this device is skipped
    /// (not fatal, nothing written), while other assets still decrypt.
    #[test]
    fn download_skips_v6_asset_without_registered_note_key() {
        let app = [7u8; 32];
        let shared = [9u8; 32];
        let flat_v6 = "assets--ws-1--note1--a.png";
        let flat_v5 = "assets--ws-1--note2--b.png";
        let v6 = encrypt_asset_bytes_versioned(&shared, SHARED_PAYLOAD_VERSION, flat_v6, b"shared")
            .unwrap();
        let v5 = encrypt_asset_bytes(&app, flat_v5, b"personal").unwrap();

        let no_keys = HashMap::new();
        let no_expected = HashSet::new();
        // The unregistered v6 envelope is skipped, never errored.
        assert_eq!(
            decrypt_downloaded_envelope(&app, &no_keys, &no_expected, "note1", flat_v6, &v6)
                .unwrap(),
            None
        );
        // Other assets (v5, items key) still download in the same pass.
        assert_eq!(
            decrypt_downloaded_envelope(&app, &no_keys, &no_expected, "note2", flat_v5, &v5)
                .unwrap(),
            Some(b"personal".to_vec())
        );
        // Registering the note's key lets the same v6 asset download.
        let mut keys = HashMap::new();
        keys.insert("note1".to_string(), vec![shared]);
        assert_eq!(
            decrypt_downloaded_envelope(&app, &keys, &no_expected, "note1", flat_v6, &v6).unwrap(),
            Some(b"shared".to_vec())
        );
    }

    /// A v5 asset for an expected-shared note with no registered key is skipped
    /// (deferred), not force-decrypted with the items key; a personal note's v5
    /// asset still decrypts in the same pass (finding C1/C9).
    #[test]
    fn download_defers_v5_asset_for_expected_shared_note_without_key() {
        let app = [7u8; 32];
        let flat_shared = "assets--ws-1--note1--a.png";
        let flat_personal = "assets--ws-1--note2--b.png";
        let v5_shared = encrypt_asset_bytes(&app, flat_shared, b"old-shared").unwrap();
        let v5_personal = encrypt_asset_bytes(&app, flat_personal, b"personal").unwrap();

        let no_keys = HashMap::new();
        let expected: HashSet<String> = ["note1".to_string()].into_iter().collect();
        // Expected shared, no key yet: defer the v5 envelope (no items-key
        // forced decrypt, no fatal).
        assert_eq!(
            decrypt_downloaded_envelope(&app, &no_keys, &expected, "note1", flat_shared, &v5_shared)
                .unwrap(),
            None
        );
        // A personal note's v5 asset is unaffected.
        assert_eq!(
            decrypt_downloaded_envelope(
                &app,
                &no_keys,
                &expected,
                "note2",
                flat_personal,
                &v5_personal
            )
            .unwrap(),
            Some(b"personal".to_vec())
        );
        // Once the shared key is registered the mark is gone and the asset is
        // no longer deferred (v6 handoff happens on the seal side).
        let mut keys = HashMap::new();
        keys.insert("note1".to_string(), vec![[9u8; 32]]);
        assert_eq!(
            decrypt_downloaded_envelope(&app, &keys, &HashSet::new(), "note1", flat_shared, &v5_shared)
                .unwrap(),
            Some(b"old-shared".to_vec())
        );
    }

    #[test]
    fn batch_payload_encrypts_each_item() {
        let key = [9u8; 32];
        let payload = build_batch_payload(
            &key,
            &HashMap::new(),
            &[("image--n1--a.png".into(), "n1".into(), b"x".to_vec())],
        )
        .unwrap();
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

    const WS: &str = "ws-1";

    fn key(workspace_id: &str, note_id: &str, filename: &str) -> AssetKey {
        AssetKey {
            ty: ASSET_TYPE.into(),
            workspace_id: Some(workspace_id.into()),
            note_id: note_id.into(),
            filename: filename.into(),
            hashed_filename: false,
        }
    }

    fn legacy_key(note_id: &str, filename: &str) -> AssetKey {
        AssetKey {
            ty: ASSET_TYPE.into(),
            workspace_id: None,
            note_id: note_id.into(),
            filename: filename.into(),
            hashed_filename: false,
        }
    }

    fn enc(ws: &str, note: &str, file: &str) -> Result<String, AppError> {
        encode_asset_key(ASSET_TYPE, ws, note, file)
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
        let ops = plan_asset_ops(
            WS,
            &[("n1".into(), "a.png".into())],
            &[],
            &live,
            &HashSet::new(),
            &HashMap::new(),
            enc,
            |_, _| false,
        )
        .unwrap();
        assert_eq!(
            ops,
            vec![AssetOp::Upload {
                flat_key: enc(WS, "n1", "a.png").unwrap(),
                note_id: "n1".into(),
                filename: "a.png".into(),
            }]
        );
    }

    #[test]
    fn plan_skips_upload_for_dead_note() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let ops = plan_asset_ops(
            WS,
            &[("dead".into(), "a.png".into())],
            &[],
            &live,
            &HashSet::new(),
            &HashMap::new(),
            enc,
            |_, _| false,
        )
        .unwrap();
        assert!(ops.is_empty());
    }

    /// The differ matches uploads by exact key: a local file already remote
    /// under the deterministic new-scheme key is never re-uploaded. The key is
    /// independent of every vault/shared key, so a rotation cannot change it
    /// into a "missing" key (which is exactly the item-3 churn this removes).
    #[test]
    fn plan_skips_upload_when_new_scheme_key_already_remote() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let remote_key = enc(WS, "n1", "a.png").unwrap();
        let remote = vec![(
            remote_key.clone(),
            decode_asset_key_with(&remote_key, &APP_KEY, &HashMap::new()).unwrap(),
        )];
        let ops = plan_asset_ops(
            WS,
            &[("n1".into(), "a.png".into())],
            &remote,
            &live,
            &HashSet::new(),
            &HashMap::new(),
            enc,
            |_, _| true,
        )
        .unwrap();
        assert!(
            ops.is_empty(),
            "a stable key must cause neither an upload nor a delete: {ops:?}"
        );
    }

    /// A pre-existing legacy remote object (readable filename) still suppresses
    /// a duplicate upload under the new scheme.
    #[test]
    fn plan_skips_upload_when_legacy_object_is_already_remote() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let remote = vec![(
            "assets--ws-1--n1--a.png".into(),
            key(WS, "n1", "a.png"),
        )];
        let ops = plan_asset_ops(
            WS,
            &[("n1".into(), "a.png".into())],
            &remote,
            &live,
            &HashSet::new(),
            &HashMap::new(),
            enc,
            |_, _| true,
        )
        .unwrap();
        assert!(!ops.iter().any(|o| matches!(o, AssetOp::Upload { .. })));
    }

    /// Regression: a remote asset for a note this device does not know about
    /// (another workspace, or a peer's note not yet pulled) must never be
    /// deleted from local liveness alone — `GET /assets` is account-global.
    #[test]
    fn plan_never_prunes_untombstoned_remote_note() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let remote = vec![(
            "assets--other-ws--b.png".into(),
            key("other-ws", "b.png", "b.png"),
        )];
        let ops = plan_asset_ops(WS, &[], &remote, &live, &HashSet::new(), &HashMap::new(), enc, |_, _| false).unwrap();
        assert!(
            !ops.iter().any(|o| matches!(o, AssetOp::DeleteRemote { .. })),
            "no tombstone => no remote deletion"
        );
    }

    /// New-scheme key for a tombstoned note in *another* workspace: the
    /// embedded workspace must block the delete.
    #[test]
    fn plan_never_prunes_other_workspace_new_key_even_if_tombstoned() {
        let live: HashSet<String> = HashSet::new();
        let deleted: HashSet<String> = ["dead".to_string()].into_iter().collect();
        let remote_key = enc("other-ws", "dead", "b.png").unwrap();
        let remote = vec![(
            remote_key.clone(),
            decode_asset_key_with(&remote_key, &APP_KEY, &HashMap::new()).unwrap(),
        )];
        let ops = plan_asset_ops(WS, &[], &remote, &live,             &deleted,
            &HashMap::new(),
            enc, |_, _| false).unwrap();
        assert!(
            !ops.iter().any(|o| matches!(o, AssetOp::DeleteRemote { .. })),
            "workspace-scoped key from another workspace must not be pruned"
        );
    }

    /// Tombstone-gated pruning removes exactly the dead note's new-scheme
    /// assets and leaves a live note's alone, even though the filename is no
    /// longer readable from the key (the note association is in the clear).
    #[test]
    fn plan_prunes_exactly_the_tombstoned_notes_new_scheme_assets() {
        let live: HashSet<String> = HashSet::new();
        let deleted: HashSet<String> = ["dead".to_string()].into_iter().collect();
        let dead_key = enc(WS, "dead", "b.png").unwrap();
        let alive_key = enc(WS, "alive", "a.png").unwrap();
        let remote = vec![
            (
                dead_key.clone(),
                decode_asset_key_with(&dead_key, &APP_KEY, &HashMap::new()).unwrap(),
            ),
            (
                alive_key.clone(),
                decode_asset_key_with(&alive_key, &APP_KEY, &HashMap::new()).unwrap(),
            ),
        ];
        let ops = plan_asset_ops(WS, &[], &remote, &live,             &deleted,
            &HashMap::new(),
            enc, |_, _| false).unwrap();
        assert_eq!(
            ops,
            vec![AssetOp::DeleteRemote {
                flat_key: dead_key,
                note_id: "dead".into(),
            }]
        );
    }

    /// Legacy (workspace-unknown) keys are never deleted by the client, even
    /// when their note id is tombstoned; the server GC owns them.
    #[test]
    fn plan_never_deletes_legacy_keys_even_when_tombstoned() {
        let live: HashSet<String> = HashSet::new();
        let deleted: HashSet<String> = ["dead".to_string()].into_iter().collect();
        let remote = vec![(
            "assets--dead--b.png".into(),
            legacy_key("dead", "b.png"),
        )];
        let ops = plan_asset_ops(WS, &[], &remote, &live,             &deleted,
            &HashMap::new(),
            enc, |_, _| false).unwrap();
        assert!(ops.is_empty(), "legacy keys must never drive a client delete");
    }

    #[test]
    fn plan_prunes_only_tombstoned_remote_and_downloads_with_stripped_name() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let deleted: HashSet<String> = ["dead".to_string()].into_iter().collect();
        let remote = vec![
            (
                "assets--ws-1--n1--a.png.enc".into(),
                key(WS, "n1", "a.png.enc"),
            ),
            ("assets--ws-1--dead--b.png".into(), key(WS, "dead", "b.png")),
        ];
        let ops = plan_asset_ops(WS, &[], &remote, &live,             &deleted,
            &HashMap::new(),
            enc, |_, _| false).unwrap();
        assert!(ops.contains(&AssetOp::DeleteRemote {
            flat_key: "assets--ws-1--dead--b.png".into(),
            note_id: "dead".into(),
        }));
        assert!(ops.contains(&AssetOp::Download {
            flat_key: "assets--ws-1--n1--a.png.enc".into(),
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
        let remote = vec![("assets--ws-1--n1--a.png".into(), key(WS, "n1", "a.png"))];
        let ops = plan_asset_ops(
            WS,
            &[],
            &remote,
            &live,
            &HashSet::new(),
            &HashMap::new(),
            enc,
            |n, f| n == "n1" && f == "a.png",
        )
        .unwrap();
        assert!(ops.is_empty());
    }

    /// Minimal tiptap-shaped note: an XmlFragment `content` holding one `image`
    /// node per src, exactly how the editor persists an attachment reference (a
    /// node attribute, not body text).
    fn note_update_with_asset_srcs(srcs: &[&str]) -> Vec<u8> {
        use yrs::{Doc, ReadTxn, StateVector, Transact, Xml, XmlElementPrelim, XmlFragment};
        let doc = Doc::new();
        let frag = doc.get_or_insert_xml_fragment("content");
        {
            let mut txn = doc.transact_mut();
            for src in srcs {
                let el = frag.push_back(&mut txn, XmlElementPrelim::empty("image"));
                el.insert_attribute(&mut txn, "src", *src);
            }
        }
        let update = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        update
    }

    fn refs_by_note(refs: &[(String, String)]) -> HashMap<String, HashSet<String>> {
        let mut map: HashMap<String, HashSet<String>> = HashMap::new();
        for (note, file) in refs {
            map.entry(note.clone()).or_default().insert(file.clone());
        }
        map
    }

    /// Attachment refs live in node attributes; only `assets://` (and the
    /// legacy `file-assets://`) refs are extracted, and the whole filename
    /// survives (spaces included).
    #[test]
    fn extract_asset_refs_reads_node_attributes() {
        let update = note_update_with_asset_srcs(&[
            "assets://n1/a.png",
            "https://example.com/b.png",
            "data:image/png;base64,AAAA",
            "blob:http://localhost/x",
            "assets://n2/b file.pdf",
        ]);
        let refs: HashSet<(String, String)> = extract_asset_refs(&update).into_iter().collect();
        assert_eq!(
            refs,
            HashSet::from([
                ("n1".to_string(), "a.png".to_string()),
                ("n2".to_string(), "b file.pdf".to_string()),
            ])
        );
    }

    /// A ref embedded in a text node (e.g. a pasted link) is recovered too.
    #[test]
    fn extract_asset_refs_scans_text_nodes() {
        use yrs::{Doc, ReadTxn, StateVector, Text, Transact};
        let doc = Doc::new();
        let t = doc.get_or_insert_text("title");
        {
            let mut txn = doc.transact_mut();
            t.insert(&mut txn, 0, "see assets://n1/a.png now");
        }
        let update = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        assert_eq!(
            extract_asset_refs(&update),
            vec![("n1".to_string(), "a.png".to_string())]
        );
    }

    #[test]
    fn extract_asset_refs_on_empty_or_garbage_is_empty() {
        assert!(extract_asset_refs(&[]).is_empty());
        assert!(extract_asset_refs(b"not a yjs update").is_empty());
    }

    /// Limit 1: the walk must be schema-agnostic. A reference inside a root
    /// that is neither `content` nor `title` (here a custom XML fragment, with
    /// the ref in an element attribute) is still found.
    #[test]
    fn extract_asset_refs_finds_refs_in_a_non_schema_root() {
        use yrs::{Doc, ReadTxn, StateVector, Transact, Xml, XmlElementPrelim, XmlFragment};
        let doc = Doc::new();
        let frag = doc.get_or_insert_xml_fragment("custom-blocks");
        {
            let mut txn = doc.transact_mut();
            let el = frag.push_back(&mut txn, XmlElementPrelim::empty("image"));
            el.insert_attribute(&mut txn, "src", "assets://n9/custom.png");
        }
        let update = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        assert_eq!(
            extract_asset_refs(&update),
            vec![("n9".to_string(), "custom.png".to_string())]
        );
    }

    /// Limit 1: same, for a text root other than `title`.
    #[test]
    fn extract_asset_refs_finds_refs_in_a_non_schema_text_root() {
        use yrs::{Doc, ReadTxn, StateVector, Text, Transact};
        let doc = Doc::new();
        let t = doc.get_or_insert_text("body");
        {
            let mut txn = doc.transact_mut();
            t.insert(&mut txn, 0, "see assets://n8/other.pdf now");
        }
        let update = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        assert_eq!(
            extract_asset_refs(&update),
            vec![("n8".to_string(), "other.pdf".to_string())]
        );
    }

    /// A note with no asset references downloads nothing.
    #[test]
    fn plan_downloads_nothing_when_note_has_no_references() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let remote_key = enc(WS, "n1", "a.png").unwrap();
        let remote = vec![(
            remote_key.clone(),
            decode_asset_key_with(&remote_key, &APP_KEY, &HashMap::new()).unwrap(),
        )];
        let ops =
            plan_asset_ops(WS, &[], &remote, &live, &HashSet::new(), &HashMap::new(), enc, |_, _| {
                false
            })
            .unwrap();
        assert!(
            ops.is_empty(),
            "a hashed key with no reference has no destination: {ops:?}"
        );
    }

    /// The reference-driven pull: the filename comes from the note's own
    /// `assets://` content, never from the opaque key.
    #[test]
    fn plan_downloads_referenced_new_scheme_asset_missing_locally() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let remote_key = enc(WS, "n1", "a.png").unwrap();
        let remote = vec![(
            remote_key.clone(),
            decode_asset_key_with(&remote_key, &APP_KEY, &HashMap::new()).unwrap(),
        )];
        let referenced =
            HashMap::from([("n1".to_string(), HashSet::from(["a.png".to_string()]))]);
        let ops =
            plan_asset_ops(WS, &[], &remote, &live, &HashSet::new(), &referenced, enc, |_, _| {
                false
            })
            .unwrap();
        assert_eq!(
            ops,
            vec![AssetOp::Download {
                flat_key: remote_key,
                note_id: "n1".into(),
                filename: "a.png".into(),
            }]
        );
    }

    /// End to end at the differ boundary: refs parsed straight from the note's
    /// Yjs content drive the download.
    #[test]
    fn plan_downloads_from_note_content_reference() {
        let update = note_update_with_asset_srcs(&["assets://n1/a.png"]);
        let referenced = refs_by_note(&extract_asset_refs(&update));
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let remote_key = enc(WS, "n1", "a.png").unwrap();
        let remote = vec![(
            remote_key.clone(),
            decode_asset_key_with(&remote_key, &APP_KEY, &HashMap::new()).unwrap(),
        )];
        let ops =
            plan_asset_ops(WS, &[], &remote, &live, &HashSet::new(), &referenced, enc, |_, _| {
                false
            })
            .unwrap();
        assert_eq!(
            ops,
            vec![AssetOp::Download {
                flat_key: remote_key,
                note_id: "n1".into(),
                filename: "a.png".into(),
            }]
        );
    }

    /// A local copy already present means no download, even when referenced.
    #[test]
    fn plan_skips_referenced_download_when_local_file_exists() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let remote_key = enc(WS, "n1", "a.png").unwrap();
        let remote = vec![(
            remote_key.clone(),
            decode_asset_key_with(&remote_key, &APP_KEY, &HashMap::new()).unwrap(),
        )];
        let referenced =
            HashMap::from([("n1".to_string(), HashSet::from(["a.png".to_string()]))]);
        let ops = plan_asset_ops(
            WS,
            &[],
            &remote,
            &live,
            &HashSet::new(),
            &referenced,
            enc,
            |n, f| n == "n1" && f == "a.png",
        )
        .unwrap();
        assert!(ops.is_empty());
    }

    /// A referenced file that is not in the remote listing is skipped, never an
    /// error, and never guessed onto another object.
    #[test]
    fn plan_skips_reference_missing_remotely() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let other_key = enc(WS, "n1", "other.png").unwrap();
        let remote = vec![(
            other_key.clone(),
            decode_asset_key_with(&other_key, &APP_KEY, &HashMap::new()).unwrap(),
        )];
        let referenced =
            HashMap::from([("n1".to_string(), HashSet::from(["missing.png".to_string()]))]);
        let ops =
            plan_asset_ops(WS, &[], &remote, &live, &HashSet::new(), &referenced, enc, |_, _| {
                false
            })
            .unwrap();
        assert!(ops.is_empty(), "an absent remote object is a skip: {ops:?}");
    }

    /// The DB plumbing: filenames are recovered from the note's stored Yjs
    /// content, but only for notes that own an unsatisfied remote new key.
    #[test]
    fn referenced_assets_recovers_filenames_from_stored_note_content() {
        let root = unique_temp_dir("beaver-notes-asset-refs");
        std::fs::create_dir_all(&root).unwrap();
        let pool = crate::db::open_pool(&root.join("data.db")).expect("pool");
        let update = note_update_with_asset_srcs(&["assets://n1/a.png"]);
        let stored = crate::shared::encrypt_yjs_blob(&APP_KEY, &update).unwrap();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO note_content (note_id, data, created_at) VALUES (?1, ?2, 0)",
                rusqlite::params!["n1", stored],
            )
            .unwrap();
        }
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let remote_key = enc(WS, "n1", "a.png").unwrap();
        let remote = vec![(
            remote_key.clone(),
            decode_asset_key_with(&remote_key, &APP_KEY, &HashMap::new()).unwrap(),
        )];
        let referenced = referenced_assets(&pool, &remote, &[], &live, WS, APP_KEY).unwrap();
        assert_eq!(
            referenced.get("n1"),
            Some(&HashSet::from(["a.png".to_string()]))
        );
        // A local copy satisfies the remote key, so the note is not a candidate
        // and its content is not read.
        let local = vec![("n1".to_string(), "a.png".to_string())];
        let referenced = referenced_assets(&pool, &remote, &local, &live, WS, APP_KEY).unwrap();
        assert!(referenced.is_empty());
        drop(pool);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Limit 3: a file can be referenced from note X while belonging to note Y.
    /// The scan must find X's ref even though X owns no unsatisfied key, and the
    /// resulting download must stay keyed on Y (the referenced owner).
    #[test]
    fn referenced_assets_recovers_a_cross_note_reference() {
        let root = unique_temp_dir("beaver-notes-asset-cross-note");
        std::fs::create_dir_all(&root).unwrap();
        let pool = crate::db::open_pool(&root.join("data.db")).expect("pool");
        // n1 (X) references n2's (Y's) file. n2's own content references a
        // different, unrelated name and owns the only remote key.
        let x_update = note_update_with_asset_srcs(&["assets://n2/b.png"]);
        let y_update = note_update_with_asset_srcs(&["assets://n2/unrelated.png"]);
        let stored_x = crate::shared::encrypt_yjs_blob(&APP_KEY, &x_update).unwrap();
        let stored_y = crate::shared::encrypt_yjs_blob(&APP_KEY, &y_update).unwrap();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO note_content (note_id, data, created_at) VALUES (?1, ?2, 0)",
                rusqlite::params!["n1", stored_x],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO note_content (note_id, data, created_at) VALUES (?1, ?2, 0)",
                rusqlite::params!["n2", stored_y],
            )
            .unwrap();
        }
        let live: HashSet<String> = ["n1".to_string(), "n2".to_string()].into_iter().collect();
        let remote_key = enc(WS, "n2", "b.png").unwrap();
        let remote = vec![(
            remote_key.clone(),
            decode_asset_key_with(&remote_key, &APP_KEY, &HashMap::new()).unwrap(),
        )];

        let referenced = referenced_assets(&pool, &remote, &[], &live, WS, APP_KEY).unwrap();
        assert!(
            referenced
                .get("n2")
                .is_some_and(|files| files.contains("b.png")),
            "X's reference to Y's file must be recovered from X's content: {referenced:?}"
        );
        let ops = plan_asset_ops(
            WS,
            &[],
            &remote,
            &live,
            &HashSet::new(),
            &referenced,
            enc,
            |_, _| false,
        )
        .unwrap();
        assert_eq!(
            ops,
            vec![AssetOp::Download {
                flat_key: remote_key,
                note_id: "n2".into(),
                filename: "b.png".into(),
            }],
            "the download is attributed to Y, the referenced owner"
        );
        drop(pool);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The cheap pre-filter: a decrypted snapshot can only contain an
    /// `assets://` reference if the marker bytes appear, so the expensive Yjs
    /// decode is skipped for ordinary text-only notes.
    #[test]
    fn snapshot_prefilter_only_matches_asset_markers() {
        assert!(!snapshot_may_reference_assets(b""));
        assert!(!snapshot_may_reference_assets(b"plain prose, no attachments"));
        assert!(snapshot_may_reference_assets(b"see assets://n1/a.png now"));
        assert!(snapshot_may_reference_assets(b"file-assets://n1/a.png"));
    }

    /// A permanently-broken cross-note reference must not keep re-reading the
    /// vault: once the unresolved key is found in an earlier fallback note, the
    /// remainder of the pass stops, and no note is ever read twice.
    #[test]
    fn referenced_assets_stops_scanning_once_resolved_and_never_re_reads() {
        // n1 owns the unsatisfied key (`b.png`); n1's own content does not
        // reference it, n2's does, n3 is unrelated. Sorted fallback order puts
        // n2 before n3.
        let store: HashMap<String, Vec<u8>> = HashMap::from([
            (
                "n1".to_string(),
                note_update_with_asset_srcs(&["assets://n1/own.png"]),
            ),
            (
                "n2".to_string(),
                note_update_with_asset_srcs(&["assets://n1/b.png"]),
            ),
            (
                "n3".to_string(),
                note_update_with_asset_srcs(&["assets://n3/other.png"]),
            ),
        ]);
        let remote_key = enc(WS, "n1", "b.png").unwrap();
        let remote = vec![(
            remote_key.clone(),
            decode_asset_key_with(&remote_key, &APP_KEY, &HashMap::new()).unwrap(),
        )];
        let live: HashSet<String> = ["n1", "n2", "n3"].iter().map(|s| s.to_string()).collect();

        let mut reads: Vec<String> = Vec::new();
        let referenced = referenced_assets_with(&remote, &[], &live, WS, |note| {
            reads.push(note.to_string());
            Ok(store.get(note).cloned().unwrap_or_default())
        })
        .unwrap();

        assert!(
            referenced
                .get("n1")
                .is_some_and(|files| files.contains("b.png")),
            "the cross-note reference must still be recovered: {referenced:?}"
        );
        assert_eq!(
            reads,
            vec!["n1".to_string(), "n2".to_string()],
            "n3 must not be read once the key is resolved"
        );
        let mut unique = reads.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), reads.len(), "no note may be read twice");
    }

    /// Limit 2 regression guard: with no note body locally there is nothing to
    /// plan; as soon as a pulled body lands, the same inputs plan the download
    /// (the same-tick pull→assets ordering in `run_tick_inner` makes this
    /// prompt — no extra tick is required).
    #[test]
    fn fresh_device_plans_download_as_soon_as_note_body_lands() {
        let root = unique_temp_dir("beaver-notes-asset-fresh-device");
        std::fs::create_dir_all(&root).unwrap();
        let pool = crate::db::open_pool(&root.join("data.db")).expect("pool");
        let remote_key = enc(WS, "n1", "a.png").unwrap();
        let remote = vec![(
            remote_key.clone(),
            decode_asset_key_with(&remote_key, &APP_KEY, &HashMap::new()).unwrap(),
        )];
        // No note body yet: nothing to recover, nothing planned.
        let empty_live: HashSet<String> = HashSet::new();
        let referenced = referenced_assets(&pool, &remote, &[], &empty_live, WS, APP_KEY).unwrap();
        assert!(referenced.is_empty());
        let ops = plan_asset_ops(
            WS,
            &[],
            &remote,
            &empty_live,
            &HashSet::new(),
            &referenced,
            enc,
            |_, _| false,
        )
        .unwrap();
        assert!(ops.is_empty(), "no body yet: nothing to download");

        // The pulled body lands: the same pass now plans the download.
        let update = note_update_with_asset_srcs(&["assets://n1/a.png"]);
        let stored = crate::shared::encrypt_yjs_blob(&APP_KEY, &update).unwrap();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO note_content (note_id, data, created_at) VALUES (?1, ?2, 0)",
                rusqlite::params!["n1", stored],
            )
            .unwrap();
        }
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let referenced = referenced_assets(&pool, &remote, &[], &live, WS, APP_KEY).unwrap();
        let ops = plan_asset_ops(
            WS,
            &[],
            &remote,
            &live,
            &HashSet::new(),
            &referenced,
            enc,
            |_, _| false,
        )
        .unwrap();
        assert_eq!(
            ops,
            vec![AssetOp::Download {
                flat_key: remote_key,
                note_id: "n1".into(),
                filename: "a.png".into(),
            }]
        );
        drop(pool);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Legacy remote asset for a live note is still downloaded (workspace
    /// unknown but note ids are unique); it is simply never deleted.
    #[test]
    fn plan_downloads_live_legacy_remote_asset() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let remote = vec![("assets--n1--a.png".into(), legacy_key("n1", "a.png"))];
        let ops = plan_asset_ops(WS, &[], &remote, &live, &HashSet::new(), &HashMap::new(), enc, |_, _| false).unwrap();
        assert_eq!(
            ops,
            vec![AssetOp::Download {
                flat_key: "assets--n1--a.png".into(),
                note_id: "n1".into(),
                filename: "a.png".into(),
            }]
        );
    }

    /// A workspace-scoped remote key for a note not live locally is not
    /// downloaded, even when the workspace matches.
    #[test]
    fn plan_skips_download_for_non_live_workspace_key() {
        let live: HashSet<String> = HashSet::new();
        let remote = vec![("assets--ws-1--n1--a.png".into(), key(WS, "n1", "a.png"))];
        let ops = plan_asset_ops(WS, &[], &remote, &live, &HashSet::new(), &HashMap::new(), enc, |_, _| false).unwrap();
        assert!(ops.is_empty());
    }

    #[test]
    fn plan_ignores_non_assets_remote_keys() {
        let live: HashSet<String> = ["n1".to_string()].into_iter().collect();
        let remote = vec![(
            "notes-assets--ws-1--n1--a.png".into(),
            AssetKey {
                ty: "notes-assets".into(),
                workspace_id: Some(WS.into()),
                note_id: "n1".into(),
                filename: "a.png".into(),
                hashed_filename: false,
            },
        )];
        let ops = plan_asset_ops(WS, &[], &remote, &live, &HashSet::new(), &HashMap::new(), enc, |_, _| false).unwrap();
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

    fn write_sized(path: &std::path::Path, len: usize, mtime_secs: u64) {
        std::fs::write(path, vec![b'x'; len]).expect("write sized file");
        let t = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(mtime_secs);
        std::fs::File::options()
            .write(true)
            .open(path)
            .expect("open for mtime")
            .set_modified(t)
            .expect("set mtime");
    }

    #[test]
    fn asset_should_copy_treats_size_as_truncation_evidence_not_a_trump() {
        let root = unique_temp_dir("beaver-notes-asset-should-copy");
        std::fs::create_dir_all(&root).unwrap();
        let complete = root.join("complete.bin");
        let partial = root.join("partial.bin");
        std::fs::write(&complete, b"complete-content").unwrap();
        std::fs::write(&partial, b"short").unwrap();
        assert!(
            asset_should_copy(&complete, &root.join("missing.bin")).unwrap(),
            "a missing destination must be filled"
        );
        assert!(
            asset_should_copy(&complete, &partial).unwrap(),
            "a larger source is the complete copy: a smaller destination is truncated and repaired"
        );
        assert!(
            !asset_should_copy(&partial, &complete).unwrap(),
            "a smaller source looks truncated itself and must never overwrite the larger destination"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// F1 (a): the sync→local leg runs first; an older folder copy must not
    /// clobber a newer, larger local asset just because the sizes differ.
    #[test]
    fn folder_mirror_keeps_a_newer_larger_local_asset() {
        let root = unique_temp_dir("beaver-notes-mirror-local-wins");
        let folder = root.join("folder");
        let local = root.join("local");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::create_dir_all(&local).unwrap();
        write_sized(&folder.join("a.bin"), 4, 1_000);
        write_sized(&local.join("a.bin"), 32, 2_000);
        let copied = mirror_asset_dir(&folder, &local).unwrap();
        assert_eq!(
            copied, 0,
            "an older/partial folder copy must not overwrite the newer local asset"
        );
        assert_eq!(std::fs::read(local.join("a.bin")).unwrap().len(), 32);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// F1 (b): a truncated destination is smaller and (because the interrupting
    /// write bumped it) newer; the complete source still repairs it.
    #[test]
    fn folder_mirror_repairs_a_truncated_newer_local_asset() {
        let root = unique_temp_dir("beaver-notes-mirror-repair-local");
        let folder = root.join("folder");
        let local = root.join("local");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::create_dir_all(&local).unwrap();
        write_sized(&folder.join("a.bin"), 32, 1_000);
        write_sized(&local.join("a.bin"), 4, 2_000);
        assert_eq!(mirror_asset_dir(&folder, &local).unwrap(), 1);
        assert_eq!(std::fs::read(local.join("a.bin")).unwrap().len(), 32);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// F1 (c): the reverse (local→folder) leg is decided by the same rule, so an
    /// older/partial local copy must not clobber the newer folder asset.
    #[test]
    fn local_mirror_keeps_a_newer_larger_folder_asset() {
        let root = unique_temp_dir("beaver-notes-mirror-folder-wins");
        let folder = root.join("folder");
        let local = root.join("local");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::create_dir_all(&local).unwrap();
        write_sized(&local.join("a.bin"), 4, 1_000);
        write_sized(&folder.join("a.bin"), 32, 2_000);
        let copied = mirror_asset_dir(&local, &folder).unwrap();
        assert_eq!(
            copied, 0,
            "an older/partial local copy must not overwrite the newer folder asset"
        );
        assert_eq!(std::fs::read(folder.join("a.bin")).unwrap().len(), 32);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn local_mirror_repairs_a_truncated_newer_folder_asset() {
        let root = unique_temp_dir("beaver-notes-mirror-repair-folder");
        let folder = root.join("folder");
        let local = root.join("local");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::create_dir_all(&local).unwrap();
        write_sized(&local.join("a.bin"), 32, 1_000);
        write_sized(&folder.join("a.bin"), 4, 2_000);
        assert_eq!(mirror_asset_dir(&local, &folder).unwrap(), 1);
        assert_eq!(std::fs::read(folder.join("a.bin")).unwrap().len(), 32);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn mirror_treats_mtime_as_authoritative_at_equal_size() {
        let root = unique_temp_dir("beaver-notes-mirror-mtime");
        let folder = root.join("folder");
        let local = root.join("local");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::create_dir_all(&local).unwrap();
        write_sized(&folder.join("a.bin"), 8, 1_000);
        write_sized(&local.join("a.bin"), 8, 2_000);
        assert_eq!(
            mirror_asset_dir(&folder, &local).unwrap(),
            0,
            "equal size: an older source loses"
        );
        write_sized(&folder.join("a.bin"), 8, 3_000);
        assert_eq!(
            mirror_asset_dir(&folder, &local).unwrap(),
            1,
            "equal size: a strictly newer source wins"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn atomic_copy_file_replaces_and_leaves_no_temp() {
        let root = unique_temp_dir("beaver-notes-asset-atomic-copy");
        std::fs::create_dir_all(&root).unwrap();
        let src = root.join("src.bin");
        let dst = root.join("dst.bin");
        std::fs::write(&src, b"new content").unwrap();
        std::fs::write(&dst, b"old").unwrap();
        atomic_copy_file(&src, &dst).unwrap();
        assert_eq!(std::fs::read(&dst).unwrap(), b"new content");
        let leftovers = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("mirror"))
            .count();
        assert_eq!(leftovers, 0, "temp file must be renamed away");
        let _ = std::fs::remove_dir_all(&root);
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

    #[test]
    fn yjs_delete_records_tombstone_and_removes_rows() {
        let root = unique_temp_dir("beaver-notes-asset-tombstone");
        let _ = std::fs::create_dir_all(&root);
        let pool = crate::db::open_pool(&root.join("data.db")).expect("pool");
        {
            let conn = pool.get().expect("conn");
            conn.execute(
                "INSERT INTO note_content (note_id, data, created_at) VALUES (?1, ?2, 0)",
                rusqlite::params!["n1", b"a".as_slice()],
            )
            .expect("insert");
        }
        crate::db::yjs_delete(&pool, "n1", "ws-1").expect("delete");
        assert!(live_note_ids(&pool).expect("live").is_empty());
        assert_eq!(
            crate::db::deleted_note_ids(&pool, "ws-1").expect("tombstones"),
            vec!["n1".to_string()]
        );
        // Unknown-workspace tombstones surface for every workspace.
        assert_eq!(
            crate::db::deleted_note_ids(&pool, "other-ws").expect("tombstones"),
            Vec::<String>::new()
        );
        drop(pool);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn deleted_note_ids_includes_unknown_workspace_records() {
        let root = unique_temp_dir("beaver-notes-asset-tombstone-unknown");
        let _ = std::fs::create_dir_all(&root);
        let pool = crate::db::open_pool(&root.join("data.db")).expect("pool");
        crate::db::yjs_delete(&pool, "offline-deleted", "").expect("delete");
        let ids = crate::db::deleted_note_ids(&pool, "any-ws").expect("tombstones");
        assert_eq!(ids, vec!["offline-deleted".to_string()]);
        drop(pool);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn clear_deleted_notes_removes_only_named_notes() {
        let root = unique_temp_dir("beaver-notes-asset-tombstone-clear");
        let _ = std::fs::create_dir_all(&root);
        let pool = crate::db::open_pool(&root.join("data.db")).expect("pool");
        crate::db::yjs_delete(&pool, "n1", "ws-1").expect("delete n1");
        crate::db::yjs_delete(&pool, "n2", "ws-1").expect("delete n2");
        crate::db::clear_deleted_notes(&pool, &["n1".to_string()]).expect("clear");
        assert_eq!(
            crate::db::deleted_note_ids(&pool, "ws-1").expect("tombstones"),
            vec!["n2".to_string()]
        );
        drop(pool);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// F7: a locally-deleted mirrored asset is tombstoned so folder→local does
    /// not resurrect it; re-adding the file locally clears the tombstone.
    #[test]
    fn folder_tombstones_suppress_resurrected_assets() {
        let prev: HashSet<String> = ["a.png".to_string()].into_iter().collect();
        // Local copy deleted: becomes a tombstone.
        let tombstones = updated_folder_tombstones(&HashSet::new(), &prev, HashSet::new());
        assert!(tombstones.contains("a.png"), "deleted asset must be tombstoned");
        // Re-adding the file locally clears it.
        let readded: HashSet<String> = ["a.png".to_string()].into_iter().collect();
        let cleared = updated_folder_tombstones(&readded, &prev, tombstones);
        assert!(!cleared.contains("a.png"), "re-added asset must clear its tombstone");
    }

    /// An item-3 opaque token's base64url payload may itself contain `--`. The
    /// decoder must try opaque decryption before structural parsing, or such a
    /// key is misread as a legacy key and its note id is lost (no tombstone
    /// cleanup). Fixture: APP_KEY, plaintext `v1|ws-1|note_2|f17.png`.
    const LEGACY_OPAQUE_DOUBLE_DASH_KEY: &str =
        "assets--j0HYhurHoihNUR7rum4UdytsDfLfStZQbZiCEp4_dtB-faX0nQXYeHzUNI--B4LaLcSbUSOiZH0GOq7Wigc";

    #[test]
    fn decode_asset_key_with_prioritises_opaque_tokens_over_segments() {
        assert!(
            LEGACY_OPAQUE_DOUBLE_DASH_KEY.contains("--"),
            "fixture must exercise the `--`-in-token case"
        );
        let d =
            decode_asset_key_with(LEGACY_OPAQUE_DOUBLE_DASH_KEY, &APP_KEY, &HashMap::new()).unwrap();
        assert_eq!(d.workspace_id.as_deref(), Some("ws-1"));
        assert_eq!(d.note_id, "note_2");
        assert_eq!(d.filename, "f17.png");
        assert!(!d.hashed_filename);
    }
}
