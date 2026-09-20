use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
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
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use tauri::AppHandle;

use super::super::{
    app_encryption_manifest_path, get_settings_value, AppError, AppState,
};

pub(crate) const PBKDF2_ITERATIONS: u32 = 100_000;
pub(crate) const ARGON2_MEMORY_KIB: u32 = 131_072; // 128 MiB (Amendment 1)
pub(crate) const ARGON2_ITERATIONS: u32 = 3;
pub(crate) const ARGON2_PARALLELISM: u32 = 4;
/// Pinned legacy Argon2id params for v3 envelopes/manifests (pre-Amendment 1). Bump would strand locked notes.
pub(crate) const LEGACY_ARGON2_MEMORY_KIB: u32 = 32768; // 32 MiB
pub(crate) const LEGACY_ARGON2_ITERATIONS: u32 = 2;
pub(crate) const LEGACY_ARGON2_PARALLELISM: u32 = 2;
pub(crate) const ENCRYPTION_MANIFEST_VERSION: u8 = 4;
pub(crate) const APP_PASSWORD_CHECK: &str = "BeaverNotes-app-manifest-v4";
pub(crate) const APP_ENCRYPTION_SCOPE: &str = "app";
pub(crate) const STREAM_CHUNK_SIZE: usize = 256 * 1024;
pub(crate) const SYNC_ROOT_DIR: &str = "BeaverNotesSync";
pub(crate) const PROTOCOL_VERSION: u8 = 4;
/// Envelope version for binary sync payloads. v5 encrypts raw bytes directly;
/// v4 (JSON number arrays) still decrypted for compat.
pub(crate) const SYNC_PAYLOAD_VERSION: u8 = 5;
/// Envelope version for sync payloads sealed with a note's shared collaboration
/// key (the per-note key, or the workspace key for the `meta` doc) rather than
/// the account-scoped items key. Same JSON shape as v5; the version field tells
/// the reader which key to load, so v5 rows stay items-key readable forever.
pub(crate) const SHARED_PAYLOAD_VERSION: u8 = 6;
pub(crate) const SYNC_KEY_PARAMS_FILE: &str = "keyParams.json";
/// AAD binding for note-content encryption. Bound to note identity to prevent
/// cross-note ciphertext transplantation.
pub(crate) const NOTE_AAD: &str = "beaver-notes:note-content:v1";
fn note_aad(note_key: &str) -> String {
    format!("{}:{}", NOTE_AAD, note_key)
}
/// Envelope version for raw-byte note payloads. v6 encrypts raw UTF-8 bytes
/// directly instead of round-tripping through serde_json. v3 envelopes are
/// still decrypted for backward compatibility.
pub(crate) const NOTE_RAW_VERSION: u8 = 6;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WrappedKeyEnvelope {
    pub(crate) nonce: String,
    pub(crate) cipher: String,
}

/// A previously-active items key, rotated out: wrapped with the master KEK so
/// it can be unwrapped into the in-memory ring at unlock time for old notes.
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
    /// Ring of previously-active items keys (wrapped with the KEK), loaded at
    /// unlock time to decrypt notes written before the last rotation.
    #[serde(default)]
    pub(crate) previous_keys: Vec<PreviousWrappedKey>,
    /// Items key wrapped with a random recovery secret. Absent in manifests
    /// created before recovery codes; populated lazily on code generation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) recovery_kek: Option<WrappedKeyEnvelope>,
}

