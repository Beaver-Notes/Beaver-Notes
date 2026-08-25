use std::{
    fs,
    path::PathBuf,
    sync::{Condvar, Mutex},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

use super::super::AppError;
#[cfg(not(target_os = "android"))]
use super::super::SAFE_STORAGE_SERVICE;
use super::keys::{
    decrypt_bytes_with_key, derive_kek_argon2id_with_params, encrypt_bytes_with_key, random_key,
    random_nonce, WrappedKeyEnvelope,
};

#[cfg(target_os = "linux")]
use keyring::credential::CredentialBuilderApi;
use aes_gcm::aead::{Aead, KeyInit};

pub(crate) const SAFE_STORAGE_MASTER_ACCOUNT: &str = "__safe_storage_master_key__";

pub(crate) const MASTER_KEY_FILE: &str = "master.key";
pub(crate) const MASTER_KEY_ENC_FILE: &str = "master.key.enc";

/// Android-only Keystore-wrapped master-key blob: readable without the
/// Keystore key but useless without it.
#[cfg(target_os = "android")]
const MASTER_KEY_WRAPPED_FILE: &str = "master.key.wrapped";

/// Which secure backend currently protects the master key: OS keychain on
/// macOS/Windows/iOS, Secret Service / kernel keyring on Linux, Android
/// Keystore on Android. `EncryptedFile` is the Linux device-password fallback.
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

/// Per-launch cache of the device-password KEK unlocking `master.key.enc`;
/// never persisted. `None` = no device password supplied this session.
static DEVICE_KEK: Mutex<Option<[u8; 32]>> = Mutex::new(None);

fn master_key_path() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join(MASTER_KEY_FILE))
}

fn master_key_enc_path() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join(MASTER_KEY_ENC_FILE))
}

fn app_data_dir() -> Result<PathBuf, AppError> {
    // On Android `dirs::data_local_dir()` resolves to `None` (no `$HOME`), so
    // the legacy migration and enc-file paths would fail before ever reaching
    // the Keystore backend. Use the tauri path resolver instead, matching
    // `master_key_wrapped_path`.
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let app = android_app_handle()?;
        app.path()
            .app_data_dir()
            .map_err(|e| AppError::Other(format!("cannot resolve app data dir: {e}")))
    }
    #[cfg(not(target_os = "android"))]
    {
        dirs::data_local_dir()
            .map(|d| d.join("com.beavernotes.beaver-notes"))
            .ok_or_else(|| AppError::Other("Cannot determine data directory".into()))
    }
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
    // Legacy plaintext `master.key` is authoritative until folded into the
    // secure chain and deleted.
    if let Some(key) = migrate_legacy_master_key()? {
        return Ok(key);
    }
    select_key_from_backends(
        &platform_backends(),
        random_key,
        durable_store_available(),
    )
}

