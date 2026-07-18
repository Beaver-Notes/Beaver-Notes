use std::{
    fs::{self, File},
    io::{BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2, Params, Version,
};
use chacha20poly1305::{
    aead::{generic_array::GenericArray, Payload},
    XChaCha20Poly1305,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use hmac::Hmac;
use keyring::Entry;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::AppHandle;

use super::super::{
    app_encryption_manifest_path, get_settings_value, AppError, AppState, SAFE_STORAGE_SERVICE,
};

pub(crate) const SAFE_STORAGE_MASTER_ACCOUNT: &str = "__safe_storage_master_key__";
pub(crate) const PBKDF2_ITERATIONS: u32 = 100_000;
pub(crate) const ARGON2_MEMORY_KIB: u32 = 16 * 1024;
pub(crate) const ARGON2_ITERATIONS: u32 = 2;
pub(crate) const ARGON2_PARALLELISM: u32 = 2;
pub(crate) const ENCRYPTION_MANIFEST_VERSION: u8 = 4;
pub(crate) const APP_PASSWORD_CHECK: &str = "BeaverNotes-app-manifest-v4";
pub(crate) const APP_ENCRYPTION_SCOPE: &str = "app";
pub(crate) const STREAM_CHUNK_SIZE: usize = 256 * 1024;
pub(crate) const SYNC_ROOT_DIR: &str = "BeaverNotesSync";
pub(crate) const PROTOCOL_VERSION: u8 = 4;
pub(crate) const SYNC_KEY_PARAMS_FILE: &str = "keyParams.json";
/// AAD binding for note-content encryption. Fixed domain string: it proves the
/// ciphertext is genuine note content (and not forged/moved across contexts).
pub(crate) const NOTE_AAD: &str = "beaver-notes:note-content:v1";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WrappedKeyEnvelope {
    pub(crate) nonce: String,
    pub(crate) cipher: String,
}

/// A previously-active items key that has been rotated out. The key bytes are
/// wrapped (encrypted) with the master KEK so they can be unwrapped into the
/// in-memory ring at unlock time for decrypting old notes.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviousWrappedKey {
    pub(crate) id: String,
    pub(crate) nonce: String,
    pub(crate) cipher: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EncryptionManifest {
    pub(crate) version: u8,
    pub(crate) scope: String,
    #[serde(default)]
    pub(crate) kdf_iterations: u32,
    #[serde(default)]
    pub(crate) salt_hex: String,
    #[serde(default)]
    pub(crate) argon2_salt_hex: Option<String>,
    #[serde(default)]
    pub(crate) argon2_memory_kib: Option<u32>,
    #[serde(default)]
    pub(crate) argon2_iterations: Option<u32>,
    #[serde(default)]
    pub(crate) argon2_parallelism: Option<u32>,
    pub(crate) password_check: WrappedKeyEnvelope,
    pub(crate) wrapped_key: WrappedKeyEnvelope,
    /// Current items-key ID so newly-encrypted notes carry a `kid` reference.
    #[serde(default)]
    pub(crate) current_key_id: String,
    /// Ring of previously-active items keys (wrapped with the KEK) so they can
    /// be loaded at unlock time and used to decrypt notes written before the
    /// most recent rotation.
    #[serde(default)]
    pub(crate) previous_keys: Vec<PreviousWrappedKey>,
}

const MASTER_KEY_FILE: &str = "master.key";

fn derive_kek(passphrase: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0_u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    key
}

pub(crate) fn derive_kek_argon2id(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], AppError> {
    let argon2 = Argon2::new(
        argon2::Algorithm::Argon2id,
        Version::V0x13,
        Params::new(
            ARGON2_MEMORY_KIB,
            ARGON2_ITERATIONS,
            ARGON2_PARALLELISM,
            Some(32),
        )?,
    );
    let salt_string = SaltString::encode_b64(salt)?;
    let hash = argon2.hash_password(passphrase.as_bytes(), &salt_string)?;
    let mut key = [0u8; 32];
    let hash_output = hash.hash.unwrap();
    let hash_bytes = hash_output.as_bytes();
    key.copy_from_slice(&hash_bytes[..32]);
    Ok(key)
}

pub(crate) fn derive_kek_from_manifest(
    manifest: &EncryptionManifest,
    passphrase: &str,
) -> Result<[u8; 32], AppError> {
    if manifest.version >= 3 {
        let salt = manifest
            .argon2_salt_hex
            .as_ref()
            .ok_or_else(|| AppError::Crypto("Argon2 salt missing in v3 manifest".into()))?;
        let salt = hex::decode(salt.trim())?;
        derive_kek_argon2id(passphrase, &salt)
    } else {
        let salt = hex::decode(manifest.salt_hex.trim())?;
        Ok(derive_kek(passphrase, &salt))
    }
}

fn random_key() -> [u8; 32] {
    let mut key = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    key
}

pub(crate) fn random_nonce() -> [u8; 12] {
    let mut nonce = [0_u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    nonce
}

pub(crate) fn derive_chunk_nonce(seed: &[u8; 12], chunk_index: u64, key: &[u8; 32]) -> [u8; 12] {
    use hmac::Mac;
    let mut h = <Hmac<sha2::Sha384> as Mac>::new_from_slice(key).expect("HMAC key length is valid");
    h.update(seed);
    h.update(b"BeaverNotes-asset-chunk");
    h.update(&chunk_index.to_le_bytes());
    let result = h.finalize().into_bytes();
    let mut nonce = [0_u8; 12];
    nonce.copy_from_slice(&result[..12]);
    nonce
}

pub(crate) fn encrypt_bytes_with_key(
    key: &[u8; 32],
    plain: &[u8],
) -> Result<WrappedKeyEnvelope, AppError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = random_nonce();
    let encrypted = cipher.encrypt(Nonce::from_slice(&nonce), plain)?;
    Ok(WrappedKeyEnvelope {
        nonce: hex::encode(nonce),
        cipher: BASE64.encode(encrypted),
    })
}

pub(crate) fn decrypt_bytes_with_key(
    key: &[u8; 32],
    envelope: &WrappedKeyEnvelope,
) -> Result<Vec<u8>, AppError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = hex::decode(envelope.nonce.trim())?;
    let encrypted = BASE64.decode(envelope.cipher.trim())?;
    cipher
        .decrypt(Nonce::from_slice(&nonce), encrypted.as_slice())
        .map_err(|_| AppError::WrongPassword)
}

pub(crate) fn xnonce() -> [u8; 24] {
    let mut nonce = [0_u8; 24];
    rand::thread_rng().fill_bytes(&mut nonce);
    nonce
}

/// AEAD envelope used for all JSON payloads (sync commits, genesis, snapshot).
/// XChaCha20-Poly1305 with a 24-byte nonce and AAD binding the ciphertext to its
/// identity (commit id / snapshot / genesis marker).
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncEnvelope {
    pub(crate) v: u8,
    pub(crate) iv: String,
    pub(crate) enc: String,
}

pub(crate) fn aead_encrypt_json(
    key: &[u8; 32],
    value: &serde_json::Value,
    aad: &str,
) -> Result<SyncEnvelope, AppError> {
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|_| AppError::Crypto("Invalid sync key length".into()))?;
    let nonce_arr = xnonce();
    let nonce = GenericArray::from(nonce_arr);
    let plaintext = serde_json::to_vec(value)?;
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: &plaintext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| AppError::Crypto("AEAD encryption failed".into()))?;
    Ok(SyncEnvelope {
        v: PROTOCOL_VERSION,
        iv: hex::encode(nonce_arr),
        enc: BASE64.encode(ciphertext),
    })
}

