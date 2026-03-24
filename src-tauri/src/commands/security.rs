use std::{fs, path::PathBuf};

use bcrypt::{hash, verify, DEFAULT_COST};
use tauri::{AppHandle, State};

use crate::shared::*;

#[tauri::command]
pub(crate) fn safe_storage_is_available() -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub(crate) fn safe_storage_encrypt(plain_text: String) -> Result<String, String> {
    safe_storage_encrypt_bytes(plain_text.as_bytes())
}

#[tauri::command]
pub(crate) fn safe_storage_decrypt(encrypted_base64: String) -> Result<String, String> {
    let decrypted = safe_storage_decrypt_bytes(&encrypted_base64)?;
    String::from_utf8(decrypted).map_err(to_error)
}

#[tauri::command]
pub(crate) fn safe_storage_store_blob(
    app: AppHandle,
    key: String,
    blob: String,
) -> Result<(), String> {
    allowed_blob_key(&key)?;
    if stronghold_save_record(&app, &key, blob.as_bytes().to_vec()).is_ok() {
        return Ok(());
    }
    keyring_entry(&key)?.set_password(&blob).map_err(to_error)
}

#[tauri::command]
pub(crate) fn safe_storage_fetch_blob(
    app: AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    allowed_blob_key(&key)?;
    if let Some(value) =
        stronghold_get_record(&app, &key)?.and_then(|bytes| String::from_utf8(bytes).ok())
    {
        return Ok(Some(value));
    }

    let entry = keyring_entry(&key)?;
    match entry.get_password() {
        Ok(value) => {
            let _ = stronghold_save_record(&app, &key, value.as_bytes().to_vec());
            Ok(Some(value))
        }
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub(crate) fn safe_storage_clear_blob(app: AppHandle, key: String) -> Result<(), String> {
    allowed_blob_key(&key)?;
    let _ = stronghold_remove_record(&app, &key);
    let entry = keyring_entry(&key)?;
    let _ = entry.delete_password();
    Ok(())
}

#[tauri::command]
pub(crate) fn asset_crypto_set_passphrase(
    app: AppHandle,
    state: State<AppState>,
    passphrase: String,
) -> Result<(), String> {
    *state.transient_passphrase.lock().map_err(to_error)? = passphrase.clone();
    if stronghold_save_record(&app, APP_PASSPHRASE_ACCOUNT, passphrase.as_bytes().to_vec()).is_ok()
    {
        return Ok(());
    }
    keyring_entry(APP_PASSPHRASE_ACCOUNT)?
        .set_password(&passphrase)
        .map_err(to_error)
}

#[tauri::command]
pub(crate) fn asset_crypto_clear_passphrase(
    app: AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    state.transient_passphrase.lock().map_err(to_error)?.clear();
    let _ = stronghold_remove_record(&app, APP_PASSPHRASE_ACCOUNT);
    let _ = keyring_entry(APP_PASSPHRASE_ACCOUNT)?.delete_password();
    Ok(())
}

#[tauri::command]
pub(crate) fn passwd_hash(password: String) -> Result<String, String> {
    hash(password, DEFAULT_COST).map_err(to_error)
}

#[tauri::command]
pub(crate) fn passwd_compare(password: String, hash: String) -> Result<bool, String> {
    if hash.is_empty() {
        return Ok(false);
    }
    verify(password, &hash).map_err(to_error)
}

#[tauri::command]
pub(crate) fn passwd_record_failure(state: State<AppState>) -> Result<FailureResult, String> {
    let mut failures = state.failure_count.lock().map_err(to_error)?;
    *failures += 1;
    Ok(FailureResult {
        fail_count: *failures,
        warn: *failures >= WARN_THRESHOLD,
    })
}

#[tauri::command]
pub(crate) fn passwd_reset_failures(state: State<AppState>) -> Result<(), String> {
    *state.failure_count.lock().map_err(to_error)? = 0;
    Ok(())
}

#[tauri::command]
pub(crate) fn is_encrypted_asset(path: String) -> Result<bool, String> {
    let raw = fs::read(path).map_err(to_error)?;
    Ok(is_encrypted_asset_buffer(&raw))
}

#[tauri::command]
pub(crate) fn encrypt_asset(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<(), String> {
    let path = PathBuf::from(path);
    let raw = fs::read(&path).map_err(to_error)?;
    let passphrase = current_asset_passphrase(&app, &state)?;
    let salt_hex = app_crypto_salt_hex(&app)?;
    let encrypted = encrypt_asset_bytes(&passphrase, &raw, &salt_hex)?;
    fs::write(path, encrypted).map_err(to_error)
}

#[tauri::command]
pub(crate) fn decrypt_asset(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(path);
    let raw = fs::read(&path).map_err(to_error)?;
    let passphrase = current_asset_passphrase(&app, &state)?;
    let salt_hex = app_crypto_salt_hex(&app)?;
    decrypt_asset_bytes(&passphrase, &raw, &salt_hex)
}