/// First backend holding a key wins; it is re-anchored into higher-priority
/// live-but-empty backends. A hard backend error propagates (never mint over a
/// possibly-live key — that would strand existing blobs), with `WrongPassword`
/// folded into `DevicePasswordRequired`. Minting happens ONLY when every
/// backend returned `Ok(None)` and a durable backend is alive AND accepts the
/// write — minting into the reboot-ephemeral kernel keyring alone would strand
/// blobs. Pure; testable with fake backends.
fn select_key_from_backends(
    backends: &[Box<dyn MasterKeyBackend>],
    mint: impl Fn() -> [u8; 32],
    durable_alive: bool,
) -> Result<Vec<u8>, AppError> {
    let mut last_error: Option<AppError> = None;
    let mut empty_alive: Vec<usize> = Vec::new();
    for (i, backend) in backends.iter().enumerate() {
        match backend.get() {
            Ok(Some(key)) => {
                for &j in &empty_alive {
                    let _ = backends[j].set(&key);
                }
                return Ok(key);
            }
            Ok(None) => empty_alive.push(i),
            Err(e) => last_error = Some(e),
        }
    }
    if let Some(e) = last_error {
        // Hard error: never mint over it; fold a stale-KEK WrongPassword into
        // the device-password prompt signal.
        if matches!(
            e,
            AppError::DevicePasswordRequired | AppError::WrongPassword
        ) {
            return Err(AppError::DevicePasswordRequired);
        }
        return Err(e);
    }
    if !durable_alive {
        // Refusing to mint avoids persisting blobs under a reboot-ephemeral
        // kernel-keyring key.
        return Err(AppError::SecureStorageUnavailable);
    }
    let key = mint();
    // Write durable backends FIRST; if none succeed, the key never touches the
    // reboot-ephemeral kernel keyring.
    let mut durable_written = false;
    for backend in backends {
        if is_durable_kind(backend.kind()) && backend.set(&key).is_ok() {
            durable_written = true;
        }
    }
    if !durable_written {
        // Durable writes all failed: session-scoped in-memory key. Blobs stay
        // encrypted but won't survive restart; password prompted on next launch.
        eprintln!(
            "[master_key] WARNING: no durable backend accepted the key — \
             blobs are encrypted but key is session-scoped only"
        );
        for backend in backends {
            if !is_durable_kind(backend.kind()) {
                let _ = backend.set(&key);
            }
        }
        return Ok(key.to_vec());
    }
    // Mirror to non-durable backends only after the durable anchor is in place.
    for backend in backends {
        if !is_durable_kind(backend.kind()) {
            let _ = backend.set(&key);
        }
    }
    Ok(key.to_vec())
}

/// True once the master key has been read this session. Used to short-circuit
/// availability probes that would otherwise do blocking keyring I/O on every
/// call (the frontend probes on every secure-blob write).
fn master_key_cached() -> bool {
    match MASTER_KEY_STATE.lock() {
        Ok(g) => matches!(&*g, MasterKeyState::Ready(_)),
        Err(_) => false,
    }
}

/// Current backend kind for the UI display command. Always probes live
/// backends with real I/O (no cached fast path — fine off the hot path);
/// avoids the old bug where a lazy entry constructor reported `secretService`
/// on daemon-less Linux even though the key lived in keyutils or the enc file.
pub(crate) fn master_key_backend() -> MasterKeyBackendKind {
    for backend in platform_backends() {
        if backend.is_alive() {
            return backend.kind();
        }
    }
    MasterKeyBackendKind::None
}

/// True when a key minted into `kind` survives a relaunch: the kernel keyring
/// is session-scoped (~3-day persistent expiry), every other backend durable.
fn is_durable_kind(kind: MasterKeyBackendKind) -> bool {
    matches!(
        kind,
        MasterKeyBackendKind::Keychain
            | MasterKeyBackendKind::SecretService
            | MasterKeyBackendKind::EncryptedFile
            | MasterKeyBackendKind::AndroidKeystore
    )
}

/// True when a fresh master-key mint would land somewhere that survives
/// relaunch. The kernel keyring alone does NOT count — it is `UntilReboot`.
pub(crate) fn durable_store_available() -> bool {
    platform_backends()
        .iter()
        .any(|b| is_durable_kind(b.kind()) && b.is_alive())
}

/// Availability probe for `safeStorage:isEncryptionAvailable`: true when a key
/// can be PRODUCED today (readable now, or a fresh mint lands durably). A
/// reachable-but-empty kernel keyring alone does NOT count — session-scoped,
/// so a blob persisted on that basis could become unreadable before relaunch.
/// Returns true without probing once the key is cached.
pub(crate) fn master_key_available() -> bool {
    if master_key_cached() {
        return true;
    }
    let backends = platform_backends();
    master_key_available_core(
        backends.iter().any(|b| matches!(b.get(), Ok(Some(_)))),
        backends
            .iter()
            .any(|b| is_durable_kind(b.kind()) && b.is_alive()),
    )
}

fn master_key_available_core(any_key_readable: bool, any_durable_alive: bool) -> bool {
    any_key_readable || any_durable_alive
}

