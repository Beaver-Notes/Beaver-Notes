use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Condvar, Mutex},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rand::RngCore;

use super::super::{AppError, SAFE_STORAGE_SERVICE};
use super::keys::{
    decrypt_bytes_with_key, derive_kek_argon2id_with_params, encrypt_bytes_with_key, random_key,
    random_nonce, WrappedKeyEnvelope,
};

use keyring::credential::CredentialBuilderApi;
use aes_gcm::aead::{Aead, KeyInit};

// Task 3 moves `SAFE_STORAGE_MASTER_ACCOUNT` here from `keys.rs`. Until then it
// is defined locally so the brief's code compiles as-is.
pub(crate) const SAFE_STORAGE_MASTER_ACCOUNT: &str = "__safe_storage_master_key__";

pub(crate) const MASTER_KEY_FILE: &str = "master.key";
pub(crate) const MASTER_KEY_ENC_FILE: &str = "master.key.enc";

/// Which secure backend currently protects the master key. Mirrors the OS
/// keychain on macOS/Windows/iOS, Secret Service or the kernel keyring on
/// Linux, and Android Keystore on Android. `EncryptedFile` is the Linux
/// device-password fallback.
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MasterKeyBackendKind {
    Keychain,
    SecretService,
    KernelKeyring,
    EncryptedFile,
    AndroidKeystore,
    None,
}

enum MasterKeyState {
    Pending,
    Loading,
    Ready(Vec<u8>),
}

static MASTER_KEY_STATE: Mutex<MasterKeyState> = Mutex::new(MasterKeyState::Pending);
static MASTER_KEY_CONDVAR: Condvar = Condvar::new();

/// Per-launch cache of the device-password KEK used to unlock `master.key.enc`.
/// Never persisted; cleared at shutdown. `None` means the device password has
/// not been supplied this session.
static DEVICE_KEK: Mutex<Option<[u8; 32]>> = Mutex::new(None);

fn master_key_path() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join(MASTER_KEY_FILE))
}

fn master_key_enc_path() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join(MASTER_KEY_ENC_FILE))
}

fn app_data_dir() -> Result<PathBuf, AppError> {
    dirs::data_local_dir()
        .map(|d| d.join("com.beavernotes.beaver-notes"))
        .ok_or_else(|| AppError::Other("Cannot determine data directory".into()))
}

/// Read the master key, coalescing concurrent cold reads. Returns the key or
/// `DevicePasswordRequired` when the only copy is the encrypted file and the
/// device password has not been supplied yet.
pub(crate) fn read_master_key() -> Result<Vec<u8>, AppError> {
    let mut state = MASTER_KEY_STATE
        .lock()
        .map_err(|_| AppError::Other("Master key lock poisoned".into()))?;
    loop {
        match &*state {
            MasterKeyState::Ready(key) => return Ok(key.clone()),
            MasterKeyState::Pending => break,
            MasterKeyState::Loading => {
                state = MASTER_KEY_CONDVAR
                    .wait(state)
                    .map_err(|_| AppError::Other("Master key lock poisoned".into()))?;
            }
        }
    }
    *state = MasterKeyState::Loading;
    drop(state);

    let result = read_master_key_from_store();

    let mut state = MASTER_KEY_STATE
        .lock()
        .map_err(|_| AppError::Other("Master key lock poisoned".into()))?;
    match &result {
        Ok(key) => *state = MasterKeyState::Ready(key.clone()),
        Err(_) => *state = MasterKeyState::Pending,
    }
    MASTER_KEY_CONDVAR.notify_all();
    result
}