fn derive_kek(passphrase: &str, salt: &[u8]) -> [u8; 32] {
    let _t = crate::shared::speed_log::scope("keys.derive_kek_pbkdf2");
    let mut key = [0_u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    key
}

pub(crate) fn derive_kek_argon2id(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], AppError> {
    derive_kek_argon2id_with_params(
        passphrase,
        salt,
        ARGON2_MEMORY_KIB,
        ARGON2_ITERATIONS,
        ARGON2_PARALLELISM,
    )
}

/// KEK under the pinned LEGACY_ARGON2_* parameters, exclusively for the
/// legacy-note migration path (`derive_argon2_key`): must reproduce historical
/// v3 derivations byte-for-byte regardless of module-default changes.
pub(crate) fn derive_kek_argon2id_legacy(
    passphrase: &str,
    salt: &[u8],
) -> Result<[u8; 32], AppError> {
    derive_kek_argon2id_with_params(
        passphrase,
        salt,
        LEGACY_ARGON2_MEMORY_KIB,
        LEGACY_ARGON2_ITERATIONS,
        LEGACY_ARGON2_PARALLELISM,
    )
}

pub(crate) fn derive_kek_argon2id_with_params(
    passphrase: &str,
    salt: &[u8],
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
) -> Result<[u8; 32], AppError> {
    let _t = crate::shared::speed_log::scope("keys.derive_kek_argon2id");
    let argon2 = Argon2::new(
        argon2::Algorithm::Argon2id,
        Version::V0x13,
        Params::new(memory_kib, iterations, parallelism, Some(32))?,
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
        // Use the manifest's stored params (they may predate current constants)
        // so existing vaults keep unlocking after a KDF parameter bump.
        derive_kek_argon2id_with_params(
            passphrase,
            &salt,
            manifest.argon2_memory_kib.unwrap_or(ARGON2_MEMORY_KIB),
            manifest.argon2_iterations.unwrap_or(ARGON2_ITERATIONS),
            manifest.argon2_parallelism.unwrap_or(ARGON2_PARALLELISM),
        )
    } else {
        let salt = hex::decode(manifest.salt_hex.trim())?;
        Ok(derive_kek(passphrase, &salt))
    }
}

pub(crate) fn random_key() -> [u8; 32] {
    let mut key = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    key
}

pub(crate) fn random_nonce() -> [u8; 12] {
    let mut nonce = [0_u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    nonce
}

/// Force-initialize the lazily-initialized crypto stack (thread-local CSPRNG
/// seeding, AES-GCM cipher setup) so the first real encrypt/decrypt doesn't pay
/// a one-time cold-start cost. Called at bootstrap and unlock.
pub(crate) fn prewarm_crypto() {
    let _t = crate::shared::speed_log::scope("keys.prewarm_crypto");
    let key = random_key();
    let nonce = random_nonce();
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    if let Ok(encrypted) = cipher.encrypt(Nonce::from_slice(&nonce), &b"beaver-notes-prewarm"[..]) {
        let _ = cipher.decrypt(Nonce::from_slice(&nonce), encrypted.as_slice());
    }
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

/// AEAD envelope for all JSON payloads (sync commits, genesis, snapshot):
/// XChaCha20-Poly1305, 24-byte nonce, AAD binding ciphertext to its identity.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncEnvelope {
    pub(crate) v: u8,
    pub(crate) iv: String,
    pub(crate) enc: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredJsonEnvelope {
    pub(crate) ae: u8,
    pub(crate) v: u8,
    pub(crate) iv: String,
    pub(crate) enc: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) kid: String,
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

/// Encrypt raw bytes with XChaCha20-Poly1305. Returns (iv_hex, enc_base64), same layout without JSON round-trip.
pub(crate) fn aead_encrypt_bytes(
    key: &[u8; 32],
    plaintext: &[u8],
    aad: &str,
) -> Result<(String, String), AppError> {
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|_| AppError::Crypto("Invalid sync key length".into()))?;
    let nonce_arr = xnonce();
    let nonce = GenericArray::from(nonce_arr);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| AppError::Crypto("AEAD encryption failed".into()))?;
    Ok((hex::encode(nonce_arr), BASE64.encode(ciphertext)))
}

/// Decrypt a raw byte payload. Returns the plaintext bytes. Version is checked
/// by the caller (v4 envelopes decrypt via `aead_decrypt_json`).
pub(crate) fn aead_decrypt_bytes(
    key: &[u8; 32],
    iv_hex: &str,
    enc_b64: &str,
    aad: &str,
) -> Result<Vec<u8>, AppError> {
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|_| AppError::Crypto("Invalid sync key length".into()))?;
    let nonce_arr: [u8; 24] = hex::decode(iv_hex.trim())?
        .try_into()
        .map_err(|_| AppError::Crypto("Invalid nonce length".into()))?;
    let nonce = GenericArray::from(nonce_arr);
    let ciphertext = BASE64.decode(enc_b64.trim())?;
    cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &ciphertext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| AppError::WrongPassword)
}