/// True when the only durable master-key copy is the device-password-encrypted
/// file (`master.key.enc`) but the KEK has not been supplied this session —
/// i.e. the user must re-enter their device password to unlock secure storage.
pub(crate) fn device_password_required() -> bool {
    if master_key_cached() {
        return false;
    }
    let enc_exists = master_key_enc_path().map(|p| p.exists()).unwrap_or(false);
    let any_key_readable = platform_backends()
        .iter()
        .any(|b| matches!(b.get(), Ok(Some(_))));
    device_password_required_core(enc_exists, any_key_readable)
}

fn device_password_required_core(enc_exists: bool, any_key_readable: bool) -> bool {
    enc_exists && !any_key_readable
}

/// Fold a legacy plaintext `master.key` into the secure chain; delete the file
/// only once a DURABLE backend wrote. Idempotent; `Ok(None)` without a legacy
/// file. With no durable backend available (daemon-less Linux, no device
/// password yet) the file is KEPT so existing blobs stay readable — deleting
/// on kernel-keyring strength alone would strand blobs once it expires.
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
    let mut durable_written = false;
    for backend in platform_backends() {
        if backend.set(&key).is_ok() && is_durable_kind(backend.kind()) {
            durable_written = true;
        }
    }
    if durable_written {
        fs::remove_file(&path)?;
    }
    Ok(Some(key_bytes))
}

/// Accept the Linux device password: derive + validate its KEK against
/// `master.key.enc`, cache the KEK, re-anchor the master key into the file.
pub(crate) fn set_device_password(password: &str) -> Result<(), AppError> {
    let kek = derive_device_kek(password)?;
    let enc_path = master_key_enc_path()?;
    if enc_path.exists() {
        // Validate BEFORE caching so a wrong password can't poison the KEK cache.
        let raw = fs::read_to_string(&enc_path)?;
        let env: WrappedKeyEnvelope = serde_json::from_str(&raw)?;
        decrypt_bytes_with_key(&kek, &env).map_err(|_| AppError::WrongDevicePassword)?;
    }
    {
        let mut guard = DEVICE_KEK
            .lock()
            .map_err(|_| AppError::Other("Device KEK lock poisoned".into()))?;
        *guard = Some(kek);
    }
    if enc_path.exists() {
        let key = safe_storage_read_enc_file()?;
        write_enc_file(&key)?;
    } else {
        let key = read_master_key()?;
        write_enc_file(&key)?;
    }
    Ok(())
}

fn derive_device_kek(password: &str) -> Result<[u8; 32], AppError> {
    // Manifest KDF: keeps the on-disk file decryptable across KDF bumps.
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
    if key.len() < 32 {
        return Err(AppError::Crypto("Invalid master key length".into()));
    }
    let mut key_arr = [0_u8; 32];
    key_arr.copy_from_slice(&key[..32]);
    let env = encrypt_bytes_with_key(&kek, &key_arr)?;
    let enc_path = master_key_enc_path()?;
    atomic_write(&enc_path, serde_json::to_string(&env)?.as_bytes())?;
    Ok(())
}

