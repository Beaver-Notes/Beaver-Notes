use std::{fs, path::PathBuf};

use bcrypt::{hash, verify, DEFAULT_COST};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::shared::*;
use rand::RngCore;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssetMigrationResult {
    pub(crate) total: usize,
    pub(crate) processed: usize,
    pub(crate) failed_paths: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssetMigrationProgressPayload {
    pub(crate) processed: usize,
    pub(crate) total: usize,
    pub(crate) current: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EncryptionStateResult {
    pub(crate) enabled: bool,
    pub(crate) unlocked: bool,
    pub(crate) app_enabled: bool,
    pub(crate) app_unlocked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EncryptionSubmitResult {
    pub(crate) ok: bool,
    pub(crate) error: Option<String>,
    pub(crate) state: EncryptionStateResult,
}

fn note_envelope_json(cipher: WrappedKeyEnvelope) -> Value {
    json!({
        "ae": 2,
        "nonce": cipher.nonce,
        "cipher": cipher.cipher,
    })
}

fn parse_wrapped_envelope(value: &Value) -> Option<WrappedKeyEnvelope> {
    Some(WrappedKeyEnvelope {
        nonce: value.get("nonce")?.as_str()?.to_string(),
        cipher: value.get("cipher")?.as_str()?.to_string(),
    })
}

fn sync_envelope_json(cipher: WrappedKeyEnvelope) -> Result<String, String> {
    serde_json::to_string(&json!({
        "v": 3,
        "nonce": cipher.nonce,
        "cipher": cipher.cipher,
    }))
    .map_err(to_error)
}

fn sync_scope_path(sync_path: &str) -> PathBuf {
    PathBuf::from(sync_path)
}

fn is_ignored_asset_entry(name: &str) -> bool {
    name.is_empty() || name.starts_with('.') || name == "Thumbs.db"
}

fn collect_asset_files(root: &PathBuf, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };

    for entry in entries {
        let entry = entry.map_err(to_error)?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if is_ignored_asset_entry(&name) {
            continue;
        }
        if path.is_dir() {
            collect_asset_files(&path, files)?;
        } else if path.is_file() {
            files.push(path);
        }
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn asset_crypto_migrate_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    encrypt_at_rest: bool,
) -> Result<AssetMigrationResult, String> {
    let app_dir = app_storage_dir(&app, state.inner())?;
    assert_path_access(&app, state.inner(), &app_dir, "migrate asset encryption")?;

    let mut files = Vec::new();
    for root in ["notes-assets", "file-assets"] {
        collect_asset_files(&app_dir.join(root), &mut files)?;
    }

    let total = files.len();
    let mut processed = 0;
    let mut failed_paths = Vec::new();
    let mut failed_reasons = Vec::new();
    let batch_size = 4usize;

    let state_inner = state.inner();
    let encrypt = encrypt_at_rest;

    for chunk in files.chunks(batch_size) {
        for path in chunk {
            let current = path.to_string_lossy().to_string();
            let result: Result<(), String> = (|| {
                let raw = fs::read(path).map_err(to_error)?;
                if encrypt {
                    // Enabling: decrypt first (in case it was encrypted with a stale key),
                    // then re-encrypt with the current key.
                    let plain = decrypt_asset(&app, &state_inner, path, &raw)?;
                    let payload = encrypt_asset(&app, &state_inner, path, &plain, false)?;
                    fs::write(path, payload).map_err(to_error)
                } else {
                    // Disabling: try to decrypt to plaintext. If decryption fails
                    // (e.g. asset was encrypted with an old, lost key), leave it
                    // encrypted and move on — the manifest is about to be removed anyway.
                    match decrypt_asset(&app, &state_inner, path, &raw) {
                        Ok(plain) => {
                            let payload =
                                encrypt_asset(&app, &state_inner, path, &plain, true)?;
                            fs::write(path, payload).map_err(to_error)
                        }
                        Err(e) => {
                            eprintln!(
                                "[asset-migration] skipping undecryptable asset (left encrypted): {} | error: {}",
                                current, e
                            );
                            Ok(())
                        }
                    }
                }
            })();
            match result {
                Ok(()) => processed += 1,
                Err(e) => {
                    eprintln!("[asset-migration] FAILED: {} | error: {}", current, e);
                    // If the key is not loaded, every file will fail — abort early.
                    if e.contains("App encryption is enabled but locked") {
                        return Err(format!(
                            "App encryption key is not loaded. Unlock it before migrating assets. (First failure: {})",
                            current
                        ));
                    }
                    failed_paths.push(current.clone());
                    failed_reasons.push(e);
                }
            }
            let _ = app.emit(
                "asset-migration-progress",
                AssetMigrationProgressPayload {
                    processed,
                    total,
                    current,
                },
            );
        }
        tokio::task::yield_now().await;
    }

    if !failed_paths.is_empty() {
        let sample = failed_reasons
            .iter()
            .take(3)
            .cloned()
            .collect::<Vec<_>>()
            .join("; ");
        return Err(format!(
            "Failed to migrate {} of {} asset file(s). Sample errors: {}.",
            failed_paths.len(),
            total,
            sample
        ));
    }

    Ok(AssetMigrationResult {
        total,
        processed,
        failed_paths,
    })
}

#[tauri::command]
pub(crate) fn encryption_get_state(
    app: AppHandle,
    state: State<AppState>,
) -> Result<EncryptionStateResult, String> {
    let enabled = app_encryption_manifest_path(&app, state.inner())?.exists();
    let unlocked = current_app_key(state.inner())?.is_some();

    Ok(EncryptionStateResult {
        enabled,
        unlocked,
        app_enabled: enabled,
        app_unlocked: unlocked,
    })
}

#[tauri::command]
pub(crate) fn encryption_submit_password(
    app: AppHandle,
    state: State<AppState>,
    password: String,
    create_if_missing: Option<bool>,
) -> Result<EncryptionSubmitResult, String> {
    let create_if_missing = create_if_missing.unwrap_or(true);

    let manifest_path = app_encryption_manifest_path(&app, state.inner())?;
    if manifest_path.exists() {
        let manifest = load_encryption_manifest(&manifest_path)?
            .ok_or_else(|| "Encryption manifest is missing.".to_string())?;
        let key = unlock_key_from_manifest(
            &manifest,
            &password,
            APP_ENCRYPTION_SCOPE,
            APP_PASSWORD_CHECK,
        )?;
        *state.app_data_key.lock().map_err(to_error)? = Some(key);
    } else if create_if_missing {
        let (manifest, key) =
            create_encryption_manifest(APP_ENCRYPTION_SCOPE, APP_PASSWORD_CHECK, &password)?;
        write_encryption_manifest(&manifest_path, &manifest)?;
        *state.app_data_key.lock().map_err(to_error)? = Some(key);
        state.inner().app_encryption_active.store(true, std::sync::atomic::Ordering::Release);
    } else {
        return Ok(EncryptionSubmitResult {
            ok: false,
            error: Some("Encryption is not enabled.".to_string()),
            state: encryption_get_state(app, state)?,
        });
    }

    Ok(EncryptionSubmitResult {
        ok: true,
        error: None,
        state: encryption_get_state(app, state)?,
    })
}

#[tauri::command]
pub(crate) fn encryption_enable(
    app: AppHandle,
    state: State<AppState>,
    password: String,
) -> Result<(), String> {
    let (manifest, key) =
        create_encryption_manifest(APP_ENCRYPTION_SCOPE, APP_PASSWORD_CHECK, &password)?;
    let manifest_path = app_encryption_manifest_path(&app, state.inner())?;
    write_encryption_manifest(&manifest_path, &manifest)?;
    *state.app_data_key.lock().map_err(to_error)? = Some(key);
    state.inner().app_encryption_active.store(true, std::sync::atomic::Ordering::Release);
    Ok(())
}

#[tauri::command]
pub(crate) fn encryption_disable(
    app: AppHandle,
    state: State<AppState>,
    remove_manifest: Option<bool>,
) -> Result<(), String> {
    *state.app_data_key.lock().map_err(to_error)? = None;
    if remove_manifest.unwrap_or(true) {
        let manifest_path = app_encryption_manifest_path(&app, state.inner())?;
        let _ = fs::remove_file(manifest_path);
        state.inner().app_encryption_active.store(false, std::sync::atomic::Ordering::Release);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn encryption_unlock(
    app: AppHandle,
    state: State<AppState>,
    password: String,
) -> Result<(), String> {
    let manifest_path = app_encryption_manifest_path(&app, state.inner())?;
    let manifest = load_encryption_manifest(&manifest_path)?
        .ok_or_else(|| "Encryption is not enabled.".to_string())?;
    let key = unlock_key_from_manifest(
        &manifest,
        &password,
        APP_ENCRYPTION_SCOPE,
        APP_PASSWORD_CHECK,
    )?;
    *state.app_data_key.lock().map_err(to_error)? = Some(key);
    Ok(())
}

#[tauri::command]
pub(crate) fn encryption_lock(state: State<AppState>) -> Result<(), String> {
    *state.app_data_key.lock().map_err(to_error)? = None;
    Ok(())
}

#[tauri::command]
pub(crate) fn encryption_encrypt_note_payload(
    state: State<AppState>,
    plain_json: String,
) -> Result<Value, String> {
    let key = current_app_key(state.inner())?
        .ok_or_else(|| "App encryption is enabled but locked.".to_string())?;
    let envelope = encrypt_bytes_with_key(&key, plain_json.as_bytes())?;
    Ok(note_envelope_json(envelope))
}

#[tauri::command]
pub(crate) fn encryption_decrypt_note_payload(
    state: State<AppState>,
    payload: Value,
) -> Result<Option<String>, String> {
    if payload.get("ae").and_then(Value::as_u64) != Some(2) {
        return serde_json::to_string(&payload).map(Some).map_err(to_error);
    }
    let key = match current_app_key(state.inner())? {
        Some(key) => key,
        None => return Ok(None),
    };
    let envelope = parse_wrapped_envelope(&payload)
        .ok_or_else(|| "Invalid encrypted note payload.".to_string())?;
    let plain = decrypt_bytes_with_key(&key, &envelope)?;
    String::from_utf8(plain).map(Some).map_err(to_error)
}

#[tauri::command]
pub(crate) fn encryption_export_app_key(state: State<AppState>) -> Result<Option<Vec<u8>>, String> {
    Ok(current_app_key(state.inner())?.map(|k| k.to_vec()))
}

#[tauri::command]
pub(crate) fn encryption_encrypt_sync_payload(
    state: State<AppState>,
    plain_text: String,
) -> Result<String, String> {
    let key = current_app_key(state.inner())?
        .ok_or_else(|| "Encryption is enabled but locked.".to_string())?;
    sync_envelope_json(encrypt_bytes_with_key(&key, plain_text.as_bytes())?)
}

#[tauri::command]
pub(crate) fn encryption_decrypt_sync_payload(
    state: State<AppState>,
    payload: String,
) -> Result<Option<String>, String> {
    let parsed = match serde_json::from_str::<Value>(&payload) {
        Ok(parsed) => parsed,
        Err(_) => return Ok(Some(payload)),
    };
    if parsed.get("v").and_then(Value::as_u64) != Some(3) {
        return Ok(Some(payload));
    }
    let key = match current_app_key(state.inner())? {
        Some(key) => key,
        None => return Ok(None),
    };
    let envelope = parse_wrapped_envelope(&parsed)
        .ok_or_else(|| "Invalid encrypted sync payload.".to_string())?;
    let plain = decrypt_bytes_with_key(&key, &envelope)?;
    String::from_utf8(plain).map(Some).map_err(to_error)
}

#[tauri::command]
pub(crate) fn encryption_encrypt_sync_asset_base64(
    state: State<AppState>,
    base64_data: String,
) -> Result<String, String> {
    let key = current_app_key(state.inner())?
        .ok_or_else(|| "Encryption is enabled but locked.".to_string())?;
    sync_envelope_json(encrypt_bytes_with_key(&key, base64_data.as_bytes())?)
}

#[tauri::command]
pub(crate) fn safe_storage_is_available(_state: State<AppState>) -> Result<bool, String> {
    if KEYRING_AVAILABLE.load(std::sync::atomic::Ordering::Relaxed) {
        return Ok(true);
    }
    let master_key_result = file_based_master_key();
    Ok(master_key_result.is_ok())
}

#[tauri::command]
pub(crate) fn safe_storage_encrypt(plain_text: String) -> Result<String, String> {
    safe_storage_encrypt_bytes(plain_text.as_bytes()).map_err(String::from)
}

#[tauri::command]
pub(crate) fn safe_storage_decrypt(encrypted_base64: String) -> Result<String, String> {
    let decrypted = safe_storage_decrypt_bytes(&encrypted_base64)?;
    String::from_utf8(decrypted).map_err(to_error)
}

#[tauri::command]
pub(crate) fn safe_storage_store_blob(
    state: State<AppState>,
    key: String,
    blob: String,
) -> Result<(), String> {
    allowed_blob_key(&key)?;
    let s = state.inner();
    s.secure_blobs.store_blob(s, &key, blob.as_bytes().to_vec())
}

#[tauri::command]
pub(crate) fn safe_storage_fetch_blob(
    state: State<AppState>,
    key: String,
) -> Result<Option<String>, String> {
    allowed_blob_key(&key)?;
    let s = state.inner();
    s.secure_blobs
        .fetch_blob(s, &key)?
        .map(|bytes| String::from_utf8(bytes).map_err(to_error))
        .transpose()
}

#[tauri::command]
pub(crate) fn safe_storage_clear_blob(
    state: State<AppState>,
    key: String,
) -> Result<(), String> {
    allowed_blob_key(&key)?;
    let s = state.inner();
    s.secure_blobs.clear_blob(s, &key)
}

#[tauri::command]
pub(crate) fn asset_crypto_set_passphrase(
    state: State<AppState>,
    passphrase: String,
) -> Result<(), String> {
    *state.transient_passphrase.lock().map_err(to_error)? = passphrase;
    *state.asset_key_cache.lock().map_err(to_error)? = None;
    Ok(())
}

#[tauri::command]
pub(crate) fn asset_crypto_clear_passphrase(state: State<AppState>) -> Result<(), String> {
    state.transient_passphrase.lock().map_err(to_error)?.clear();
    *state.asset_key_cache.lock().map_err(to_error)? = None;
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
pub(crate) async fn encryption_decrypt_asset_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let path_buf = PathBuf::from(path.clone());
    let state_inner = state.inner();

    if let Some(cached) = get_cached_decrypted_asset(&state_inner, &path) {
        let metadata = fs::metadata(&path_buf).map_err(to_error)?;
        let cache_path = crate::shared::decrypted_cache_path(
            &state_inner.asset_cache_dir,
            &path_buf,
            &metadata,
        )?;
        fs::write(&cache_path, &cached).map_err(to_error)?;
        return Ok(cache_path.to_string_lossy().to_string());
    }

    let raw = fs::read(&path_buf).map_err(to_error)?;
    let key = current_app_key(&state_inner)?
        .ok_or_else(|| "App encryption is enabled but locked.".to_string())?;

    if is_encrypted_asset_v2(&raw) || is_encrypted_asset_buffer(&raw) {
        let metadata = fs::metadata(&path_buf).map_err(to_error)?;
        let output_path = crate::shared::decrypted_cache_path(
            &state_inner.asset_cache_dir,
            &path_buf,
            &metadata,
        )?;
        if is_encrypted_asset_v2(&raw) {
            decrypt_asset_streaming(&path_buf, &output_path, &key)?;
        } else {
            let plain = decrypt_asset(&app, &state_inner, &path_buf, &raw)?;
            fs::write(&output_path, &plain).map_err(to_error)?;
            cache_decrypted_asset(&state_inner, &path, &plain);
        }
        Ok(output_path.to_string_lossy().to_string())
    } else {
        Ok(path)
    }
}

#[tauri::command]
pub(crate) async fn encryption_encrypt_asset_stream(
    _app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let path_buf = PathBuf::from(path.clone());
    let state_inner = state.inner();

    let key = current_app_key(&state_inner)?
        .ok_or_else(|| "App encryption is enabled but locked.".to_string())?;
    let temp_path = path_buf.with_extension("enc.tmp");
    encrypt_asset_streaming(&path_buf, &temp_path, &key)?;
    fs::rename(&temp_path, &path_buf).map_err(to_error)
}

#[tauri::command]
pub(crate) fn encryption_cache_decrypted_note(
    state: State<AppState>,
    note_id: String,
    content: Vec<u8>,
) -> Result<(), String> {
    crate::shared::cache_decrypted_note(state.inner(), &note_id, &content);
    Ok(())
}

#[tauri::command]
pub(crate) fn encryption_get_cached_decrypted_note(
    state: State<AppState>,
    note_id: String,
) -> Option<Vec<u8>> {
    crate::shared::get_cached_decrypted_note(state.inner(), &note_id)
}

#[tauri::command]
pub(crate) fn encryption_clear_decrypted_caches(state: State<AppState>) -> Result<(), String> {
    crate::shared::clear_decrypted_caches(state.inner());
    Ok(())
}

#[tauri::command]
pub(crate) fn decrypt_legacy_cryptojs_note(
    ciphertext_b64: String,
    password: String,
) -> Result<String, String> {
    crate::shared::decrypt_legacy_cryptojs_note(&ciphertext_b64, &password).map_err(String::from)
}

#[tauri::command]
pub(crate) fn derive_argon2_key(
    passphrase: String,
    salt: Option<String>,
) -> Result<String, String> {
    let salt = match salt {
        Some(s) => hex::decode(&s).map_err(to_error)?,
        None => {
            let mut s = [0u8; 16];
            rand::thread_rng().fill_bytes(&mut s);
            s.to_vec()
        }
    };
    let key = crate::shared::derive_kek_argon2id(&passphrase, &salt)?;
    Ok(hex::encode(key))
}