pub(crate) fn aead_decrypt_json(
    key: &[u8; 32],
    envelope: &SyncEnvelope,
    aad: &str,
) -> Result<serde_json::Value, AppError> {
    if envelope.v != PROTOCOL_VERSION {
        return Err(AppError::Crypto(format!(
            "Unsupported envelope version: {}",
            envelope.v
        )));
    }
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|_| AppError::Crypto("Invalid sync key length".into()))?;
    let nonce_arr: [u8; 24] = hex::decode(envelope.iv.trim())?
        .try_into()
        .map_err(|_| AppError::Crypto("Invalid nonce length".into()))?;
    let nonce = GenericArray::from(nonce_arr);
    let ciphertext = BASE64.decode(envelope.enc.trim())?;
    let plaintext = cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &ciphertext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| AppError::WrongPassword)?;
    Ok(serde_json::from_slice(&plaintext)?)
}

// ── Shared key params (Standard Notes-style items key distribution) ──────────
//
// The items key is random and wrapped by the master key. To let a second device
// derive the SAME master key (and thus unwrap the SAME items key) we publish the
// public KDF parameters (salt) plus the wrapped items key in the sync folder.
// This file is public: only a device with the correct passphrase can unwrap the
// items key.

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeyParams {
    pub(crate) version: u8,
    pub(crate) kdf: String,
    pub(crate) salt_hex: String,
    pub(crate) argon2_memory_kib: u32,
    pub(crate) argon2_iterations: u32,
    pub(crate) argon2_parallelism: u32,
    pub(crate) wrapped_items_key: WrappedKeyEnvelope,
}

