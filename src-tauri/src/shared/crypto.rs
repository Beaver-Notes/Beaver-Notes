use std::{
    fs::{self, File},
    io::{BufReader, BufWriter, Read, Write},
    path::Path,
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

use aes::Aes256;
use cbc::Decryptor;
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use hmac::Hmac;
use keyring::Entry;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::AppHandle;

use super::{AppState, SAFE_STORAGE_SERVICE, AppError};

pub(crate) const SAFE_STORAGE_MASTER_ACCOUNT: &str = "__safe_storage_master_key__";
pub(crate) const ASSET_MAGIC: &[u8; 4] = b"BNA2";
pub(crate) const ASSET_MAGIC_V3: &[u8; 4] = b"BNA3";
pub(crate) const PBKDF2_ITERATIONS: u32 = 100_000;
pub(crate) const ARGON2_MEMORY_KIB: u32 = 16 * 1024;
pub(crate) const ARGON2_ITERATIONS: u32 = 2;
pub(crate) const ARGON2_PARALLELISM: u32 = 2;
pub(crate) const ENCRYPTION_MANIFEST_VERSION: u8 = 3;
pub(crate) const APP_PASSWORD_CHECK: &str = "BeaverNotes-app-manifest-v3";
pub(crate) const APP_ENCRYPTION_SCOPE: &str = "app";
pub(crate) const STREAM_CHUNK_SIZE: usize = 256 * 1024;

pub(crate) static KEYRING_AVAILABLE: AtomicBool =
    AtomicBool::new(!cfg!(target_os = "android"));

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WrappedKeyEnvelope {
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
        Params::new(ARGON2_MEMORY_KIB, ARGON2_ITERATIONS, ARGON2_PARALLELISM, Some(32))?,
    );
    let salt_string = SaltString::encode_b64(salt)?;
    let hash = argon2.hash_password(passphrase.as_bytes(), &salt_string)?;
    let mut key = [0u8; 32];
    let hash_output = hash.hash.unwrap();
    let hash_bytes = hash_output.as_bytes();
    key.copy_from_slice(&hash_bytes[..32]);
    Ok(key)
}

