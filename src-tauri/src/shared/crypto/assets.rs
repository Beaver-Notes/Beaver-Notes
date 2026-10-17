use std::{
    fs,
    fs::File,
    io::{BufReader, BufWriter, Read, Write},
    path::Path,
};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use tauri::AppHandle;

use super::super::{is_local_asset_path, AppError, AppState};
use super::keys::{current_app_key, derive_chunk_nonce, random_nonce, STREAM_CHUNK_SIZE};

pub(crate) const ASSET_MAGIC: &[u8; 4] = b"BNA3";
pub(crate) const ASSET_MAGIC_LEGACY_V2: &[u8; 4] = b"BNA2";
pub(crate) const ASSET_MAGIC_LEGACY_V1: &[u8; 4] = b"BNA1";

pub(crate) fn encrypt_asset_bytes_with_key(
    plain: &[u8],
    key: &[u8; 32],
) -> Result<Vec<u8>, AppError> {
    let _t = crate::shared::speed_log::scope("assets.encrypt_asset_bytes");
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce_seed = random_nonce();
    let nonce = derive_chunk_nonce(&nonce_seed, 0, key);
    let encrypted = cipher.encrypt(Nonce::from_slice(&nonce), plain)?;
    let mut output = Vec::with_capacity(4 + 12 + 4 + encrypted.len());
    output.extend_from_slice(ASSET_MAGIC);
    output.extend_from_slice(&nonce_seed);
    output.extend_from_slice(&(encrypted.len() as u32).to_le_bytes());
    output.extend_from_slice(&encrypted);
    Ok(output)
}

pub(crate) fn decrypt_asset_bytes_with_key(
    encrypted: &[u8],
    key: &[u8; 32],
) -> Result<Vec<u8>, AppError> {
    let _t = crate::shared::speed_log::scope("assets.decrypt_asset_bytes");
    if encrypted.len() < 4 + 12 + 16 {
        return Ok(encrypted.to_vec());
    }
    let magic = &encrypted[..4];
    if magic == ASSET_MAGIC {
        let nonce_seed: &[u8; 12] = &encrypted[4..16]
            .try_into()
            .map_err(|_| AppError::Crypto("invalid BNA3 nonce seed".into()))?;
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
        let mut offset = 16usize;
        let mut result = Vec::new();
        let mut chunk_index = 0u64;
        while offset + 4 <= encrypted.len() {
            let chunk_len =
                u32::from_le_bytes(encrypted[offset..offset + 4].try_into().unwrap()) as usize;
            offset += 4;
            if offset + chunk_len > encrypted.len() {
                return Err(AppError::Crypto(format!(
                    "BNA3 chunk {} extends past buffer (offset={}, len={}, buf={})",
                    chunk_index,
                    offset,
                    chunk_len,
                    encrypted.len()
                )));
            }
            let aead = &encrypted[offset..offset + chunk_len];
            let nonce = derive_chunk_nonce(nonce_seed, chunk_index, key);
            let decrypted = cipher
                .decrypt(Nonce::from_slice(&nonce), aead)
                .map_err(|_| {
                    AppError::Crypto(format!("BNA3 chunk {} decryption failed", chunk_index))
                })?;
            result.extend_from_slice(&decrypted);
            offset += chunk_len;
            chunk_index += 1;
        }
        return Ok(result);
    }
    if magic == ASSET_MAGIC_LEGACY_V2 || magic == ASSET_MAGIC_LEGACY_V1 {
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
    let _t = crate::shared::speed_log::scope("assets.encrypt_asset_streaming");
    let input = File::open(input_path)?;
    let output = File::create(output_path)?;
    let mut reader = BufReader::with_capacity(STREAM_CHUNK_SIZE, input);
    let mut writer = BufWriter::with_capacity(STREAM_CHUNK_SIZE, output);

    let nonce_seed = random_nonce();
    writer.write_all(ASSET_MAGIC)?;
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

        let encrypted = cipher.encrypt(Nonce::from_slice(&nonce), chunk)?;

        let (ciphertext, tag) = encrypted.split_at(encrypted.len().saturating_sub(16));
        writer.write_all(&(encrypted.len() as u32).to_le_bytes())?;
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
    let _t = crate::shared::speed_log::scope("assets.decrypt_asset_streaming");
    let input = File::open(input_path)?;
    let mut reader = BufReader::with_capacity(STREAM_CHUNK_SIZE + 32, input);

    let mut magic = [0u8; 4];
    match reader.read_exact(&mut magic) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
            drop(reader);
            fs::copy(input_path, output_path)?;
            crate::shared::restrict_private(output_path)?;
            return Ok(());
        }
        Err(e) => return Err(AppError::from(e)),
    }

    if &magic != ASSET_MAGIC && &magic != ASSET_MAGIC_LEGACY_V2 {
        drop(reader);
        let data = fs::read(input_path)?;
        let plain = decrypt_asset_bytes_with_key(&data, key)?;
        crate::shared::write_private_bytes(output_path, &plain)?;
        return Ok(());
    }

    let is_v3 = &magic == ASSET_MAGIC;

    let mut nonce_seed = [0u8; 12];
    reader.read_exact(&mut nonce_seed)?;

    // Assets from `encrypt_asset_bytes_with_key` (fs:writeFile, migration) are
    // a single chunk possibly larger than STREAM_CHUNK_SIZE: validate chunk
    // lengths against bytes remaining, not a fixed streaming cap.
    let file_len = reader.get_ref().metadata().map_err(AppError::from)?.len();
    let mut bytes_consumed = (ASSET_MAGIC.len() + nonce_seed.len()) as u64;

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
        let remaining = file_len.saturating_sub(bytes_consumed + 4);

        if chunk_len == 0 || chunk_len as u64 > remaining {
            return Err(AppError::Crypto(format!(
                "Invalid chunk length {} at index {}",
                chunk_len, chunk_index
            )));
        }
        bytes_consumed += 4 + chunk_len as u64;

        let mut chunk_buf = vec![0u8; chunk_len];
        reader.read_exact(&mut chunk_buf).map_err(|e| {
            AppError::Crypto(format!("Failed to read chunk {}: {}", chunk_index, e))
        })?;

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
            .map_err(|_| {
                AppError::Crypto(format!("Decryption failed for chunk {}", chunk_index))
            })?;

        writer.write_all(&decrypted)?;
        chunk_index += 1;
    }

    writer.flush()?;
    drop(writer);
    crate::shared::restrict_private(output_path)?;
    Ok(())
}