pub(crate) fn sync_key_params_path(
    app: &AppHandle,
    state: &AppState,
) -> Result<Option<PathBuf>, AppError> {
    let sync_path =
        get_settings_value(app, state, "syncPath").and_then(|v| v.as_str().map(|s| s.to_string()));
    let Some(sync_path) = sync_path else {
        return Ok(None);
    };
    Ok(Some(
        PathBuf::from(sync_path)
            .join(SYNC_ROOT_DIR)
            .join(SYNC_KEY_PARAMS_FILE),
    ))
}

pub(crate) fn publish_key_params(app: &AppHandle, state: &AppState) -> Result<(), AppError> {
    let Some(path) = sync_key_params_path(app, state)? else {
        return Ok(());
    };
    let manifest_path = app_encryption_manifest_path(app, state)?;
    let manifest = load_encryption_manifest(&manifest_path)?
        .ok_or_else(|| AppError::Crypto("Encryption manifest is missing".into()))?;
    if manifest.version < 3 {
        return Err(AppError::Crypto(
            "Encryption manifest is too old to share keys".into(),
        ));
    }
    let params = KeyParams {
        version: PROTOCOL_VERSION,
        kdf: "argon2id".to_string(),
        salt_hex: manifest
            .argon2_salt_hex
            .clone()
            .unwrap_or(manifest.salt_hex),
        argon2_memory_kib: manifest.argon2_memory_kib.unwrap_or(ARGON2_MEMORY_KIB),
        argon2_iterations: manifest.argon2_iterations.unwrap_or(ARGON2_ITERATIONS),
        argon2_parallelism: manifest.argon2_parallelism.unwrap_or(ARGON2_PARALLELISM),
        wrapped_items_key: manifest.wrapped_key.clone(),
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, serde_json::to_string_pretty(&params)?)?;
    Ok(())
}

pub(crate) fn read_key_params(
    app: &AppHandle,
    state: &AppState,
) -> Result<Option<KeyParams>, AppError> {
    let Some(path) = sync_key_params_path(app, state)? else {
        return Ok(None);
    };
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)?;
    Ok(Some(serde_json::from_str(&raw)?))
}