fn read_master_key_from_store() -> Result<Vec<u8>, AppError> {
    // 1. Legacy migration: a plaintext `master.key` from before this change is
    //    authoritative until it is folded into the secure chain and deleted.
    if let Some(key) = migrate_legacy_master_key()? {
        return Ok(key);
    }
    let mut last_error: Option<AppError> = None;
    for backend in platform_backends() {
        match backend.get() {
            Ok(Some(key)) => return Ok(key),
            Ok(None) => {}
            Err(e) => last_error = Some(e),
        }
    }

    // 3. Nothing readable: if the encrypted file is the only durable store and
    //    the device password is required, surface that instead of minting a new
    //    key (which would strand existing blobs).
    if let Some(e) = last_error {
        if matches!(e, AppError::DevicePasswordRequired) {
            return Err(e);
        }
    }

    // 4. First run / all stores empty: mint a fresh key and mirror it to every
    //    writable backend.
    let key = random_key();
    for backend in platform_backends() {
        let _ = backend.set(&key);
    }
    Ok(key.to_vec())
}

/// Return the current backend kind for the UI. Cheap: probes in-memory flags,
/// never blocks on a daemon.
pub(crate) fn master_key_backend() -> MasterKeyBackendKind {
    for backend in platform_backends() {
        if backend.is_alive() {
            return backend.kind();
        }
    }
    MasterKeyBackendKind::None
}

/// Honest availability probe used by `safeStorage:isEncryptionAvailable`. True
/// when at least one non-plaintext backend can read or write today. Unlike the
/// old `read_master_key().map(|_| true)`, this returns false on daemon-less
/// Linux before a device password exists, so the frontend does not persist
/// blobs it could never read back.
pub(crate) fn master_key_available() -> bool {
    platform_backends().iter().any(|b| b.is_alive())
}

/// Fold a legacy plaintext `master.key` into the secure chain and delete the
/// file. Returns the key if one was migrated. Idempotent; `Ok(None)` when no
/// legacy file exists.
pub(crate) fn migrate_legacy_master_key() -> Result<Option<Vec<u8>>, AppError> {
    let path = master_key_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)?;
    let key_bytes = BASE64.decode(raw.trim().as_bytes())?;
    if key_bytes.len() != 32 {
        return Err(AppError::Crypto("Invalid file-based master key length".into()));
    }
    let key: [u8; 32] = key_bytes.as_slice().try_into().map_err(|_| {
        AppError::Crypto("Invalid file-based master key length".into())
    })?;
    for backend in platform_backends() {
        let _ = backend.set(&key);
    }
    fs::remove_file(&path)?;
    Ok(Some(key_bytes))
}

/// Accept the Linux device password, derive its KEK (Argon2id), validate it
/// against `master.key.enc` if present, cache the KEK, and re-anchor the
/// current master key into the encrypted file.
pub(crate) fn set_device_password(password: &str) -> Result<(), AppError> {
    let kek = derive_device_kek(password)?;
    {
        let mut guard = DEVICE_KEK
            .lock()
            .map_err(|_| AppError::Other("Device KEK lock poisoned".into()))?;
        *guard = Some(kek);
    }
    let enc_path = master_key_enc_path()?;
    if enc_path.exists() {
        // Validate: a wrong password must fail without clobbering the file.
        let key = safe_storage_read_enc_file()?;
        write_enc_file(&key)?;
    } else {
        let key = read_master_key()?;
        write_enc_file(&key)?;
    }
    Ok(())
}

fn derive_device_kek(password: &str) -> Result<[u8; 32], AppError> {
    // Reuse the manifest KDF so the on-disk file stays decryptable after a KDF
    // constant bump.
    derive_kek_argon2id_with_params(
        password,
        b"beaver-notes-device-password", // fixed salt is fine here: the KEK only protects a file whose contents are random
        32 * 1024,
        2,
        2,
    )
}

fn safe_storage_read_enc_file() -> Result<Vec<u8>, AppError> {
    let enc_path = master_key_enc_path()?;
    if !enc_path.exists() {
        return Ok(Vec::new());
    }
    let kek_opt = DEVICE_KEK
        .lock()
        .map_err(|_| AppError::Other("Device KEK lock poisoned".into()))?;
    let kek = kek_opt.ok_or(AppError::DevicePasswordRequired)?;
    let raw = fs::read_to_string(&enc_path)?;
    let env: WrappedKeyEnvelope = serde_json::from_str(&raw)?;
    decrypt_bytes_with_key(&kek, &env)
}