// Yjs binary updates and snapshots stored in SQLite are encrypted at rest when
// app encryption is enabled.  A 4-byte magic prefix (`BNY1`) distinguishes
// encrypted blobs from legacy unencrypted ones so reads are backwards-compatible.

pub(crate) const YJS_MAGIC: &[u8; 4] = b"BNY1";

/// Encrypt a raw Yjs binary blob for at-rest storage in SQLite.
/// Returns `BNY1 || nonce(12) || ciphertext`.
pub(crate) fn encrypt_yjs_blob(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, AppError> {
    let _t = crate::shared::speed_log::scope("assets.encrypt_yjs_blob");
    if data.is_empty() {
        return Ok(data.to_vec());
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = random_nonce();
    let encrypted = cipher.encrypt(Nonce::from_slice(&nonce), data)?;
    let mut output = Vec::with_capacity(4 + 12 + encrypted.len());
    output.extend_from_slice(YJS_MAGIC);
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&encrypted);
    Ok(output)
}

/// Decrypt a Yjs blob from `encrypt_yjs_blob`. Legacy unencrypted blobs (no
/// `BNY1` prefix) pass through so existing databases work without a migration.
pub(crate) fn decrypt_yjs_blob(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, AppError> {
    let _t = crate::shared::speed_log::scope("assets.decrypt_yjs_blob");
    if data.len() < 4 + 12 {
        return Ok(data.to_vec());
    }
    if &data[..4] != YJS_MAGIC {
        return Ok(data.to_vec());
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = &data[4..16];
    let ciphertext = &data[16..];
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| AppError::Crypto("Yjs blob decryption failed".into()))
}

/// Check whether a Yjs blob is encrypted (has the `BNY1` magic prefix).
pub(crate) fn is_encrypted_yjs_blob(data: &[u8]) -> bool {
    data.len() >= 4 && &data[..4] == YJS_MAGIC
}

/// Checks if a buffer is an encrypted asset (all formats: BNA3, BNA2, BNA1).
pub(crate) fn is_encrypted_asset_buffer(buffer: &[u8]) -> bool {
    (buffer.len() > 4 + 12 + 4 && &buffer[..4] == ASSET_MAGIC)
        || (buffer.len() > 4 + 12 + 16 && &buffer[..4] == ASSET_MAGIC_LEGACY_V2)
        || (buffer.len() > 4 + 12 + 16 && &buffer[..4] == ASSET_MAGIC_LEGACY_V1)
}

/// Encrypted-asset check from a 4-byte magic prefix + file size, without
/// reading the payload. Mirrors [`is_encrypted_asset_buffer`] thresholds.
pub(crate) fn is_encrypted_asset_header(magic: &[u8; 4], file_size: u64) -> bool {
    (file_size > 4 + 12 + 4 && magic == ASSET_MAGIC)
        || (file_size > 4 + 12 + 16
            && (magic == ASSET_MAGIC_LEGACY_V2 || magic == ASSET_MAGIC_LEGACY_V1))
}

pub(crate) fn encrypt_asset(
    app: &AppHandle,
    state: &AppState,
    target_path: &Path,
    input: &[u8],
) -> Result<Vec<u8>, AppError> {
    if !is_local_asset_path(app, target_path) || is_encrypted_asset_buffer(input) {
        return Ok(input.to_vec());
    }
    let key = current_app_key(state)?.ok_or(AppError::EncryptionLocked)?;
    encrypt_asset_bytes_with_key(input, &key)
}

pub(crate) fn decrypt_asset(
    app: &AppHandle,
    state: &AppState,
    target_path: &Path,
    input: &[u8],
) -> Result<Vec<u8>, AppError> {
    if !is_local_asset_path(app, target_path) || !is_encrypted_asset_buffer(input) {
        return Ok(input.to_vec());
    }
    let key = current_app_key(state)?.ok_or(AppError::EncryptionLocked)?;
    decrypt_asset_bytes_with_key(input, &key)
}