/// Adopt shared key params: derive the same items key every other device uses
/// from the passphrase + the published (public) salt, update the in-memory key,
/// and rewrite the local manifest so future local unlocks stay consistent.
pub(crate) fn adopt_key_params(
    app: &AppHandle,
    state: &AppState,
    params: &KeyParams,
    passphrase: &str,
) -> Result<(), AppError> {
    let salt = hex::decode(params.salt_hex.trim())?;
    let kek = derive_kek_argon2id(passphrase, &salt)?;
    let items_key = decrypt_bytes_with_key(&kek, &params.wrapped_items_key)
        .map_err(|_| AppError::WrongPassword)?;
    if items_key.len() != 32 {
        return Err(AppError::Crypto(
            "Adopted items key has invalid length".into(),
        ));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&items_key[..32]);

    {
        let mut s = state.crypto.session.write().map_err(AppError::from)?;
        s.app_data_key = Some(key);
        s.current_items_key_id = params.wrapped_items_key.nonce[..8].to_string();
    }

    let key_id = generate_key_id();
    let manifest = EncryptionManifest {
        version: ENCRYPTION_MANIFEST_VERSION,
        scope: APP_ENCRYPTION_SCOPE.to_string(),
        kdf_iterations: params.argon2_iterations,
        salt_hex: params.salt_hex.clone(),
        argon2_salt_hex: Some(params.salt_hex.clone()),
        argon2_memory_kib: Some(params.argon2_memory_kib),
        argon2_iterations: Some(params.argon2_iterations),
        argon2_parallelism: Some(params.argon2_parallelism),
        password_check: encrypt_bytes_with_key(&key, APP_PASSWORD_CHECK.as_bytes())?,
        wrapped_key: params.wrapped_items_key.clone(),
        current_key_id: key_id.clone(),
        previous_keys: Vec::new(),
    };
    write_encryption_manifest(&app_encryption_manifest_path(app, state)?, &manifest)?;
    Ok(())
}

pub(crate) fn load_encryption_manifest(
    path: &Path,
) -> Result<Option<EncryptionManifest>, AppError> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)?;
    let manifest = serde_json::from_str::<EncryptionManifest>(&raw)?;
    Ok(Some(manifest))
}

pub(crate) fn write_encryption_manifest(
    path: &Path,
    manifest: &EncryptionManifest,
) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(manifest)?;
    fs::write(path, raw)?;
    Ok(())
}

pub(crate) fn create_encryption_manifest(
    scope: &str,
    password_check: &str,
    passphrase: &str,
) -> Result<(EncryptionManifest, [u8; 32]), AppError> {
    let salt = random_key();
    let kek = derive_kek_argon2id(passphrase, &salt)?;
    let data_key = random_key();
    let key_id = generate_key_id();
    let manifest = EncryptionManifest {
        version: ENCRYPTION_MANIFEST_VERSION,
        scope: scope.to_string(),
        kdf_iterations: ARGON2_ITERATIONS,
        salt_hex: hex::encode(salt),
        argon2_salt_hex: Some(hex::encode(salt)),
        argon2_memory_kib: Some(ARGON2_MEMORY_KIB),
        argon2_iterations: Some(ARGON2_ITERATIONS),
        argon2_parallelism: Some(ARGON2_PARALLELISM),
        password_check: encrypt_bytes_with_key(&data_key, password_check.as_bytes())?,
        wrapped_key: encrypt_bytes_with_key(&kek, &data_key)?,
        current_key_id: key_id,
        previous_keys: Vec::new(),
    };
    Ok((manifest, data_key))
}

pub(crate) fn unlock_key_from_manifest(
    manifest: &EncryptionManifest,
    passphrase: &str,
    expected_scope: &str,
    password_check: &str,
) -> Result<[u8; 32], AppError> {
    if manifest.scope != expected_scope {
        return Err(AppError::Crypto(format!(
            "Unexpected encryption scope: {}",
            manifest.scope
        )));
    }
    let kek = derive_kek_from_manifest(manifest, passphrase)?;
    let raw_key =
        decrypt_bytes_with_key(&kek, &manifest.wrapped_key).map_err(|_| AppError::WrongPassword)?;
    if raw_key.len() != 32 {
        return Err(AppError::Crypto("Wrapped key is corrupted.".into()));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&raw_key[..32]);
    if !manifest.password_check.nonce.is_empty() {
        let check = decrypt_bytes_with_key(&key, &manifest.password_check)
            .or_else(|_| decrypt_bytes_with_key(&kek, &manifest.password_check))?;
        if check != password_check.as_bytes() {
            return Err(AppError::WrongPassword);
        }
    }
    if key.len() != 32 {
        return Err(AppError::Crypto("Wrapped key is corrupted.".into()));
    }
    let mut out = [0_u8; 32];
    out.copy_from_slice(&key[..32]);
    Ok(out)
}