fn derive_kek_from_manifest(
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

fn random_nonce() -> [u8; 12] {
    let mut nonce = [0_u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    nonce
}

fn derive_chunk_nonce(seed: &[u8; 12], chunk_index: u64, key: &[u8; 32]) -> [u8; 12] {
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
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), plain)?;
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

pub(crate) fn load_encryption_manifest(path: &Path) -> Result<Option<EncryptionManifest>, AppError> {
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
    let manifest = EncryptionManifest {
        version: ENCRYPTION_MANIFEST_VERSION,
        scope: scope.to_string(),
        kdf_iterations: ARGON2_ITERATIONS,
        salt_hex: hex::encode(salt),
        argon2_salt_hex: Some(hex::encode(salt)),
        argon2_memory_kib: Some(ARGON2_MEMORY_KIB),
        argon2_iterations: Some(ARGON2_ITERATIONS),
        argon2_parallelism: Some(ARGON2_PARALLELISM),
        password_check: encrypt_bytes_with_key(&kek, password_check.as_bytes())?,
        wrapped_key: encrypt_bytes_with_key(&kek, &data_key)?,
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
    let check = decrypt_bytes_with_key(&kek, &manifest.password_check)?;
    if check != password_check.as_bytes() {
        return Err(AppError::WrongPassword);
    }
    let key = decrypt_bytes_with_key(&kek, &manifest.wrapped_key)
        .map_err(|_| AppError::Crypto("Encryption key is corrupted — re-enter your password.".into()))?;
    if key.len() != 32 {
        return Err(AppError::Crypto("Wrapped key is corrupted.".into()));
    }
    let mut out = [0_u8; 32];
    out.copy_from_slice(&key[..32]);
    Ok(out)
}

pub(crate) fn current_app_key(state: &AppState) -> Result<Option<[u8; 32]>, AppError> {
    Ok(*state.app_data_key.lock().map_err(AppError::from)?)
}

pub(crate) fn note_content_is_native_encrypted(value: &serde_json::Value) -> bool {
    matches!(
        value,
        serde_json::Value::Object(map)
            if map.get("ae").and_then(serde_json::Value::as_u64) == Some(2)
                && map.get("nonce").and_then(serde_json::Value::as_str).is_some()
                && map.get("cipher").and_then(serde_json::Value::as_str).is_some()
    )
}

pub(crate) fn note_content_is_legacy_encrypted(value: &serde_json::Value) -> bool {
    matches!(
        value,
        serde_json::Value::Object(map)
            if map.get("ae").and_then(serde_json::Value::as_u64) == Some(1)
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
    if note_content_is_native_encrypted(content) || note_content_is_legacy_encrypted(content) {
        return Ok(content.clone());
    }
    let key = current_app_key(state)?.ok_or_else(|| {
        AppError::Other("App encryption key is locked. Unlock app encryption before writing notes.".into())
    })?;
    let plain = serde_json::to_vec(content)?;
    let envelope = encrypt_bytes_with_key(&key, &plain)?;
    Ok(serde_json::json!({
        "ae": 2,
        "nonce": envelope.nonce,
        "cipher": envelope.cipher,
    }))
}

pub(crate) fn decrypt_native_note_content(
    state: &AppState,
    content: &serde_json::Value,
) -> Result<Option<serde_json::Value>, AppError> {
    if !note_content_is_native_encrypted(content) {
        return Ok(Some(content.clone()));
    }
    let key = match current_app_key(state)? {
        Some(key) => key,
        None => return Ok(None),
    };
    let envelope = WrappedKeyEnvelope {
        nonce: content
            .get("nonce")
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
    if !state.app_encryption_active.load(Ordering::Acquire) {
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
    if KEYRING_AVAILABLE.load(Ordering::Relaxed) {
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
        KEYRING_AVAILABLE.store(false, Ordering::Relaxed);
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
            return Err(AppError::Crypto("Invalid file-based master key length".into()));
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
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&iv), bytes)?;
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
    if super::ALLOWED_BLOB_KEYS.contains(&key) {
        Ok(())
    } else {
        Err(AppError::Other(format!("[safeStorage] Unsupported blob key: {key}")))
    }
}

pub(crate) fn encrypt_asset_bytes_with_key(
    plain: &[u8],
    key: &[u8; 32],
) -> Result<Vec<u8>, AppError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let iv = random_nonce();
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&iv), plain)?;
    let (ciphertext, tag) = encrypted.split_at(encrypted.len().saturating_sub(16));
    let mut output = Vec::with_capacity(4 + 12 + 16 + ciphertext.len());
    output.extend_from_slice(ASSET_MAGIC);
    output.extend_from_slice(&iv);
    output.extend_from_slice(tag);
    output.extend_from_slice(ciphertext);
    Ok(output)
}

pub(crate) fn decrypt_asset_bytes_with_key(
    encrypted: &[u8],
    key: &[u8; 32],
) -> Result<Vec<u8>, AppError> {
    if encrypted.len() < 4 + 12 + 16 {
        return Ok(encrypted.to_vec());
    }
    if &encrypted[..4] == ASSET_MAGIC || &encrypted[..4] == b"BNA1" {
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
        let iv = &encrypted[4..16];
        let tag = &encrypted[16..32];
        let ciphertext = &encrypted[32..];
        let mut payload = Vec::with_capacity(ciphertext.len() + tag.len());
        payload.extend_from_slice(ciphertext);
        payload.extend_from_slice(tag);
        return cipher
            .decrypt(Nonce::from_slice(iv), payload.as_slice())
            .map_err(AppError::from);
    }
    Ok(encrypted.to_vec())
}

pub(crate) fn encrypt_asset_streaming(
    input_path: &Path,
    output_path: &Path,
    key: &[u8; 32],
) -> Result<(), AppError> {
    let input = File::open(input_path)?;
    let output = File::create(output_path)?;
    let mut reader = BufReader::with_capacity(STREAM_CHUNK_SIZE, input);
    let mut writer = BufWriter::with_capacity(STREAM_CHUNK_SIZE, output);

    let nonce_seed = random_nonce();
    writer.write_all(ASSET_MAGIC_V3)?;
    writer.write_all(&nonce_seed)?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut chunk_buf = vec![0u8; STREAM_CHUNK_SIZE];
    let mut chunk_index = 0u64;

    loop {
        let bytes_read = reader.read(&mut chunk_buf)?;
        if bytes_read == 0 {
            break;
        }
        let chunk = &chunk_buf[..bytes_read];

        let nonce = derive_chunk_nonce(&nonce_seed, chunk_index, key);

        let encrypted = cipher
            .encrypt(Nonce::from_slice(&nonce), chunk)?;

        let (ciphertext, tag) = encrypted.split_at(encrypted.len().saturating_sub(16));
        writer
            .write_all(&(encrypted.len() as u32).to_le_bytes())?;
        writer.write_all(ciphertext)?;
        writer.write_all(tag)?;

        chunk_index += 1;
    }

    writer.flush()?;
    Ok(())
}

pub(crate) fn decrypt_asset_streaming(
    input_path: &Path,
    output_path: &Path,
    key: &[u8; 32],
) -> Result<(), AppError> {
    let input = File::open(input_path)?;
    let mut reader = BufReader::with_capacity(STREAM_CHUNK_SIZE + 32, input);

    let mut magic = [0u8; 4];
    match reader.read_exact(&mut magic) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
            drop(reader);
            fs::copy(input_path, output_path)?;
            return Ok(());
        }
        Err(e) => return Err(AppError::from(e)),
    }

    if &magic != ASSET_MAGIC && &magic != ASSET_MAGIC_V3 {
        drop(reader);
        let data = fs::read(input_path)?;
        let plain = decrypt_asset_bytes_with_key(&data, key)?;
        fs::write(output_path, plain)?;
        return Ok(());
    }

    let is_v3 = &magic == ASSET_MAGIC_V3;

    let mut nonce_seed = [0u8; 12];
    reader.read_exact(&mut nonce_seed)?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));

    let output = File::create(output_path)?;
    let mut writer = BufWriter::with_capacity(STREAM_CHUNK_SIZE, output);

    let mut len_buf = [0u8; 4];
    let mut chunk_index = 0u64;

    loop {
        match reader.read_exact(&mut len_buf) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(AppError::from(e)),
        }
        let chunk_len = u32::from_le_bytes(len_buf) as usize;

        if chunk_len == 0 || chunk_len > STREAM_CHUNK_SIZE + 16 + 64 {
            return Err(AppError::Crypto(format!(
                "Invalid chunk length {} at index {}",
                chunk_len, chunk_index
            )));
        }

        let mut chunk_buf = vec![0u8; chunk_len];
        reader
            .read_exact(&mut chunk_buf)
            .map_err(|e| AppError::Crypto(format!("Failed to read chunk {}: {}", chunk_index, e)))?;

        let nonce = if is_v3 {
            derive_chunk_nonce(&nonce_seed, chunk_index, key)
        } else {
            let mut nonce_bytes = nonce_seed.to_vec();
            let index_bytes = chunk_index.to_le_bytes();
            nonce_bytes.extend_from_slice(&index_bytes);
            let nonce: [u8; 12] = nonce_bytes[..12]
                .try_into()
                .map_err(|_| AppError::Crypto("Invalid nonce length".into()))?;
            nonce
        };

        let decrypted = cipher
            .decrypt(Nonce::from_slice(&nonce), chunk_buf.as_slice())
            .map_err(|_| AppError::Crypto(format!("Decryption failed for chunk {}", chunk_index)))?;

        writer.write_all(&decrypted)?;
        chunk_index += 1;
    }

    writer.flush()?;
    Ok(())
}