pub(crate) fn encrypt_json_for_storage(
    key: &[u8; 32],
    value: &Value,
    aad: &str,
    key_id: Option<&str>,
) -> Result<StoredJsonEnvelope, AppError> {
    let _t = crate::shared::speed_log::scope("keys.encrypt_json_for_storage");
    let envelope = aead_encrypt_json(key, value, aad)?;
    Ok(StoredJsonEnvelope {
        ae: 4,
        v: envelope.v,
        iv: envelope.iv,
        enc: envelope.enc,
        kid: key_id.unwrap_or_default().to_string(),
    })
}

pub(crate) fn decrypt_json_from_storage(
    key: &[u8; 32],
    value: &Value,
    aad: &str,
) -> Result<Option<Value>, AppError> {
    let _t = crate::shared::speed_log::scope("keys.decrypt_json_from_storage");
    let Some(obj) = value.as_object() else {
        return Ok(None);
    };

    if obj.get("ae").and_then(Value::as_u64) != Some(4) {
        return Ok(None);
    }

    let envelope = SyncEnvelope {
        v: obj
            .get("v")
            .and_then(Value::as_u64)
            .ok_or_else(|| AppError::Crypto("Encrypted store value missing version".into()))?
            as u8,
        iv: obj
            .get("iv")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::Crypto("Encrypted store value missing iv".into()))?
            .to_string(),
        enc: obj
            .get("enc")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::Crypto("Encrypted store value missing payload".into()))?
            .to_string(),
    };

    let decrypted = aead_decrypt_json(key, &envelope, aad)?;
    Ok(Some(decrypted))
}

// Items key is random, wrapped by master key. Publish KDF salt plus wrapped key in sync folder.
// Only correct passphrase unwraps it, so second device derives same master key.

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
    // No folder chosen (cloud-only / fresh onboarding): keep keyParams.json inside
    // this instance's app-data dir. Falling back to the shared real-app directory
    // would let a second instance read/write the first app's vault.
    let base = match sync_path.as_deref() {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => crate::shared::app_storage_dir(app, state)?,
    };
    Ok(Some(base.join(SYNC_ROOT_DIR).join(SYNC_KEY_PARAMS_FILE)))
}

pub(crate) fn key_params_from_manifest(
    manifest: &EncryptionManifest,
) -> Result<KeyParams, AppError> {
    if manifest.version < 3 {
        return Err(AppError::Crypto(
            "Encryption manifest is too old to share keys".into(),
        ));
    }
    Ok(KeyParams {
        version: PROTOCOL_VERSION,
        kdf: "argon2id".to_string(),
        salt_hex: manifest
            .argon2_salt_hex
            .clone()
            .unwrap_or(manifest.salt_hex.clone()),
        argon2_memory_kib: manifest.argon2_memory_kib.unwrap_or(ARGON2_MEMORY_KIB),
        argon2_iterations: manifest.argon2_iterations.unwrap_or(ARGON2_ITERATIONS),
        argon2_parallelism: manifest
            .argon2_parallelism
            .unwrap_or(ARGON2_PARALLELISM),
        wrapped_items_key: manifest.wrapped_key.clone(),
    })
}