pub(crate) fn current_app_key(state: &AppState) -> Result<Option<[u8; 32]>, AppError> {
    Ok(state.crypto.session.read().map_err(AppError::from)?.app_data_key)
}

/// Generate a random hex key ID (16 hex chars = 8 bytes).
pub(crate) fn generate_key_id() -> String {
    let mut buf = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut buf);
    hex::encode(buf)
}

/// Look up an encryption key by its ID. Returns `None` when the key is locked.
pub(crate) fn key_for_id(state: &AppState, kid: &str) -> Result<Option<[u8; 32]>, AppError> {
    let s = state.crypto.session.read().map_err(AppError::from)?;
    if kid.is_empty() || kid == s.current_items_key_id {
        // Fast path: current key, or legacy note without a kid.
        return Ok(s.app_data_key);
    }
    Ok(s.items_keys.get(kid).copied())
}

/// Unwrap all `previous_keys` from the manifest and load them into the
/// in-memory `items_keys` ring. Also caches the KEK in `master_key_cache`
/// for future rotation without re-prompting.
pub(crate) fn populate_key_ring(
    state: &AppState,
    manifest: &EncryptionManifest,
    kek: &[u8; 32],
) -> Result<(), AppError> {
    let mut s = state.crypto.session.write().map_err(AppError::from)?;
    for prev in &manifest.previous_keys {
        let envelope = WrappedKeyEnvelope {
            nonce: prev.nonce.clone(),
            cipher: prev.cipher.clone(),
        };
        let key_bytes = decrypt_bytes_with_key(kek, &envelope)?;
        let mut key = [0u8; 32];
        key.copy_from_slice(&key_bytes[..32]);
        s.items_keys.insert(prev.id.clone(), key);
    }
    if !manifest.current_key_id.is_empty() {
        s.current_items_key_id = manifest.current_key_id.clone();
    }
    s.master_key_cache = Some(*kek);
    Ok(())
}

/// Rotate the current items key: wrap the old key and store it in the manifest's
/// `previous_keys` list, generate a fresh random items key, wrap it with the KEK
/// (which must be cached in `master_key_cache`), and persist the updated manifest.
/// Old notes encrypted with the previous key remain decryptable via `items_keys`
/// and `key_for_id`.
pub(crate) fn rotate_items_key(app: &AppHandle, state: &AppState) -> Result<(), AppError> {
    // 1. KEK + current key must be present (app must be unlocked). Copy them out
    //    so we can release the lock before doing disk I/O / crypto.
    let (kek, current_key_id, current_key) = {
        let s = state.crypto.session.read().map_err(AppError::from)?;
        let kek = s
            .master_key_cache
            .ok_or_else(|| {
                AppError::Other("Master key not cached. Cannot rotate without passphrase.".into())
            })?;
        if s.current_items_key_id.is_empty() {
            return Err(AppError::Other(
                "No current key ID set — cannot rotate.".into(),
            ));
        }
        let current_key = s
            .app_data_key
            .ok_or_else(|| AppError::Other("App encryption is locked".into()))?;
        (kek, s.current_items_key_id.clone(), current_key)
    };

    // 2. Load the on-disk manifest.
    let manifest_path = app_encryption_manifest_path(app, state)?;
    let mut manifest = load_encryption_manifest(&manifest_path)?
        .ok_or_else(|| AppError::Crypto("Encryption manifest is missing".into()))?;

    // 3. Wrap the outgoing key with the KEK and push it into the manifest's
    //    previous-keys list (persistent storage).
    let wrapped_old = encrypt_bytes_with_key(&kek, &current_key)?;
    manifest.previous_keys.push(PreviousWrappedKey {
        id: current_key_id.clone(),
        nonce: wrapped_old.nonce,
        cipher: wrapped_old.cipher,
    });

    // 4. Keep the old key in the in-memory ring so it can be looked up during
    //    this session without needing to unwrap it from the manifest.
    state
        .crypto.session
        .write()
        .map_err(AppError::from)?
        .items_keys
        .insert(current_key_id, current_key);

    // 5. Generate a new key and key ID.
    let new_key = random_key();
    let new_key_id = generate_key_id();

    // 6. Wrap the new key with the KEK.
    let wrapped_new = encrypt_bytes_with_key(&kek, &new_key)?;

    // 7. Update manifest.
    manifest.wrapped_key = wrapped_new;
    manifest.current_key_id = new_key_id.clone();

    // 8. Update in-memory state.
    {
        let mut s = state.crypto.session.write().map_err(AppError::from)?;
        s.app_data_key = Some(new_key);
        s.current_items_key_id = new_key_id;
    }

    // 9. Persist the updated manifest.
    write_encryption_manifest(&manifest_path, &manifest)?;

    Ok(())
}