pub(crate) fn is_encrypted_asset_buffer(buffer: &[u8]) -> bool {
    (buffer.len() > 4 + 12 + 16 && (&buffer[..4] == ASSET_MAGIC || &buffer[..4] == ASSET_MAGIC_V3))
        || buffer.len() > 4 + 12 + 16 && &buffer[..4] == b"BNA1"
}

pub(crate) fn is_encrypted_asset_v2(buffer: &[u8]) -> bool {
    buffer.len() > 4 + 12 + 16 && (&buffer[..4] == ASSET_MAGIC || &buffer[..4] == ASSET_MAGIC_V3)
}

pub(crate) fn encrypt_asset(
    app: &AppHandle,
    state: &AppState,
    target_path: &Path,
    input: &[u8],
    skip: bool,
) -> Result<Vec<u8>, AppError> {
    if skip || !super::is_local_asset_path(app, target_path) || is_encrypted_asset_buffer(input) {
        return Ok(input.to_vec());
    }
    let manifest_path = super::app_encryption_manifest_path(app, state)?;
    if !manifest_path.exists() {
        return Ok(input.to_vec());
    }
    let key = current_app_key(state)?
        .ok_or(AppError::Other("App encryption is enabled but locked. Unlock before writing assets.".into()))?;
    encrypt_asset_bytes_with_key(input, &key)
}

pub(crate) fn decrypt_asset(
    app: &AppHandle,
    state: &AppState,
    target_path: &Path,
    input: &[u8],
) -> Result<Vec<u8>, AppError> {
    if !super::is_local_asset_path(app, target_path) || !is_encrypted_asset_buffer(input) {
        return Ok(input.to_vec());
    }
    let key = current_app_key(state)?
        .ok_or(AppError::EncryptionLocked)?;
    decrypt_asset_bytes_with_key(input, &key)
}

fn evp_bytes_to_key(password: &[u8], salt: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let mut derived = Vec::new();
    let mut prev = [0u8; 16];
    while derived.len() < 48 {
        let mut ctx = md5::Context::new();
        ctx.consume(&prev);
        ctx.consume(password);
        ctx.consume(salt);
        prev = ctx.compute().0;
        derived.extend_from_slice(&prev);
    }
    let key = derived[..32].to_vec();
    let iv = derived[32..48].to_vec();
    (key, iv)
}

pub(crate) fn decrypt_legacy_cryptojs_note(
    ciphertext_b64: &str,
    password: &str,
) -> Result<String, AppError> {
    let raw = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        ciphertext_b64,
    )?;
    if raw.len() < 16 || &raw[..8] != b"Salted__" {
        return Err(AppError::Crypto("Not a valid CryptoJS ciphertext".into()));
    }
    let salt = &raw[8..16];
    let ciphertext = &raw[16..];

    let (key, iv) = evp_bytes_to_key(password.as_bytes(), salt);

    type Aes256CbcDec = Decryptor<Aes256>;
    let mut buf = ciphertext.to_vec();
    let plaintext = Aes256CbcDec::new_from_slices(&key, &iv)
        .map_err(|e| AppError::Crypto(format!("CBC init: {e}")))?
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|_| AppError::Crypto("Decryption failed".into()))?;

    String::from_utf8(plaintext.to_vec())
        .map_err(|e| AppError::Crypto(format!("UTF-8 decode: {e}")))
}