/// Whether `publish_key_params` may replace `existing` with the local
/// manifest's params. Writing unconditionally let two devices mint divergent
/// vaults: the second writer clobbered the first's `keyParams.json`, and every
/// peer commit then failed `decrypt_commit` and was skipped forever (finding
/// F2). Overwriting is allowed only when there is no file yet or the file wraps
/// the same items key (same vault).
fn key_params_overwrite_allowed(
    existing: Option<&KeyParams>,
    manifest: &EncryptionManifest,
) -> bool {
    match existing {
        None => true,
        Some(params) => !remote_params_differ(params, Some(manifest)),
    }
}

pub(crate) fn publish_key_params(app: &AppHandle, state: &AppState) -> Result<(), AppError> {
    let Some(path) = sync_key_params_path(app, state)? else {
        return Ok(());
    };
    let manifest_path = app_encryption_manifest_path(app, state)?;
    let manifest = load_encryption_manifest(&manifest_path)?
        .ok_or_else(|| AppError::Crypto("Encryption manifest is missing".into()))?;
    let params = key_params_from_manifest(&manifest)?;
    // Refuse to clobber a different vault's params (finding F2); surface the
    // conflict instead of silently overwriting.
    if let Some(existing) = read_key_params(app, state)? {
        if !key_params_overwrite_allowed(Some(&existing), &manifest) {
            return Err(AppError::Crypto(
                "sync: keyParams.json already holds a different vault — refusing to overwrite".into(),
            ));
        }
    }
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

/// Derive the items key from shared key params (KEK = Argon2id(passphrase,
/// salt), then unwrap). Pure; returns the KEK so callers populate the key ring
/// without re-running the KDF.
pub(crate) fn derive_items_key_from_params(
    params: &KeyParams,
    passphrase: &str,
) -> Result<([u8; 32], [u8; 32]), AppError> {
    let salt = hex::decode(params.salt_hex.trim())?;
    // Use the vault's published KDF params, never module defaults: a legacy
    // 16 MiB manifest derived with defaults yields a different KEK and a
    // spurious WrongPassword for the correct passphrase.
    if params.argon2_memory_kib < ARGON2_MEMORY_KIB
        || params.argon2_iterations < ARGON2_ITERATIONS
        || params.argon2_parallelism < ARGON2_PARALLELISM
    {
        return Err(AppError::Crypto(
            "KeyParams KDF params below minimum — possible downgrade".into(),
        ));
    }
    if params.version < ENCRYPTION_MANIFEST_VERSION || params.kdf != "argon2id" {
        return Err(AppError::Crypto("Unsupported KeyParams version/kdf".into()));
    }
    let kek = derive_kek_argon2id_with_params(
        passphrase,
        &salt,
        params.argon2_memory_kib,
        params.argon2_iterations,
        params.argon2_parallelism,
    )?;
    let items_key = decrypt_bytes_with_key(&kek, &params.wrapped_items_key)
        .map_err(|_| AppError::WrongPassword)?;
    if items_key.len() != 32 {
        return Err(AppError::Crypto(
            "Adopted items key has invalid length".into(),
        ));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&items_key[..32]);
    Ok((key, kek))
}

/// True when the shared key params belong to a different vault than the local
/// manifest (or no local manifest exists).
pub(crate) fn remote_params_differ(
    params: &KeyParams,
    local_manifest: Option<&EncryptionManifest>,
) -> bool {
    match local_manifest {
        Some(m) => {
            m.wrapped_key.nonce != params.wrapped_items_key.nonce
                || m.wrapped_key.cipher != params.wrapped_items_key.cipher
        }
        None => true,
    }
}

/// Adopt shared key params: derive the items key every other device uses,
/// update the in-memory key, and rewrite the local manifest so future unlocks
/// stay consistent.
pub(crate) fn adopt_key_params(
    app: &AppHandle,
    state: &AppState,
    params: &KeyParams,
    passphrase: &str,
) -> Result<(), AppError> {
    let (key, kek) = derive_items_key_from_params(params, passphrase)?;

    // Joining replaces the local items key. Re-encrypt everything this device
    // stored under the old key first, otherwise its local notes become
    // undecryptable (no key-id fallback exists for note/content/asset payloads).
    // Read the old key before taking the migration barrier: `current_app_key`
    // takes the session read lock, and the lock order is barrier → session.
    let old_key = current_app_key(state)?;
    if old_key.is_none() && app_encryption_manifest_path(app, state)?.exists() {
        return Err(AppError::EncryptionLocked);
    }

    fn set_adopted_key(session: &mut crate::shared::CryptoSession, key: [u8; 32], key_id: &str) {
        session.app_data_key = Some(key);
        session.current_items_key_id = key_id.to_string();
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
        recovery_kek: None,
    };

    // The migration write barrier covers re-encryption, the in-memory swap and
    // manifest persistence. Sealing writers take the barrier read guard across
    // key fetch + ciphertext write, so none can observe the old key after the
    // swap; the post-manifest sweep catches any writer that bypassed the
    // barrier.
    let mut backups: Vec<std::path::PathBuf> = Vec::new();
    match old_key {
        Some(old) if old != key => {
            let (_, created) = super::migrate_app_data_key(
                app,
                state,
                &old,
                &key,
                &manifest,
                |session| set_adopted_key(session, key, &key_id),
            )?;
            backups = created;
        }
        _ => {
            let mut session = state.crypto.session.write().map_err(AppError::from)?;
            set_adopted_key(&mut session, key, &key_id);
            drop(session);
            write_encryption_manifest(&app_encryption_manifest_path(app, state)?, &manifest)?;
        }
    }
    populate_key_ring(state, &manifest, &kek)?;
    // The key swap is persisted, so the pre-migration backups have done their
    // job — don't leave hundreds of MB of `*.pre-join-backup` files on disk.
    for path in backups {
        let _ = std::fs::remove_file(path);
    }
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

/// Create a fresh encryption manifest for a scope, returning the KEK alongside
/// so the caller can populate the key ring without re-running the KDF.
pub(crate) fn create_encryption_manifest(
    scope: &str,
    password_check: &str,
    passphrase: &str,
) -> Result<(EncryptionManifest, [u8; 32], [u8; 32]), AppError> {
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
        recovery_kek: None,
    };
    Ok((manifest, data_key, kek))
}

/// Generate a random 256-bit recovery code wrapping the active items key;
/// return hex for one-time display to the user.
pub(crate) fn generate_recovery_code(
    manifest: &mut EncryptionManifest,
    data_key: &[u8; 32],
) -> Result<String, AppError> {
    let recovery = random_key();
    let wrapped = encrypt_bytes_with_key(&recovery, data_key)?;
    manifest.recovery_kek = Some(wrapped);
    Ok(hex::encode(recovery))
}

/// Recover the items key from a previously-generated recovery code (64 hex
/// chars) matching `generate_recovery_code` for the same manifest.
pub(crate) fn recover_key_from_code(
    manifest: &EncryptionManifest,
    code_hex: &str,
) -> Result<[u8; 32], AppError> {
    let wrapped = manifest.recovery_kek.as_ref().ok_or_else(|| {
        AppError::Other("No recovery code has been generated for this manifest.".into())
    })?;
    let mut recovery = [0u8; 32];
    let decoded = hex::decode(code_hex.trim())?;
    if decoded.len() != 32 {
        return Err(AppError::Other(
            "Recovery code must be 64 hex characters.".into(),
        ));
    }
    recovery.copy_from_slice(&decoded);
    let raw = decrypt_bytes_with_key(&recovery, wrapped)?;
    if raw.len() != 32 {
        return Err(AppError::Other("Recovered key is corrupted.".into()));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&raw);
    Ok(key)
}

/// Unwrap items key from manifest, return with derived KEK. Callers reuse KEK (Argon2id ~200ms).
pub(crate) fn unlock_key_from_manifest(
    manifest: &EncryptionManifest,
    passphrase: &str,
    expected_scope: &str,
    password_check: &str,
) -> Result<([u8; 32], [u8; 32]), AppError> {
    let _t = crate::shared::speed_log::scope("keys.unlock_key_from_manifest");
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
    let mut out = [0_u8; 32];
    out.copy_from_slice(&key[..32]);
    Ok((out, kek))
}

pub(crate) fn current_app_key(state: &AppState) -> Result<Option<[u8; 32]>, AppError> {
    Ok(state
        .crypto
        .session
        .read()
        .map_err(AppError::from)?
        .app_data_key)
}

/// Snapshot the whole shared-key ring for a sync cycle. Cloning 32-byte keys is
/// cheap and avoids holding the session read lock across network I/O. Each value
/// is newest-first: index 0 seals, all entries decrypt.
pub(crate) fn shared_note_keys(
    state: &AppState,
) -> Result<HashMap<String, Vec<[u8; 32]>>, AppError> {
    Ok(state
        .crypto
        .session
        .read()
        .map_err(AppError::from)?
        .shared_note_keys
        .clone())
}

/// The key a shared note seals under: the newest in its ring. `None` for an
/// unregistered note (personal notes fall back to the items key).
pub(crate) fn current_shared_key(
    shared: &HashMap<String, Vec<[u8; 32]>>,
    note_id: &str,
) -> Option<[u8; 32]> {
    shared.get(note_id).and_then(|keys| keys.first().copied())
}

/// Merge a newly-registered note key with any previous keys. The result is
/// newest-first and deduplicated: `new_key` is current, then `previous_keys`,
/// then whatever `existing` current was (archived automatically when a rotation
/// registers a genuinely new key). Capped so repeated rotations cannot grow the
/// in-memory ring without bound.
pub(crate) fn merge_shared_note_keys(
    existing: Option<&[[u8; 32]]>,
    new_key: [u8; 32],
    previous_keys: &[[u8; 32]],
) -> Vec<[u8; 32]> {
    const MAX_KEYS: usize = 16;
    let mut keys: Vec<[u8; 32]> = Vec::with_capacity(3);
    keys.push(new_key);
    for &key in previous_keys.iter().chain(existing.unwrap_or(&[]).iter()) {
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    keys.truncate(MAX_KEYS);
    keys
}

/// Notes the client knows are shared but whose collaboration key is not
/// registered yet. The cloud push defers sealing these rather than fall back to
/// the account items key (see `CryptoSession::expected_shared_notes`).
pub(crate) fn expected_shared_notes(state: &AppState) -> Result<HashSet<String>, AppError> {
    Ok(state
        .crypto
        .session
        .read()
        .map_err(AppError::from)?
        .expected_shared_notes
        .clone())
}

/// KV at-rest key. None only pre-onboarding (plaintext correct). Locked returns EncryptionLocked: fail closed.
/// Blocks writing plaintext among encrypted rows or reading ciphertext as garbage.
pub(crate) fn kv_encryption_key(state: &AppState) -> Result<Option<[u8; 32]>, AppError> {
    let s = state.crypto.session.read().map_err(AppError::from)?;
    match (s.active, s.app_data_key) {
        (false, _) => Ok(None),
        (true, Some(key)) => Ok(Some(key)),
        (true, None) => Err(AppError::EncryptionLocked),
    }
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

/// Unwrap all `previous_keys` into the in-memory `items_keys` ring and cache
/// the KEK in `master_key_cache` for rotation without re-prompting.
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

/// Rotate the items key: archive the old key (manifest `previous_keys` +
/// in-memory ring, so old notes stay decryptable via `key_for_id`), re-encrypt
/// existing payloads to a fresh random key, and wrap it with the cached KEK.
/// Requires the app to be unlocked.
pub(crate) fn rotate_items_key(app: &AppHandle, state: &AppState) -> Result<(), AppError> {
    let _t = crate::shared::speed_log::scope("keys.rotate_items_key");
    // Copy key material out so the lock releases before disk I/O / crypto.
    let (kek, current_key_id, current_key) = {
        let s = state.crypto.session.read().map_err(AppError::from)?;
        let kek = s.master_key_cache.ok_or_else(|| {
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

    let manifest_path = app_encryption_manifest_path(app, state)?;
    let mut manifest = load_encryption_manifest(&manifest_path)?
        .ok_or_else(|| AppError::Crypto("Encryption manifest is missing".into()))?;

    let wrapped_old = encrypt_bytes_with_key(&kek, &current_key)?;
    manifest.previous_keys.push(PreviousWrappedKey {
        id: current_key_id.clone(),
        nonce: wrapped_old.nonce,
        cipher: wrapped_old.cipher,
    });

    let new_key = random_key();
    let new_key_id = generate_key_id();
    let wrapped_new = encrypt_bytes_with_key(&kek, &new_key)?;
    manifest.wrapped_key = wrapped_new;
    manifest.current_key_id = new_key_id.clone();

    // Same migration barrier as the join path: it is held across
    // re-encryption, the in-memory swap and manifest persistence, so no
    // barrier-aware writer can observe the old key mid-rotation or interleave
    // old-key data after the swap. The post-manifest sweep catches a writer
    // that bypassed the barrier.
    let backups: Vec<std::path::PathBuf> = {
        let (_, created) = super::migrate_app_data_key(
            app,
            state,
            &current_key,
            &new_key,
            &manifest,
            |session| {
                // Keep the old key in the in-memory ring for lookups this session.
                session.items_keys.insert(current_key_id.clone(), current_key);
                session.app_data_key = Some(new_key);
                session.current_items_key_id = new_key_id.clone();
            },
        )?;
        created
    };

    // The swap is persisted, so the pre-migration backups have done their job.
    for path in backups {
        let _ = std::fs::remove_file(path);
    }

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
    let _t = crate::shared::speed_log::scope("keys.encrypt_note_content");
    if note_content_is_native_encrypted(content) {
        return Ok(content.clone());
    }
    let key = current_app_key(state)?.ok_or_else(|| {
        AppError::Other(
            "App encryption key is locked. Unlock app encryption before writing notes.".into(),
        )
    })?;
    let key_id = state
        .crypto
        .session
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
    let _t = crate::shared::speed_log::scope("keys.decrypt_note_content");
    if !note_content_is_native_encrypted(content) {
        return Ok(Some(content.clone()));
    }
    // Pick the items key via `kid` (correct ring entry after rotation);
    // absent `kid` (legacy) falls back to the current key.
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
    let _t = crate::shared::speed_log::scope("keys.encrypt_note_row");
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
    let _t = crate::shared::speed_log::scope("keys.decrypt_note_row");
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

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_params(passphrase: &str) -> (KeyParams, [u8; 32]) {
        let (manifest, data_key, _) =
            create_encryption_manifest(APP_ENCRYPTION_SCOPE, APP_PASSWORD_CHECK, passphrase)
                .expect("create manifest");
        let params = KeyParams {
            version: PROTOCOL_VERSION,
            kdf: "argon2id".to_string(),
            salt_hex: manifest
                .argon2_salt_hex
                .clone()
                .unwrap_or(manifest.salt_hex.clone()),
            argon2_memory_kib: manifest.argon2_memory_kib.unwrap_or(ARGON2_MEMORY_KIB),
            argon2_iterations: manifest.argon2_iterations.unwrap_or(ARGON2_ITERATIONS),
            argon2_parallelism: manifest.argon2_parallelism.unwrap_or(ARGON2_PARALLELISM),
            wrapped_items_key: manifest.wrapped_key.clone(),
        };
        (params, data_key)
    }

    /// L8: registering a rotated key keeps the previous generation available
    /// (newest first), archives the old current, and deduplicates.
    #[test]
    fn merge_shared_note_keys_keeps_previous_generations_newest_first() {
        let old = [1u8; 32];
        let new = [2u8; 32];
        let older = [3u8; 32];

        // Rotation with an explicit previous key: new, then explicit prev, then
        // the archived existing current.
        let merged = merge_shared_note_keys(Some(&[old]), new, &[older]);
        assert_eq!(merged, vec![new, older, old]);

        // Re-registering the same key does not duplicate or reorder.
        let same = merge_shared_note_keys(Some(&merged), new, &[]);
        assert_eq!(same, vec![new, older, old]);

        // No history: just the new key.
        assert_eq!(merge_shared_note_keys(None, new, &[old]), vec![new, old]);
    }

    #[test]
    fn derive_items_key_with_correct_passphrase_matches_manifest_key() {
        let (params, data_key) = sample_params("correct horse battery staple");
        let (key, _kek) =
            derive_items_key_from_params(&params, "correct horse battery staple").expect("derive");
        assert_eq!(key, data_key);
    }

    #[test]
    fn derive_items_key_with_wrong_passphrase_errors() {
        let (params, _) = sample_params("correct horse battery staple");
        assert!(matches!(
            derive_items_key_from_params(&params, "wrong passphrase"),
            Err(AppError::WrongPassword)
        ));
    }

    #[test]
    fn remote_params_differ_without_local_manifest_is_true() {
        let (params, _) = sample_params("pw");
        assert!(remote_params_differ(&params, None));
    }

    #[test]
    fn remote_params_differ_false_when_matching_manifest() {
        let (manifest, _, _) =
            create_encryption_manifest(APP_ENCRYPTION_SCOPE, APP_PASSWORD_CHECK, "pw")
                .expect("create manifest");
        let params = KeyParams {
            version: PROTOCOL_VERSION,
            kdf: "argon2id".to_string(),
            salt_hex: manifest
                .argon2_salt_hex
                .clone()
                .unwrap_or(manifest.salt_hex.clone()),
            argon2_memory_kib: manifest.argon2_memory_kib.unwrap_or(ARGON2_MEMORY_KIB),
            argon2_iterations: manifest.argon2_iterations.unwrap_or(ARGON2_ITERATIONS),
            argon2_parallelism: manifest.argon2_parallelism.unwrap_or(ARGON2_PARALLELISM),
            wrapped_items_key: manifest.wrapped_key.clone(),
        };
        assert!(!remote_params_differ(&params, Some(&manifest)));
    }

    /// F2: a device must not overwrite an existing `keyParams.json` that
    /// belongs to a different vault. Same-vault params (or no file) still write.
    #[test]
    fn key_params_overwrite_refuses_a_foreign_vault() {
        let (manifest_a, _, _) =
            create_encryption_manifest(APP_ENCRYPTION_SCOPE, APP_PASSWORD_CHECK, "pw-a")
                .expect("manifest a");
        let (manifest_b, _, _) =
            create_encryption_manifest(APP_ENCRYPTION_SCOPE, APP_PASSWORD_CHECK, "pw-b")
                .expect("manifest b");
        let params_a = key_params_from_manifest(&manifest_a).expect("params a");
        let params_b = key_params_from_manifest(&manifest_b).expect("params b");

        // No existing file: always allowed.
        assert!(key_params_overwrite_allowed(None, &manifest_a));
        // Same vault: allowed (idempotent republish).
        assert!(key_params_overwrite_allowed(Some(&params_a), &manifest_a));
        // Foreign vault: refused so its wrapped items key is not clobbered.
        assert!(!key_params_overwrite_allowed(
            Some(&params_b),
            &manifest_a
        ));
    }
}