pub(crate) fn note_content_is_native_encrypted(value: &serde_json::Value) -> bool {
    matches!(
        value,
        serde_json::Value::Object(map)
            if (map.get("ae").and_then(serde_json::Value::as_u64) == Some(2)
                || map.get("ae").and_then(serde_json::Value::as_u64) == Some(3))
                && map.get("iv").and_then(serde_json::Value::as_str).is_some()
                && map.get("cipher").and_then(serde_json::Value::as_str).is_some()
    )
}

pub(crate) fn note_row_needs_encryption(key: &str, value: &serde_json::Value) -> bool {
    key.starts_with("notes.") && value.is_object()
}

pub(crate) fn encrypt_note_content_for_storage(
    state: &AppState,
    content: &serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    if note_content_is_native_encrypted(content) {
        return Ok(content.clone());
    }
    let key = current_app_key(state)?.ok_or_else(|| {
        AppError::Other(
            "App encryption key is locked. Unlock app encryption before writing notes.".into(),
        )
    })?;
    let key_id = state
        .crypto.session
        .read()
        .map_err(AppError::from)?
        .current_items_key_id
        .clone();
    let envelope = aead_encrypt_json(&key, content, NOTE_AAD)?;
    let mut result = serde_json::json!({
        "ae": 3,
        "iv": envelope.iv,
        "cipher": envelope.enc,
    });
    if !key_id.is_empty() {
        result["kid"] = serde_json::Value::String(key_id);
    }
    Ok(result)
}

pub(crate) fn decrypt_native_note_content(
    state: &AppState,
    content: &serde_json::Value,
) -> Result<Option<serde_json::Value>, AppError> {
    if !note_content_is_native_encrypted(content) {
        return Ok(Some(content.clone()));
    }
    // Determine which items key to use: `kid` in the envelope lets us pick
    // the correct key from the ring after rotation; absent `kid` (legacy)
    // falls back to the current key.
    let kid = content
        .get("kid")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let key = match key_for_id(state, kid)? {
        Some(key) => key,
        None => return Ok(None),
    };
    let ae = content.get("ae").and_then(serde_json::Value::as_u64);
    if ae == Some(3) {
        let envelope = SyncEnvelope {
            v: PROTOCOL_VERSION,
            iv: content
                .get("iv")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| AppError::Crypto("Encrypted note iv missing.".into()))?
                .to_string(),
            enc: content
                .get("cipher")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| AppError::Crypto("Encrypted note cipher missing.".into()))?
                .to_string(),
        };
        let value = aead_decrypt_json(&key, &envelope, NOTE_AAD)?;
        return Ok(Some(value));
    }
    // Legacy ae:2 (AES-GCM) note content.
    let envelope = WrappedKeyEnvelope {
        nonce: content
            .get("iv")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| AppError::Crypto("Encrypted note nonce missing.".into()))?
            .to_string(),
        cipher: content
            .get("cipher")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| AppError::Crypto("Encrypted note cipher missing.".into()))?
            .to_string(),
    };
    let plain = decrypt_bytes_with_key(&key, &envelope)?;
    let value = serde_json::from_slice(&plain)?;
    Ok(Some(value))
}