fn write_enc_file(key: &[u8]) -> Result<(), AppError> {
    let kek_opt = DEVICE_KEK
        .lock()
        .map_err(|_| AppError::Other("Device KEK lock poisoned".into()))?;
    let kek = kek_opt.ok_or(AppError::DevicePasswordRequired)?;
    let mut key_arr = [0_u8; 32];
    key_arr.copy_from_slice(&key[..32]);
    let env = encrypt_bytes_with_key(&kek, &key_arr)?;
    let enc_path = master_key_enc_path()?;
    if let Some(parent) = enc_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&enc_path, serde_json::to_string(&env)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&enc_path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn platform_backends() -> Vec<Box<dyn MasterKeyBackend>> {
    #[cfg(target_os = "linux")]
    {
        vec![
            Box::new(KeyringBackend {
                kind: MasterKeyBackendKind::SecretService,
                service: SAFE_STORAGE_SERVICE,
                account: SAFE_STORAGE_MASTER_ACCOUNT,
                store: KeyringStore::SecretService,
            }),
            Box::new(KeyringBackend {
                kind: MasterKeyBackendKind::KernelKeyring,
                service: SAFE_STORAGE_SERVICE,
                account: SAFE_STORAGE_MASTER_ACCOUNT,
                store: KeyringStore::Keyutils,
            }),
            Box::new(EncryptedFileBackend),
        ]
    }
    #[cfg(not(target_os = "linux"))]
    {
        vec![Box::new(KeyringBackend {
            kind: if cfg!(target_os = "android") {
                MasterKeyBackendKind::AndroidKeystore
            } else {
                MasterKeyBackendKind::Keychain
            },
            service: SAFE_STORAGE_SERVICE,
            account: SAFE_STORAGE_MASTER_ACCOUNT,
            store: KeyringStore::Default,
        })]
    }
}

trait MasterKeyBackend {
    fn kind(&self) -> MasterKeyBackendKind;
    fn get(&self) -> Result<Option<Vec<u8>>, AppError>;
    fn set(&self, key: &[u8]) -> Result<(), AppError>;
    fn is_alive(&self) -> bool;
}

#[derive(Clone, Copy)]
enum KeyringStore {
    Default,
    SecretService,
    #[cfg(target_os = "linux")]
    Keyutils,
}

struct KeyringBackend {
    kind: MasterKeyBackendKind,
    service: &'static str,
    account: &'static str,
    store: KeyringStore,
}

impl KeyringBackend {
    fn entry(&self) -> Result<keyring::Entry, AppError> {
        match self.store {
            KeyringStore::Default | KeyringStore::SecretService => {
                keyring::Entry::new(self.service, self.account)
                    .map_err(|e| AppError::Other(format!("keyring init: {e}")))
            }
            #[cfg(target_os = "linux")]
            KeyringStore::Keyutils => {
                let builder = keyring::keyutils::default_credential_builder();
                let credential = builder
                    .build(None, self.service, self.account)
                    .map_err(|e| AppError::Other(format!("keyutils init: {e}")))?;
                Ok(keyring::Entry::new_with_credential(credential))
            }
        }
    }
}

impl MasterKeyBackend for KeyringBackend {
    fn kind(&self) -> MasterKeyBackendKind {
        self.kind
    }

    fn get(&self) -> Result<Option<Vec<u8>>, AppError> {
        let entry = self.entry()?;
        match entry.get_password() {
            Ok(stored) => {
                let key = BASE64.decode(stored.as_bytes())?;
                if key.len() != 32 {
                    return Err(AppError::Crypto("Invalid stored master key length".into()));
                }
                Ok(Some(key))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Other(format!("keyring read: {e}"))),
        }
    }

    fn set(&self, key: &[u8]) -> Result<(), AppError> {
        let entry = self.entry()?;
        entry
            .set_password(&BASE64.encode(key))
            .map_err(|e| AppError::Other(format!("keyring write: {e}")))?;
        Ok(())
    }

    fn is_alive(&self) -> bool {
        // A daemon-backed store is alive if constructing an entry succeeds; the
        // concrete read may still fail transiently, which the caller tolerates.
        self.entry().is_ok()
    }
}

struct EncryptedFileBackend;

impl MasterKeyBackend for EncryptedFileBackend {
    fn kind(&self) -> MasterKeyBackendKind {
        MasterKeyBackendKind::EncryptedFile
    }

    fn get(&self) -> Result<Option<Vec<u8>>, AppError> {
        let enc_path = master_key_enc_path()?;
        if !enc_path.exists() {
            return Ok(None);
        }
        let kek_opt = DEVICE_KEK
            .lock()
            .map_err(|_| AppError::Other("Device KEK lock poisoned".into()))?;
        let kek = kek_opt.ok_or(AppError::DevicePasswordRequired)?;
        let raw = fs::read_to_string(&enc_path)?;
        let env: WrappedKeyEnvelope = serde_json::from_str(&raw)?;
        decrypt_bytes_with_key(&kek, &env).map(Some)
    }

    fn set(&self, key: &[u8]) -> Result<(), AppError> {
        write_enc_file(key)
    }

    fn is_alive(&self) -> bool {
        DEVICE_KEK.lock().map(|k| k.is_some()).unwrap_or(false)
    }
}

pub(crate) fn safe_storage_encrypt_bytes(bytes: &[u8]) -> Result<String, AppError> {
    let key = read_master_key()?;
    let key_arr: [u8; 32] = key.as_slice().try_into().map_err(|_| {
        AppError::Crypto("Invalid master key length".into())
    })?;
    let cipher = aes_gcm::Aes256Gcm::new_from_slice(&key_arr)
        .map_err(|_| AppError::Crypto("Invalid master key length".into()))?;
    let iv = random_nonce();
    let encrypted = cipher
        .encrypt(
            aes_gcm::Nonce::from_slice(&iv),
            bytes,
        )
        .map_err(AppError::from)?;
    let mut payload = iv.to_vec();
    payload.extend_from_slice(&encrypted);
    Ok(BASE64.encode(payload))
}

pub(crate) fn safe_storage_decrypt_bytes(value: &str) -> Result<Vec<u8>, AppError> {
    let key = read_master_key()?;
    let key_arr: [u8; 32] = key.as_slice().try_into().map_err(|_| {
        AppError::Crypto("Invalid master key length".into())
    })?;
    let cipher = aes_gcm::Aes256Gcm::new_from_slice(&key_arr)
        .map_err(|_| AppError::Crypto("Invalid master key length".into()))?;
    let payload = BASE64.decode(value.as_bytes())?;
    if payload.len() < 13 {
        return Err(AppError::Crypto("Invalid encrypted payload".into()));
    }
    let (iv, ciphertext) = payload.split_at(12);
    let mut iv_arr = [0_u8; 12];
    iv_arr.copy_from_slice(iv);
    cipher
        .decrypt(aes_gcm::Nonce::from_slice(&iv_arr), ciphertext)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enc_file_round_trip_with_correct_and_wrong_kek() {
        let kek = [7_u8; 32];
        let key = random_key();
        let env = encrypt_bytes_with_key(&kek, &key).unwrap();
        let dec = decrypt_bytes_with_key(&kek, &env).unwrap();
        assert_eq!(dec, key.to_vec());
        let wrong = decrypt_bytes_with_key(&[8_u8; 32], &env);
        assert!(matches!(wrong, Err(AppError::WrongPassword)));
    }

    #[test]
    fn master_key_backend_kind_serializes_camel_case() {
        let v = serde_json::to_value(MasterKeyBackendKind::SecretService).unwrap();
        assert_eq!(v, serde_json::json!("secretService"));
    }
}
