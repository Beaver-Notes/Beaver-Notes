use std::{fs, path::PathBuf, time::{Duration, SystemTime}};

use bcrypt::{hash, verify, DEFAULT_COST};
use serde::Serialize;
use serde_json::Value;
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

fn sync_scope_path(sync_path: &str) -> PathBuf {
    PathBuf::from(sync_path)
}

fn is_ignored_asset_entry(name: &str) -> bool {
    name.is_empty() || name.starts_with('.') || name == "Thumbs.db"
}

fn collect_asset_files(root: &PathBuf, files: &mut Vec<PathBuf>) -> Result<(), AppError> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };

    for entry in entries {
        let entry = entry?;
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
) -> Result<AssetMigrationResult, AppError> {
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
            let result: Result<(), AppError> = (|| {
                let raw = fs::read(path)?;
                if encrypt {
                    // Enabling: decrypt first (in case it was encrypted with a stale key),
                    // then re-encrypt with the current key.
                    let plain = decrypt_asset(&app, &state_inner, path, &raw)?;
                    let payload = encrypt_asset(&app, &state_inner, path, &plain, false)?;
                    fs::write(path, payload)?;
                } else {
                    // Disabling: try to decrypt to plaintext. If decryption fails
                    // (e.g. asset was encrypted with an old, lost key), leave it
                    // encrypted and move on — the manifest is about to be removed anyway.
                    match decrypt_asset(&app, &state_inner, path, &raw) {
                        Ok(plain) => {
                            let payload = encrypt_asset(&app, &state_inner, path, &plain, true)?;
                            fs::write(path, payload)?;
                        }
                        Err(e) => {
                            eprintln!(
                                "[asset-migration] skipping undecryptable asset (left encrypted): {} | error: {}",
                                current, e
                            );
                        }
                    }
                }
                Ok(())
            })();
            match result {
                Ok(()) => processed += 1,
                Err(e) => {
                    eprintln!("[asset-migration] FAILED: {} | error: {}", current, e);
                    // If the key is not loaded, every file will fail — abort early.
                    if e.to_string().contains("App encryption is enabled but locked") {
                        return Err(AppError::Other(format!(
                            "App encryption key is not loaded. Unlock it before migrating assets. (First failure: {})",
                            current
                        )));
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
            .map(|e| e.to_string())
            .collect::<Vec<_>>()
            .join("; ");
        return Err(AppError::Other(format!(
            "Failed to migrate {} of {} asset file(s). Sample errors: {}.",
            failed_paths.len(),
            total,
            sample
        )));
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
) -> Result<EncryptionStateResult, AppError> {
    let enabled = app_encryption_manifest_path(&app, state.inner())?
        .exists();
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
) -> Result<EncryptionSubmitResult, AppError> {
    let create_if_missing = create_if_missing.unwrap_or(true);

    assert_not_locked(state.inner())?;

    let manifest_path = app_encryption_manifest_path(&app, state.inner())?;
    if manifest_path.exists() {
        let manifest = load_encryption_manifest(&manifest_path)?
            .ok_or_else(|| AppError::Other("Encryption manifest is missing.".into()))?;
        let key = unlock_key_from_manifest(
            &manifest,
            &password,
            APP_ENCRYPTION_SCOPE,
            APP_PASSWORD_CHECK,
        )?;
        // Populate items-key ring and cache the KEK for future rotations.
        let kek = derive_kek_from_manifest(&manifest, &password)?;
        populate_key_ring(state.inner(), &manifest, &kek)?;
        let mut s = state.crypto.session.write()?;
        s.app_data_key = Some(key);
        s.active = true;
    } else if create_if_missing {
        let (manifest, key) =
            create_encryption_manifest(APP_ENCRYPTION_SCOPE, APP_PASSWORD_CHECK, &password)?;
        write_encryption_manifest(&manifest_path, &manifest)?;
        // Store the initial key ID and cache the KEK.
        let kek = derive_kek_from_manifest(&manifest, &password)?;
        populate_key_ring(state.inner(), &manifest, &kek)?;
        let mut s = state.crypto.session.write()?;
        s.app_data_key = Some(key);
        s.active = true;
    } else {
        return Ok(EncryptionSubmitResult {
            ok: false,
            error: Some("Encryption is not enabled.".to_string()),
            state: encryption_get_state(app, state)?,
        });
    }

    {
        let mut f = state.security.failure_count.lock()?;
        *f = 0;
        *state.security.lockout_until.lock()? = None;
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
) -> Result<(), AppError> {
    let (manifest, key) =
        create_encryption_manifest(APP_ENCRYPTION_SCOPE, APP_PASSWORD_CHECK, &password)?;
    let manifest_path = app_encryption_manifest_path(&app, state.inner())?;
    write_encryption_manifest(&manifest_path, &manifest)?;
    // Cache the KEK and populate the key ring so rotation works later.
    let kek = derive_kek_from_manifest(&manifest, &password)?;
    populate_key_ring(state.inner(), &manifest, &kek)?;
    let mut s = state.crypto.session.write()?;
    s.app_data_key = Some(key);
    s.active = true;
    Ok(())
}

#[tauri::command]
pub(crate) fn encryption_disable(
    _app: AppHandle,
    _state: State<AppState>,
    _remove_manifest: Option<bool>,
) -> Result<(), AppError> {
    Err(AppError::Other("Encryption cannot be disabled. It is a core storage feature.".into()))
}

#[tauri::command]
pub(crate) fn encryption_unlock(
    app: AppHandle,
    state: State<AppState>,
    password: String,
) -> Result<(), AppError> {
    assert_not_locked(state.inner())?;
    let manifest_path = app_encryption_manifest_path(&app, state.inner())?;
    let manifest = load_encryption_manifest(&manifest_path)?
        .ok_or_else(|| AppError::Other("Encryption is not enabled.".into()))?;
    let key = unlock_key_from_manifest(
        &manifest,
        &password,
        APP_ENCRYPTION_SCOPE,
        APP_PASSWORD_CHECK,
    )?;
    // Populate items-key ring and cache the KEK for future rotations.
    let kek = derive_kek_from_manifest(&manifest, &password)?;
    populate_key_ring(state.inner(), &manifest, &kek)?;
    let mut s = state.crypto.session.write()?;
    s.app_data_key = Some(key);
    s.active = true;
    {
        let mut f = state.security.failure_count.lock()?;
        *f = 0;
        *state.security.lockout_until.lock()? = None;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn encryption_lock(state: State<AppState>) -> Result<(), AppError> {
    let mut s = state.crypto.session.write()?;
    *s = CryptoSession::default();
    Ok(())
}

#[tauri::command]
pub(crate) fn encryption_encrypt_note_payload(
    state: State<AppState>,
    plain_json: String,
) -> Result<Value, AppError> {
    let key = current_app_key(state.inner())?
        .ok_or_else(|| AppError::Other("App encryption is enabled but locked.".into()))?;
    let key_id = state
        .crypto
        .session
        .read()?
        .current_items_key_id
        .clone();
    let value: Value = serde_json::from_str(&plain_json)?;
    let envelope = aead_encrypt_json(&key, &value, NOTE_AAD)?;
    let mut result = serde_json::json!({
        "ae": 3,
        "iv": envelope.iv,
        "cipher": envelope.enc,
    });
    if !key_id.is_empty() {
        result["kid"] = Value::String(key_id);
    }
    Ok(result)
}

#[tauri::command]
pub(crate) fn encryption_decrypt_note_payload(
    state: State<AppState>,
    payload: Value,
) -> Result<Option<String>, AppError> {
    if payload.get("ae").and_then(Value::as_u64) != Some(3) {
        return Ok(Some(serde_json::to_string(&payload)?));
    }
    // Look up the correct items key by `kid` (absent → current key).
    let kid = payload
        .get("kid")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let key = match key_for_id(state.inner(), &kid)? {
        Some(key) => key,
        None => return Ok(None),
    };
    let envelope = SyncEnvelope {
        v: PROTOCOL_VERSION,
        iv: payload
            .get("iv")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::Other("Encrypted note iv missing.".into()))?
            .to_string(),
        enc: payload
            .get("cipher")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::Other("Encrypted note cipher missing.".into()))?
            .to_string(),
    };
    let value = aead_decrypt_json(&key, &envelope, NOTE_AAD)
        .map_err(|_| AppError::Other("Failed to decrypt note content.".into()))?;
    Ok(Some(serde_json::to_string(&value)?))
}

/// Encrypt a sync payload (commit / snapshot / genesis) with the items key using
/// XChaCha20-Poly1305. `aad` binds the ciphertext to its identity (e.g. the file
/// stem) so it cannot be swapped between sync entries.
#[tauri::command]
pub(crate) fn sync_encrypt_payload(
    _app: AppHandle,
    state: State<AppState>,
    json: String,
    aad: String,
) -> Result<String, AppError> {
    let key = current_app_key(state.inner())?
        .ok_or_else(|| AppError::Other("Encryption is enabled but locked.".into()))?;
    let value: Value = serde_json::from_str(&json)?;
    let envelope = aead_encrypt_json(&key, &value, &aad)?;
    Ok(serde_json::to_string(&envelope)?)
}

/// Decrypt a sync payload. Returns `DECRYPT_FAILED` on authentication failure
/// (wrong passphrase or tampered AAD) and `KEY_LOCKED` when the key is absent.
#[tauri::command]
pub(crate) fn sync_decrypt_payload(
    _app: AppHandle,
    state: State<AppState>,
    enc: String,
    aad: String,
) -> Result<String, AppError> {
    let envelope: SyncEnvelope = serde_json::from_str(&enc)?;
    if envelope.v != PROTOCOL_VERSION {
        return Err(AppError::Other(format!("Unsupported envelope version: {}", envelope.v)));
    }
    let key = match current_app_key(state.inner())? {
        Some(key) => key,
        None => return Err(AppError::Other("KEY_LOCKED".into())),
    };
    match aead_decrypt_json(&key, &envelope, &aad) {
        Ok(value) => Ok(serde_json::to_string(&value)?),
        Err(_) => Err(AppError::Other("DECRYPT_FAILED".into())),
    }
}

#[tauri::command]
pub(crate) fn sync_key_ready(state: State<AppState>) -> bool {
    state
        .crypto
        .session
        .read()
        .map(|s| s.active && s.app_data_key.is_some())
        .unwrap_or(false)
}

/// Rotate the items key: archive the current key, generate a fresh one, and
/// persist the updated manifest. Old notes remain decryptable because the
/// archived key stays in the in-memory `items_keys` ring (loaded from the
/// manifest's `previous_keys` on unlock).
///
/// Requires that the app is unlocked (the KEK is cached in `master_key_cache`).
#[tauri::command]
pub(crate) fn encryption_rotate_key(app: AppHandle, state: State<AppState>) -> Result<(), AppError> {
    rotate_items_key(&app, state.inner())?;
    Ok(())
}

/// Keep the local manifest and the shared `keyParams.json` in the sync folder
/// consistent so every device derives the same items key. `passphrase` is needed
/// to adopt a remote items key on a joining device (it is never written out).
#[tauri::command]
pub(crate) fn encryption_reconcile_key_params(
    app: AppHandle,
    state: State<AppState>,
    passphrase: Option<String>,
) -> Result<(), AppError> {
    if !state.crypto.session.read()?.active {
        return Ok(());
    }
    let params = read_key_params(&app, state.inner())?;
    match params {
        Some(params) => {
            let already_adopted = app_encryption_manifest_path(&app, state.inner())
                .ok()
                .and_then(|p| load_encryption_manifest(&p).ok().flatten())
                .map_or(false, |m| {
                    m.wrapped_key.nonce == params.wrapped_items_key.nonce
                        && m.wrapped_key.cipher == params.wrapped_items_key.cipher
                });
            if !already_adopted {
                match passphrase {
                    Some(pw) => {
                        adopt_key_params(&app, state.inner(), &params, &pw)?
                    }
                    None => {
                        // Cannot adopt without the passphrase yet; a later sync
                        // (which supplies it from secure storage) will retry.
                    }
                }
            }
        }
        None => {
            publish_key_params(&app, state.inner())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn safe_storage_is_available(_state: State<AppState>) -> Result<bool, AppError> {
    if KEYRING_AVAILABLE.load(std::sync::atomic::Ordering::Relaxed) {
        return Ok(true);
    }
    let master_key_result = file_based_master_key();
    Ok(master_key_result.is_ok())
}

#[tauri::command]
pub(crate) fn safe_storage_encrypt(plain_text: String) -> Result<String, AppError> {
    safe_storage_encrypt_bytes(plain_text.as_bytes())
}

#[tauri::command]
pub(crate) fn safe_storage_decrypt(encrypted_base64: String) -> Result<String, AppError> {
    let decrypted = safe_storage_decrypt_bytes(&encrypted_base64)?;
    String::from_utf8(decrypted).map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub(crate) fn safe_storage_store_blob(
    state: State<AppState>,
    key: String,
    blob: String,
) -> Result<(), AppError> {
    allowed_blob_key(&key)?;
    let s = state.inner();
    s.cache.secure_blobs.store_blob(s, &key, blob.as_bytes().to_vec())
}

#[tauri::command]
pub(crate) fn safe_storage_fetch_blob(
    state: State<AppState>,
    key: String,
) -> Result<Option<String>, AppError> {
    allowed_blob_key(&key)?;
    let s = state.inner();
    s.cache.secure_blobs
        .fetch_blob(s, &key)?
        .map(|bytes| String::from_utf8(bytes).map_err(|e| AppError::Other(e.to_string())))
        .transpose()
}

#[tauri::command]
pub(crate) fn safe_storage_clear_blob(state: State<AppState>, key: String) -> Result<(), AppError> {
    allowed_blob_key(&key)?;
    let s = state.inner();
    s.cache.secure_blobs.clear_blob(s, &key)
}

#[tauri::command]
pub(crate) fn asset_crypto_set_passphrase(
    state: State<AppState>,
    passphrase: String,
) -> Result<(), AppError> {
    *state.security.transient_passphrase.lock()? = passphrase;
    *state.crypto.asset_key_cache.lock()? = None;
    Ok(())
}

#[tauri::command]
pub(crate) fn asset_crypto_clear_passphrase(state: State<AppState>) -> Result<(), AppError> {
    state.security.transient_passphrase.lock()?.clear();
    *state.crypto.asset_key_cache.lock()? = None;
    Ok(())
}

#[tauri::command]
pub(crate) fn passwd_hash(password: String) -> Result<String, AppError> {
    hash(password, DEFAULT_COST).map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub(crate) fn passwd_compare(password: String, hash: String) -> Result<bool, AppError> {
    if hash.is_empty() {
        return Ok(false);
    }
    verify(password, &hash).map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub(crate) fn passwd_record_failure(state: State<AppState>) -> Result<FailureResult, AppError> {
    let mut failures = state.security.failure_count.lock()?;
    *failures += 1;
    let mut lockout_guard = state.security.lockout_until.lock()?;
    let now = SystemTime::now();
    let already_locked = lockout_guard
        .map(|until| until > now)
        .unwrap_or(false);

    if *failures >= LOCKOUT_THRESHOLD {
        // Set or extend the lockout; never start a new lockout in the past.
        let extra = if already_locked {
            LOCKOUT_BASE_SECS
        } else {
            LOCKOUT_BASE_SECS
        };
        let base = lockout_guard.unwrap_or(now);
        let new_until = (if base > now { base } else { now }) + Duration::from_secs(extra);
        let capped = now + Duration::from_secs(LOCKOUT_MAX_SECS);
        *lockout_guard = Some(new_until.min(capped));
    }

    let remaining = lockout_guard
        .map(|until| until.duration_since(now).map(|d| d.as_secs()).unwrap_or(0))
        .unwrap_or(0);
    Ok(FailureResult {
        fail_count: *failures,
        warn: *failures >= WARN_THRESHOLD,
        locked: remaining > 0,
        lockout_seconds: remaining,
    })
}

#[tauri::command]
pub(crate) fn passwd_reset_failures(state: State<AppState>) -> Result<(), AppError> {
    *state.security.failure_count.lock()? = 0;
    *state.security.lockout_until.lock()? = None;
    Ok(())
}

/// Returns `Err` with a lockout message when unlock attempts are currently
/// rate-limited, clearing an expired lockout so a fresh attempt can proceed.
fn assert_not_locked(state: &AppState) -> Result<(), AppError> {
    let mut lockout_guard = state.security.lockout_until.lock()?;
    match *lockout_guard {
        Some(until) if until > SystemTime::now() => {
            let secs = until
                .duration_since(SystemTime::now())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            Err(AppError::Other(format!(
                "Too many incorrect attempts. Try again in {} second(s).",
                secs
            )))
        }
        Some(_) => {
            // Expired — clear and allow the attempt.
            *lockout_guard = None;
            Ok(())
        }
        None => Ok(()),
    }
}

#[tauri::command]
pub(crate) fn is_encrypted_asset(path: String) -> Result<bool, AppError> {
    let raw = fs::read(path)?;
    Ok(is_encrypted_asset_buffer(&raw))
}

#[tauri::command]
pub(crate) async fn encryption_decrypt_asset_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<String, AppError> {
    let path_buf = PathBuf::from(path.clone());
    let state_inner = state.inner();

    if let Some(cached) = get_cached_decrypted_asset(&state_inner, &path) {
        let metadata = fs::metadata(&path_buf)?;
        let cache_path = crate::shared::decrypted_cache_path(
            &state_inner.files.asset_cache_dir,
            &path_buf,
            &metadata,
        )?;
        fs::write(&cache_path, &cached)?;
        return Ok(cache_path.to_string_lossy().to_string());
    }

    let raw = fs::read(&path_buf)?;
    let key = current_app_key(&state_inner)?
        .ok_or_else(|| AppError::Other("App encryption is enabled but locked.".into()))?;

    if is_encrypted_asset_v2(&raw) || is_encrypted_asset_buffer(&raw) {
        let metadata = fs::metadata(&path_buf)?;
        let output_path = crate::shared::decrypted_cache_path(
            &state_inner.files.asset_cache_dir,
            &path_buf,
            &metadata,
        )?;
        if is_encrypted_asset_v2(&raw) {
            decrypt_asset_streaming(&path_buf, &output_path, &key)?;
        } else {
            let plain = decrypt_asset(&app, &state_inner, &path_buf, &raw)?;
            fs::write(&output_path, &plain)?;
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
) -> Result<(), AppError> {
    let path_buf = PathBuf::from(path.clone());
    let state_inner = state.inner();

    let key = current_app_key(&state_inner)?
        .ok_or_else(|| AppError::Other("App encryption is enabled but locked.".into()))?;
    let temp_path = path_buf.with_extension("enc.tmp");
    encrypt_asset_streaming(&path_buf, &temp_path, &key)?;
    fs::rename(&temp_path, &path_buf)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn encryption_cache_decrypted_note(
    state: State<AppState>,
    note_id: String,
    content: Vec<u8>,
) -> Result<(), AppError> {
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
pub(crate) fn encryption_clear_decrypted_caches(state: State<AppState>) -> Result<(), AppError> {
    crate::shared::clear_decrypted_caches(state.inner());
    Ok(())
}

#[tauri::command]
pub(crate) fn decrypt_legacy_cryptojs_note(
    ciphertext_b64: String,
    password: String,
) -> Result<String, AppError> {
    crate::shared::decrypt_legacy_cryptojs_note(&ciphertext_b64, &password)
}

#[tauri::command]
pub(crate) fn derive_argon2_key(
    passphrase: String,
    salt: Option<String>,
) -> Result<String, AppError> {
    let salt = match salt {
        Some(s) => hex::decode(&s)?,
        None => {
            let mut s = [0u8; 16];
            rand::thread_rng().fill_bytes(&mut s);
            s.to_vec()
        }
    };
    let key = crate::shared::derive_kek_argon2id(&passphrase, &salt)?;
    Ok(hex::encode(key))
}