/// Atomic write: temp file in the same directory (a crash mid-write can never
/// corrupt the only durable master-key copy), 0600 perms on unix, rename over
/// destination.
fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<(), AppError> {
    let dir = path
        .parent()
        .ok_or_else(|| AppError::Other("No parent dir".into()))?;
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(
        ".{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("master-key")
    ));
    fs::write(&tmp, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

fn platform_backends() -> Vec<Box<dyn MasterKeyBackend>> {
    #[cfg(target_os = "android")]
    {
        vec![Box::new(AndroidKeystoreBackend)]
    }
    #[cfg(all(not(target_os = "android"), target_os = "linux"))]
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
    #[cfg(all(not(target_os = "android"), not(target_os = "linux")))]
    {
        vec![Box::new(KeyringBackend {
            kind: MasterKeyBackendKind::Keychain,
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
            // `NoEntry` = store reachable but no entry; `NoStorageAccess` =
            // daemon present but locked/unpromptable. Both mean "no key
            // readable today".
            Err(keyring::Error::NoEntry) | Err(keyring::Error::NoStorageAccess(_)) => Ok(None),
            // A dead Secret Service daemon surfaces as `PlatformFailure`
            // (zbus connect error). On Linux this is the NORMAL daemon-less
            // state, so the SecretService backend reports an empty store and
            // the keyutils / enc-file backends take over. On macOS/Windows/iOS
            // a `PlatformFailure` means a reachable-but-broken keychain and
            // must remain a hard error (never mint over it).
            Err(keyring::Error::PlatformFailure(_)) if cfg!(target_os = "linux") => Ok(None),
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
        // Real read probe required: on daemon-less Linux constructing the entry
        // does no I/O and would falsely report SecretService as available.
        let entry = match self.entry() {
            Ok(e) => e,
            Err(_) => return false,
        };
        match entry.get_password() {
            Ok(_) => true,
            // No entry yet: verify write capability, else availability reports
            // true but set() later fails (locked keyring, D-Bus write denied)
            // and encryptString throws.
            Err(keyring::Error::NoEntry) => {
                match entry.set_password("__probe__") {
                    Ok(()) => {
                        let _ = entry.delete_password();
                        true
                    }
                    Err(_) => false,
                }
            }
            Err(_) => false,
        }
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

/// AppHandle captured at setup so the no-arg master-key backend can reach the
/// plugin-managed `SecureKeystore` state (`AppHandle::current()` is unavailable
/// in the pinned tauri 2.10). Android only; cfg'd out elsewhere.
#[cfg(target_os = "android")]
static ANDROID_APP: Mutex<Option<tauri::AppHandle>> = Mutex::new(None);

#[cfg(target_os = "android")]
pub(crate) fn set_android_app_handle(app: tauri::AppHandle) {
    if let Ok(mut guard) = ANDROID_APP.lock() {
        *guard = Some(app);
    }
}

#[cfg(target_os = "android")]
fn android_app_handle() -> Result<tauri::AppHandle, AppError> {
    ANDROID_APP
        .lock()
        .map_err(|_| AppError::Other("Android Keystore lock poisoned".into()))?
        .clone()
        .ok_or_else(|| AppError::Other("Android Keystore not initialized".into()))
}

/// Hardware-backed Android Keystore backend via vendored
/// `tauri-plugin-secure-keystore`: wraps the 32-byte master key with a Keystore
/// AES-GCM key (raw key never leaves the device) and persists the portable
/// blob next to the other master-key files. `get` reads and unwraps it.
#[cfg(target_os = "android")]
struct AndroidKeystoreBackend;

#[cfg(target_os = "android")]
impl MasterKeyBackend for AndroidKeystoreBackend {
    fn kind(&self) -> MasterKeyBackendKind {
        MasterKeyBackendKind::AndroidKeystore
    }

    fn get(&self) -> Result<Option<Vec<u8>>, AppError> {
        use tauri_plugin_secure_keystore::SecureKeystoreExt;
        let app = android_app_handle()?;
        let blob_path = master_key_wrapped_path(&app)?;
        if !blob_path.exists() {
            return Ok(None);
        }
        let blob = fs::read_to_string(blob_path)?;
        let data = app
            .secure_keystore()
            .unwrap(blob)
            .map_err(|e| AppError::Other(format!("keystore: {e}")))?;
        let raw = BASE64.decode(data.as_bytes())?;
        Ok(Some(raw))
    }

    fn set(&self, key: &[u8]) -> Result<(), AppError> {
        use tauri_plugin_secure_keystore::SecureKeystoreExt;
        let app = android_app_handle()?;
        let blob = app
            .secure_keystore()
            .wrap(BASE64.encode(key))
            .map_err(|e| AppError::Other(format!("keystore: {e}")))?;
        let blob_path = master_key_wrapped_path(&app)?;
        atomic_write(&blob_path, blob.as_bytes())?;
        Ok(())
    }

    fn is_alive(&self) -> bool {
        // Hardware/TEE-backed: always alive on Android (read tolerates absence).
        true
    }
}

/// Blob path for `wrap`; tauri resolver because `data_local_dir` resolves to
/// `None` on Android (no `$HOME`).
#[cfg(target_os = "android")]
fn master_key_wrapped_path(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(MASTER_KEY_WRAPPED_FILE))
        .map_err(|e| AppError::Other(format!("Cannot resolve app data dir: {e}")))
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
    use std::{cell::RefCell, rc::Rc};

    struct FakeBackend {
        kind: MasterKeyBackendKind,
        stored: Option<Vec<u8>>,
        fail: bool,
    }

    impl MasterKeyBackend for FakeBackend {
        fn kind(&self) -> MasterKeyBackendKind {
            self.kind
        }
        fn get(&self) -> Result<Option<Vec<u8>>, AppError> {
            if self.fail {
                return Err(AppError::Other("dead".into()));
            }
            Ok(self.stored.clone())
        }
        fn set(&self, _key: &[u8]) -> Result<(), AppError> {
            Err(AppError::Other("write disabled in test".into()))
        }
        fn is_alive(&self) -> bool {
            !self.fail
        }
    }

    /// Like `FakeBackend` but records every key passed to `set`.
    struct RecordingBackend {
        kind: MasterKeyBackendKind,
        stored: Option<Vec<u8>>,
        written: Rc<RefCell<Vec<Vec<u8>>>>,
    }

    impl RecordingBackend {
        fn new(
            kind: MasterKeyBackendKind,
            stored: Option<Vec<u8>>,
            written: Rc<RefCell<Vec<Vec<u8>>>>,
        ) -> Self {
            Self {
                kind,
                stored,
                written,
            }
        }
    }

    impl MasterKeyBackend for RecordingBackend {
        fn kind(&self) -> MasterKeyBackendKind {
            self.kind
        }
        fn get(&self) -> Result<Option<Vec<u8>>, AppError> {
            Ok(self.stored.clone())
        }
        fn set(&self, key: &[u8]) -> Result<(), AppError> {
            self.written.borrow_mut().push(key.to_vec());
            Ok(())
        }
        fn is_alive(&self) -> bool {
            true
        }
    }

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
        let v = serde_json::to_value(MasterKeyBackendKind::AndroidKeystore).unwrap();
        assert_eq!(v, serde_json::json!("androidKeystore"));
    }

    #[test]
    fn select_returns_first_backend_with_key() {
        let backends: Vec<Box<dyn MasterKeyBackend>> = vec![
            Box::new(FakeBackend {
                kind: MasterKeyBackendKind::SecretService,
                stored: None,
                fail: false,
            }),
            Box::new(FakeBackend {
                kind: MasterKeyBackendKind::KernelKeyring,
                stored: Some(vec![1_u8; 32]),
                fail: false,
            }),
        ];
        let key = select_key_from_backends(&backends, random_key, false).unwrap();
        assert_eq!(key, vec![1_u8; 32]);
    }

    #[test]
    fn select_mints_and_mirrors_when_all_empty() {
        let log0 = Rc::new(RefCell::new(Vec::new()));
        let log1 = Rc::new(RefCell::new(Vec::new()));
        let backends: Vec<Box<dyn MasterKeyBackend>> = vec![
            Box::new(RecordingBackend::new(
                MasterKeyBackendKind::SecretService,
                None,
                Rc::clone(&log0),
            )),
            Box::new(RecordingBackend::new(
                MasterKeyBackendKind::KernelKeyring,
                None,
                Rc::clone(&log1),
            )),
        ];
        let key = select_key_from_backends(&backends, random_key, true).unwrap();
        assert_eq!(key.len(), 32);
        let written0 = log0.borrow();
        assert_eq!(written0.len(), 1, "every backend must receive the minted key");
        assert_eq!(written0[0], key);
        let written1 = log1.borrow();
        assert_eq!(written1.len(), 1, "every backend must receive the minted key");
        assert_eq!(written1[0], key);
    }

    #[test]
    fn select_refuses_to_mint_without_durable_store() {
        let log0 = Rc::new(RefCell::new(Vec::new()));
        let log1 = Rc::new(RefCell::new(Vec::new()));
        let backends: Vec<Box<dyn MasterKeyBackend>> = vec![
            Box::new(RecordingBackend::new(
                MasterKeyBackendKind::KernelKeyring,
                None,
                Rc::clone(&log0),
            )),
            Box::new(RecordingBackend::new(
                MasterKeyBackendKind::KernelKeyring,
                None,
                Rc::clone(&log1),
            )),
        ];
        let err = select_key_from_backends(&backends, || {
            panic!("mint must not run when no durable store is alive");
        }, false)
        .unwrap_err();
        assert!(matches!(err, AppError::SecureStorageUnavailable));
        assert!(
            log0.borrow().is_empty() && log1.borrow().is_empty(),
            "no backend may receive a write when minting is refused"
        );
    }

    #[test]
    fn select_mints_with_durable_store_alive() {
        let log0 = Rc::new(RefCell::new(Vec::new()));
        let log1 = Rc::new(RefCell::new(Vec::new()));
        let backends: Vec<Box<dyn MasterKeyBackend>> = vec![
            Box::new(RecordingBackend::new(
                MasterKeyBackendKind::EncryptedFile,
                None,
                Rc::clone(&log0),
            )),
            Box::new(RecordingBackend::new(
                MasterKeyBackendKind::KernelKeyring,
                None,
                Rc::clone(&log1),
            )),
        ];
        let key = select_key_from_backends(&backends, random_key, true).unwrap();
        assert_eq!(key.len(), 32);
        assert_eq!(log0.borrow().len(), 1, "durable backend must receive the minted key");
        assert_eq!(log1.borrow().len(), 1, "non-durable backend must also receive the minted key");
    }

    #[test]
    fn select_returns_ephemeral_key_when_no_durable_write_succeeds() {
        // Durable backends probe alive but all writes fail (daemon crashed
        // between probe and write, read-only store, ...): key returned
        // session-scoped — encrypted blobs, gone after restart.
        let backends: Vec<Box<dyn MasterKeyBackend>> = vec![
            Box::new(FakeBackend {
                kind: MasterKeyBackendKind::SecretService,
                stored: None,
                fail: false,
            }),
            Box::new(FakeBackend {
                kind: MasterKeyBackendKind::EncryptedFile,
                stored: None,
                fail: false,
            }),
            Box::new(FakeBackend {
                kind: MasterKeyBackendKind::KernelKeyring,
                stored: None,
                fail: false,
            }),
        ];
        let key = select_key_from_backends(&backends, random_key, true).unwrap();
        assert_eq!(key.len(), 32, "must return a valid 32-byte key");
    }

    #[test]
    fn select_returns_ephemeral_key_when_only_keyutils_write_succeeds() {
        // Durable sets fail right after probing; only the KernelKeyring backend
        // accepts the write. Key still returned session-scoped; the keyutils
        // mirror runs so this session has a working key.
        let keyutils = Rc::new(RefCell::new(Vec::new()));
        let backends: Vec<Box<dyn MasterKeyBackend>> = vec![
            Box::new(FakeBackend {
                kind: MasterKeyBackendKind::SecretService,
                stored: None,
                fail: false,
            }),
            Box::new(RecordingBackend::new(
                MasterKeyBackendKind::KernelKeyring,
                None,
                Rc::clone(&keyutils),
            )),
            Box::new(FakeBackend {
                kind: MasterKeyBackendKind::EncryptedFile,
                stored: None,
                fail: false,
            }),
        ];
        let key = select_key_from_backends(&backends, random_key, true).unwrap();
        assert_eq!(key.len(), 32, "must return a valid 32-byte key");
        assert!(
            !keyutils.borrow().is_empty(),
            "the keyutils mirror must run so the session has a working key"
        );
    }

    #[test]
    fn select_does_not_mint_when_backend_errors_hardly() {
        struct HardErrBackend;
        impl MasterKeyBackend for HardErrBackend {
            fn kind(&self) -> MasterKeyBackendKind {
                MasterKeyBackendKind::SecretService
            }
            fn get(&self) -> Result<Option<Vec<u8>>, AppError> {
                Err(AppError::Other("boom".into()))
            }
            fn set(&self, _key: &[u8]) -> Result<(), AppError> {
                Ok(())
            }
            fn is_alive(&self) -> bool {
                true
            }
        }
        let log = Rc::new(RefCell::new(Vec::new()));
        let backends: Vec<Box<dyn MasterKeyBackend>> = vec![
            Box::new(HardErrBackend),
            Box::new(RecordingBackend::new(
                MasterKeyBackendKind::KernelKeyring,
                None,
                Rc::clone(&log),
            )),
        ];
        let err = select_key_from_backends(&backends, || {
            panic!("mint must not run when a backend errors hard");
        }, false)
        .unwrap_err();
        assert!(matches!(err, AppError::Other(ref m) if m == "boom"));
        assert!(
            log.borrow().is_empty(),
            "no mirror-write may happen when minting is skipped"
        );
    }

    #[test]
    fn select_reattaches_key_to_higher_priority_backend() {
        let log0 = Rc::new(RefCell::new(Vec::new()));
        let log1 = Rc::new(RefCell::new(Vec::new()));
        let backends: Vec<Box<dyn MasterKeyBackend>> = vec![
            Box::new(RecordingBackend::new(
                MasterKeyBackendKind::SecretService,
                None,
                Rc::clone(&log0),
            )),
            Box::new(RecordingBackend::new(
                MasterKeyBackendKind::KernelKeyring,
                Some(vec![9_u8; 32]),
                Rc::clone(&log1),
            )),
        ];
        let key = select_key_from_backends(&backends, random_key, true).unwrap();
        assert_eq!(key, vec![9_u8; 32]);
        let written0 = log0.borrow();
        assert_eq!(written0.len(), 1, "the key must be re-anchored into the higher-priority empty backend");
        assert_eq!(written0[0], vec![9_u8; 32]);
        assert!(log1.borrow().is_empty(), "the source backend must not be rewritten");
    }

    #[test]
    fn select_propagates_device_password_required() {
        struct NeedsPw(FakeBackend);
        impl MasterKeyBackend for NeedsPw {
            fn kind(&self) -> MasterKeyBackendKind {
                self.0.kind
            }
            fn get(&self) -> Result<Option<Vec<u8>>, AppError> {
                Err(AppError::DevicePasswordRequired)
            }
            fn set(&self, _k: &[u8]) -> Result<(), AppError> {
                Ok(())
            }
            fn is_alive(&self) -> bool {
                false
            }
        }
        let backends: Vec<Box<dyn MasterKeyBackend>> = vec![Box::new(NeedsPw(FakeBackend {
            kind: MasterKeyBackendKind::EncryptedFile,
            stored: None,
            fail: false,
        }))];
        let err = select_key_from_backends(&backends, random_key, false).unwrap_err();
        assert!(matches!(err, AppError::DevicePasswordRequired));
    }

    #[test]
    fn is_durable_kind_excludes_kernel_keyring() {
        for kind in [
            MasterKeyBackendKind::Keychain,
            MasterKeyBackendKind::SecretService,
            MasterKeyBackendKind::EncryptedFile,
            MasterKeyBackendKind::AndroidKeystore,
        ] {
            assert!(is_durable_kind(kind), "{kind:?} must be durable");
        }
        assert!(
            !is_durable_kind(MasterKeyBackendKind::KernelKeyring),
            "the kernel keyring is session-scoped and must not count as durable"
        );
        assert!(!is_durable_kind(MasterKeyBackendKind::None));
    }

    #[test]
    fn availability_core_semantics() {
        // Reachable-but-empty kernel keyring alone must NOT count as available.
        assert!(!master_key_available_core(false, false));
        assert!(master_key_available_core(true, false));
        assert!(master_key_available_core(false, true));
        assert!(master_key_available_core(true, true));
    }

    #[test]
    fn device_password_required_core_semantics() {
        // Password-gated lockout: enc file present, nothing readable.
        assert!(device_password_required_core(true, false));
        // Fresh install: no enc file yet.
        assert!(!device_password_required_core(false, false));
        // A readable key (e.g. keyring reachable) means no re-entry required.
        assert!(!device_password_required_core(true, true));
        assert!(!device_password_required_core(false, true));
    }
}