pub(crate) fn encrypt_note_row_for_storage(
    state: &AppState,
    key: &str,
    value: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    use serde_json::Value;
    if !note_row_needs_encryption(key, &value) {
        return Ok(value);
    }
    if !state.crypto.session.read().map_err(AppError::from)?.active {
        return Ok(value);
    }
    let mut note = match value {
        Value::Object(note) => note,
        other => return Ok(other),
    };
    if current_app_key(state)?.is_none() {
        return Ok(Value::Object(note));
    }
    if let Some(content) = note.get("content").cloned() {
        note.insert(
            "content".to_string(),
            encrypt_note_content_for_storage(state, &content)?,
        );
    }
    Ok(Value::Object(note))
}

pub(crate) fn decrypt_note_row_from_storage(
    state: &AppState,
    key: &str,
    value: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    use serde_json::Value;
    if !note_row_needs_encryption(key, &value) {
        return Ok(value);
    }
    let mut note = match value {
        Value::Object(note) => note,
        other => return Ok(other),
    };
    if let Some(content) = note.get("content").cloned() {
        if let Some(decrypted) = decrypt_native_note_content(state, &content)? {
            note.insert("content".to_string(), decrypted);
        }
    }
    Ok(Value::Object(note))
}

pub(crate) fn read_master_key() -> Result<Vec<u8>, AppError> {
    if super::KEYRING_AVAILABLE.load(Ordering::Relaxed) {
        if let Ok(entry) = Entry::new(SAFE_STORAGE_SERVICE, SAFE_STORAGE_MASTER_ACCOUNT) {
            if let Ok(stored) = entry.get_password() {
                return BASE64.decode(stored.as_bytes()).map_err(AppError::from);
            }

            let mut key = vec![0_u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            if entry.set_password(&BASE64.encode(&key)).is_ok() {
                return Ok(key);
            }
        }
        super::KEYRING_AVAILABLE.store(false, Ordering::Relaxed);
    }

    file_based_master_key()
}

pub(crate) fn file_based_master_key() -> Result<Vec<u8>, AppError> {
    let app_dir = dirs::data_local_dir()
        .ok_or_else(|| AppError::Other("Cannot determine data directory".into()))?
        .join("com.beaver-notes.beaver-notes");
    let key_path = app_dir.join(MASTER_KEY_FILE);

    if key_path.exists() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = fs::metadata(&key_path)?.permissions();
            if perms.mode() & 0o077 != 0 {
                fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600))?;
            }
        }
        let raw = fs::read_to_string(&key_path)?;
        let key_bytes = BASE64.decode(raw.trim().as_bytes())?;
        if key_bytes.len() != 32 {
            return Err(AppError::Crypto(
                "Invalid file-based master key length".into(),
            ));
        }
        return Ok(key_bytes);
    }

    let mut key = vec![0_u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    let encoded = BASE64.encode(&key);
    if let Some(parent) = key_path.parent() {
        fs::create_dir_all(parent)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
        }
    }
    fs::write(&key_path, encoded)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(key)
}

pub(crate) fn safe_storage_encrypt_bytes(bytes: &[u8]) -> Result<String, AppError> {
    let key = read_master_key()?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let mut iv = [0_u8; 12];
    rand::thread_rng().fill_bytes(&mut iv);
    let encrypted = cipher.encrypt(Nonce::from_slice(&iv), bytes)?;
    let mut payload = iv.to_vec();
    payload.extend_from_slice(&encrypted);
    Ok(BASE64.encode(payload))
}

pub(crate) fn safe_storage_decrypt_bytes(value: &str) -> Result<Vec<u8>, AppError> {
    let key = read_master_key()?;
    let payload = BASE64.decode(value.as_bytes())?;
    if payload.len() < 13 {
        return Err(AppError::Crypto("Invalid encrypted payload".into()));
    }
    let (iv, ciphertext) = payload.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    cipher
        .decrypt(Nonce::from_slice(iv), ciphertext)
        .map_err(AppError::from)
}

pub(crate) fn allowed_blob_key(key: &str) -> Result<(), AppError> {
    if super::super::ALLOWED_BLOB_KEYS.contains(&key) {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "[safeStorage] Unsupported blob key: {key}"
        )))
    }
}
