use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, SystemTime},
};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2, Params, Version,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use http::{
    header::{ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_TYPE},
    Response, StatusCode,
};
use keyring::Entry;
use lru::LruCache;
use hmac::Hmac;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::FilePath;
use tauri_plugin_updater::Update;

use crate::db::DbPool;
use crate::secure_blob::SecureBlobCache;

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";
pub(crate) const SETTINGS_STORE: &str = "settings.json";
pub(crate) const DATA_STORE: &str = "data.json";
pub(crate) const AUTH_STORE: &str = "auth.json";
pub(crate) const SAFE_STORAGE_SERVICE: &str = "com.beaver-notes.beaver-notes";
pub(crate) const SAFE_STORAGE_MASTER_ACCOUNT: &str = "__safe_storage_master_key__";
pub(crate) const ALLOWED_BLOB_KEYS: &[&str] = &["syncPassphraseBlob", "appPassphraseBlob"];
pub(crate) const WARN_THRESHOLD: u32 = 5;
pub(crate) const ASSET_MAGIC: &[u8; 4] = b"BNA2";
pub(crate) const ASSET_MAGIC_V3: &[u8; 4] = b"BNA3";
pub(crate) const PBKDF2_ITERATIONS: u32 = 100_000;
pub(crate) const ARGON2_MEMORY_KIB: u32 = 16 * 1024;
pub(crate) const ARGON2_ITERATIONS: u32 = 2;
pub(crate) const ARGON2_PARALLELISM: u32 = 2;
pub(crate) const ASSET_CACHE_TTL: Duration = Duration::from_secs(60 * 60);
pub(crate) const ASSET_CACHE_MAX_FILES: usize = 75;
pub(crate) const ENCRYPTION_MANIFEST_VERSION: u8 = 3;
pub(crate) const APP_PASSWORD_CHECK: &str = "BeaverNotes-app-manifest-v3";
pub(crate) const SYNC_PASSWORD_CHECK: &str = "BeaverNotes-sync-manifest-v3";
pub(crate) const APP_ENCRYPTION_SCOPE: &str = "app";
pub(crate) const SYNC_ENCRYPTION_SCOPE: &str = "sync";
pub(crate) const STREAM_CHUNK_SIZE: usize = 256 * 1024;

pub(crate) const NOTE_CACHE_BYTES: usize = 64 * 1024 * 1024;
pub(crate) const ASSET_CACHE_BYTES: usize = 128 * 1024 * 1024;

pub(crate) struct ByteLruCache {
    inner: LruCache<String, Vec<u8>>,
    current_bytes: usize,
    max_bytes: usize,
}

impl ByteLruCache {
    pub(crate) fn new(max_bytes: usize) -> Self {
        let max_entries = std::num::NonZero::new(1024).unwrap();
        Self {
            inner: LruCache::new(max_entries),
            current_bytes: 0,
            max_bytes,
        }
    }

    pub(crate) fn get(&mut self, key: &str) -> Option<&Vec<u8>> {
        self.inner.get(key)
    }

    pub(crate) fn put(&mut self, key: String, value: Vec<u8>) {
        let incoming_bytes = value.len();

        if let Some(old) = self.inner.get(&key) {
            self.current_bytes = self.current_bytes.saturating_sub(old.len());
        }

        while self.current_bytes + incoming_bytes > self.max_bytes && !self.inner.is_empty() {
            if let Some((_, evicted)) = self.inner.pop_lru() {
                self.current_bytes = self.current_bytes.saturating_sub(evicted.len());
            }
        }

        self.current_bytes += incoming_bytes;
        self.inner.put(key, value);
    }

    pub(crate) fn clear(&mut self) {
        self.inner.clear();
        self.current_bytes = 0;
    }
}

pub(crate) static HELP_URL: &str = "https://docs.beavernotes.com/";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppInfo {
    pub(crate) name: String,
    pub(crate) version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileStat {
    pub(crate) is_file: bool,
    pub(crate) is_directory: bool,
    pub(crate) size: u64,
    pub(crate) mtime_ms: u128,
    pub(crate) ctime_ms: u128,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FailureResult {
    pub(crate) fail_count: u32,
    pub(crate) warn: bool,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WindowStateSnapshot {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) maximized: bool,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LegacyMigrationStatus {
    pub(crate) legacy_dir: Option<String>,
    pub(crate) app_data_dir: Option<String>,
    pub(crate) has_legacy_data: bool,
    pub(crate) already_migrated: bool,
    pub(crate) target_has_data: bool,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LegacyMigrationResult {
    pub(crate) legacy_dir: Option<String>,
    pub(crate) app_data_dir: Option<String>,
    pub(crate) merged_store_files: Vec<String>,
    pub(crate) copied_asset_dirs: Vec<String>,
    pub(crate) marker_written: bool,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenDialogOptions {
    pub(crate) title: Option<String>,
    pub(crate) default_path: Option<String>,
    pub(crate) directory: Option<bool>,
    pub(crate) multiple: Option<bool>,
    pub(crate) properties: Option<Vec<String>>,
    pub(crate) filters: Option<Vec<DialogFilter>>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DialogFilter {
    pub(crate) name: String,
    pub(crate) extensions: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DialogResult {
    pub(crate) canceled: bool,
    pub(crate) file_paths: Vec<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MessageDialogOptions {
    pub(crate) title: Option<String>,
    pub(crate) message: String,
    #[serde(rename = "type")]
    pub(crate) kind: Option<String>,
    pub(crate) buttons: Option<Vec<String>>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveDialogOptions {
    pub(crate) title: Option<String>,
    pub(crate) default_path: Option<String>,
    pub(crate) filters: Option<Vec<DialogFilter>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveDialogResult {
    pub(crate) canceled: bool,
    pub(crate) file_path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BannerData {
    pub(crate) content: String,
    pub(crate) primary_text: String,
    pub(crate) secondary_text: String,
    pub(crate) version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CheckResult {
    pub(crate) success: bool,
    pub(crate) available: bool,
    pub(crate) version: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateInfo {
    pub(crate) is_checking: bool,
    pub(crate) is_downloading: bool,
    pub(crate) current_version: Option<String>,
    pub(crate) available_version: Option<String>,
    pub(crate) auto_update_enabled: bool,
    pub(crate) is_busy: bool,
}

#[derive(Default)]
pub(crate) struct UpdaterState {
    pub(crate) is_checking: bool,
    pub(crate) is_downloading: bool,
    pub(crate) auto_update_enabled: bool,
    pub(crate) current_version: Option<String>,
    pub(crate) available_version: Option<String>,
    pub(crate) pending_banner_data: Option<BannerData>,
    pub(crate) downloaded_update: Option<Update>,
    pub(crate) downloaded_bytes: Option<Vec<u8>>,
}

pub(crate) struct DbState {
    pub(crate) data: OnceLock<DbPool>,
    pub(crate) settings: OnceLock<DbPool>,
}

impl DbState {
    pub(crate) fn new() -> Self {
        Self {
            data: OnceLock::new(),
            settings: OnceLock::new(),
        }
    }
}

pub(crate) struct AppState {
    pub(crate) db: DbState,
    pub(crate) zoom_level: Mutex<f64>,
    pub(crate) failure_count: Mutex<u32>,
    pub(crate) granted_paths: Arc<Mutex<HashSet<PathBuf>>>,
    pub(crate) transient_passphrase: Mutex<String>,
    pub(crate) asset_key_cache: Mutex<Option<[u8; 32]>>,
    pub(crate) app_data_key: Mutex<Option<[u8; 32]>>,
    pub(crate) sync_data_key: Mutex<Option<[u8; 32]>>,
    pub(crate) app_encryption_active: AtomicBool,
    pub(crate) decrypted_notes_cache: Mutex<ByteLruCache>,
    pub(crate) decrypted_assets_cache: Mutex<ByteLruCache>,
    pub(crate) updater: Arc<Mutex<UpdaterState>>,
    pub(crate) pending_open_files: Arc<Mutex<Vec<String>>>,
    pub(crate) external_open_files: Arc<Mutex<HashMap<PathBuf, PathBuf>>>,
    pub(crate) asset_cache_dir: PathBuf,
    pub(crate) external_open_dir: PathBuf,
    pub(crate) portable_data_dir: Option<PathBuf>,
    pub(crate) secure_blobs: SecureBlobCache,
    pub(crate) master_key_cache: Mutex<Option<[u8; 32]>>,
}

impl AppState {
    pub(crate) fn new(
        cache_dir: PathBuf,
        external_open_dir: PathBuf,
        portable_data_dir: Option<PathBuf>,
    ) -> Self {
        Self {
            db: DbState::new(),
            zoom_level: Mutex::new(1.0),
            failure_count: Mutex::new(0),
            granted_paths: Arc::new(Mutex::new(HashSet::new())),
            transient_passphrase: Mutex::new(String::new()),
            asset_key_cache: Mutex::new(None),
            app_data_key: Mutex::new(None),
            sync_data_key: Mutex::new(None),
            app_encryption_active: AtomicBool::new(false),
            decrypted_notes_cache: Mutex::new(ByteLruCache::new(NOTE_CACHE_BYTES)),
            decrypted_assets_cache: Mutex::new(ByteLruCache::new(ASSET_CACHE_BYTES)),
            updater: Arc::new(Mutex::new(UpdaterState {
                auto_update_enabled: true,
                ..Default::default()
            })),
            pending_open_files: Arc::new(Mutex::new(Vec::new())),
            external_open_files: Arc::new(Mutex::new(HashMap::new())),
            asset_cache_dir: cache_dir,
            external_open_dir,
            portable_data_dir,
            secure_blobs: SecureBlobCache::new(),
            master_key_cache: Mutex::new(None),
        }
    }
}

pub(crate) fn app_data_dir(app: &AppHandle, state: &AppState) -> Result<PathBuf, String> {
    if let Some(ref dir) = state.portable_data_dir {
        return Ok(dir.clone());
    }
    app.path().app_data_dir().map_err(to_error)
}

pub(crate) fn to_error<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

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

fn normalize_for_compare(path: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        PathBuf::from(path.to_string_lossy().to_lowercase())
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_path_buf()
    }
}

fn normalize_path_lexical(path: &Path) -> PathBuf {
    use std::path::Component;

    let mut normalized = PathBuf::new();
    let mut root_end = 0usize;

    for component in path.components() {
        match component {
            Component::Prefix(prefix) => {
                normalized.push(prefix.as_os_str());
                root_end = normalized.components().count();
            }
            Component::RootDir => {
                normalized.push(Component::RootDir.as_os_str());
                root_end = normalized.components().count();
            }
            Component::CurDir => {}
            Component::ParentDir => {
                // Pop only normal path segments; never pop past the path root.
                let component_count = normalized.components().count();
                if component_count > root_end {
                    normalized.pop();
                }
            }
            Component::Normal(part) => normalized.push(part),
        }
    }

    normalized
}

fn is_path_inside(root: &Path, candidate: &Path) -> bool {
    // Strict mode: only absolute paths participate in access checks.
    if !root.is_absolute() || !candidate.is_absolute() {
        return false;
    }

    let root = normalize_path_lexical(&normalize_for_compare(root));
    let candidate = normalize_path_lexical(&normalize_for_compare(candidate));

    candidate == root || candidate.starts_with(&root)
}

fn is_path_allowed_strict(allowed_roots: &[PathBuf], input: &Path) -> bool {
    // First pass: lexical normalization blocks ".." traversal and related tricks
    // without relying on filesystem state.
    if !allowed_roots.iter().any(|root| is_path_inside(root, input)) {
        return false;
    }

    // Second pass: best-effort canonicalization to prevent symlink escape.
    if input.exists() {
        let Ok(real) = fs::canonicalize(input) else {
            return false;
        };

        return allowed_roots.iter().any(|root| {
            let root_real = fs::canonicalize(root).unwrap_or_else(|_| root.clone());
            is_path_inside(&root_real, &real)
        });
    }

    let Some(parent) = input.parent() else {
        return false;
    };

    if !parent.exists() {
        return true;
    }

    let Ok(real_parent) = fs::canonicalize(parent) else {
        return false;
    };
    let Some(file_name) = input.file_name() else {
        return false;
    };
    let rebuilt = real_parent.join(file_name);

    allowed_roots.iter().any(|root| {
        let root_real = fs::canonicalize(root).unwrap_or_else(|_| root.clone());
        is_path_inside(&root_real, &rebuilt)
    })
}

#[cfg(test)]
mod path_access_tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn lexical_is_path_inside_unix() {
        let root = PathBuf::from("/a/b");
        assert!(is_path_inside(&root, &PathBuf::from("/a/b/c")));
        assert!(!is_path_inside(&root, &PathBuf::from("/a/b/../c")));
        assert!(!is_path_inside(&root, &PathBuf::from("/a/b/../../etc")));
        assert!(is_path_inside(&root, &PathBuf::from("/a/b/./c")));
    }

    #[test]
    #[cfg(windows)]
    fn lexical_is_path_inside_windows() {
        let root = PathBuf::from(r"C:\a\b");
        assert!(is_path_inside(&root, &PathBuf::from(r"C:\a\b\c")));
        assert!(!is_path_inside(&root, &PathBuf::from(r"C:\a\b\..\c")));
        assert!(!is_path_inside(&root, &PathBuf::from(r"C:\a\b\..\..\etc")));
        assert!(is_path_inside(&root, &PathBuf::from(r"C:\a\b\.\c")));
    }

    #[test]
    #[cfg(unix)]
    fn canonical_blocks_symlink_escape_when_target_exists() {
        use std::os::unix::fs::symlink;

        let unique = format!(
            "beaver-notes-path-test-{}",
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );

        let base = std::env::temp_dir().join(unique);
        let allowed = base.join("allowed");
        let outside = base.join("outside");
        let link = allowed.join("link");

        fs::create_dir_all(&allowed).unwrap();
        fs::create_dir_all(&outside).unwrap();

        let ok_path = allowed.join("ok.txt");
        fs::write(&ok_path, b"ok").unwrap();

        let secret_path = outside.join("secret.txt");
        fs::write(&secret_path, b"nope").unwrap();

        symlink(&outside, &link).unwrap();

        let allowed_roots = vec![allowed.clone()];
        assert!(is_path_allowed_strict(&allowed_roots, &ok_path));

        let escaped = link.join("secret.txt");
        assert!(!is_path_allowed_strict(&allowed_roots, &escaped));

        let _ = fs::remove_dir_all(&base);
    }
}

pub(crate) fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub(crate) fn allowed_store_name(name: &str) -> Result<&'static str, String> {
    match name {
        "data" => Ok(DATA_STORE),
        "settings" => Ok(SETTINGS_STORE),
        _ => Err(format!(
            r#"[storage] blocked access to unknown store: "{name}""#
        )),
    }
}

pub(crate) fn get_or_init_pool<'a>(
    app: &AppHandle,
    state: &AppState,
    lock: &'a OnceLock<DbPool>,
    filename: &str,
) -> Result<&'a DbPool, String> {
    if let Some(pool) = lock.get() {
        return Ok(pool);
    }
    let path = app_data_dir(app, state)?.join(filename);
    let pool = crate::db::open_pool(&path)?;
    Ok(lock.get_or_init(|| pool))
}

pub(crate) fn data_pool<'a>(app: &AppHandle, state: &'a AppState) -> Result<&'a DbPool, String> {
    get_or_init_pool(app, state, &state.db.data, "data.db")
}

pub(crate) fn settings_pool<'a>(
    app: &AppHandle,
    state: &'a AppState,
) -> Result<&'a DbPool, String> {
    get_or_init_pool(app, state, &state.db.settings, "settings.db")
}

pub(crate) fn get_settings_value(app: &AppHandle, state: &AppState, key: &str) -> Option<Value> {
    let pool = settings_pool(app, state).ok()?;
    let raw = crate::db::db_get(pool, key).ok()??;
    serde_json::from_str(&raw).ok()
}

pub(crate) fn get_data_dir(app: &AppHandle, state: &AppState) -> Result<PathBuf, String> {
    if let Some(Value::String(value)) = get_settings_value(app, state, "dataDir") {
        if !value.trim().is_empty() {
            return Ok(PathBuf::from(value));
        }
    }
    app_data_dir(app, state)
}

pub(crate) fn app_encryption_dir(app: &AppHandle, state: &AppState) -> Result<PathBuf, String> {
    Ok(get_data_dir(app, state)?.join("app-crypto"))
}

pub(crate) fn app_encryption_manifest_path(
    app: &AppHandle,
    state: &AppState,
) -> Result<PathBuf, String> {
    Ok(app_encryption_dir(app, state)?.join("manifest.v2.json"))
}

pub(crate) fn sync_encryption_manifest_path(sync_path: &Path) -> PathBuf {
    sync_path
        .join("BeaverNotesSync")
        .join("crypto")
        .join("manifest.v2.json")
}

fn derive_kek(passphrase: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0_u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    key
}

pub(crate) fn derive_kek_argon2id(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let argon2 = Argon2::new(
        argon2::Algorithm::Argon2id,
        Version::V0x13,
        Params::new(
            ARGON2_MEMORY_KIB,
            ARGON2_ITERATIONS,
            ARGON2_PARALLELISM,
            Some(32),
        )
        .map_err(to_error)?,
    );
    let salt_string = SaltString::encode_b64(salt).map_err(to_error)?;
    let hash = argon2
        .hash_password(passphrase.as_bytes(), &salt_string)
        .map_err(to_error)?;
    let mut key = [0u8; 32];
    let hash_output = hash.hash.unwrap();
    let hash_bytes = hash_output.as_bytes();
    key.copy_from_slice(&hash_bytes[..32]);
    Ok(key)
}

fn derive_kek_from_manifest(
    manifest: &EncryptionManifest,
    passphrase: &str,
) -> Result<[u8; 32], String> {
    if manifest.version >= 3 {
        let salt = manifest
            .argon2_salt_hex
            .as_ref()
            .ok_or_else(|| "Argon2 salt missing in v3 manifest".to_string())?;
        let salt = hex::decode(salt.trim()).map_err(to_error)?;
        derive_kek_argon2id(passphrase, &salt)
    } else {
        let salt = hex::decode(manifest.salt_hex.trim()).map_err(to_error)?;
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
    let mut h = <Hmac<sha2::Sha384> as Mac>::new_from_slice(key)
        .expect("HMAC key length is valid");
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
) -> Result<WrappedKeyEnvelope, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = random_nonce();
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), plain)
        .map_err(to_error)?;
    Ok(WrappedKeyEnvelope {
        nonce: hex::encode(nonce),
        cipher: BASE64.encode(encrypted),
    })
}

pub(crate) fn decrypt_bytes_with_key(
    key: &[u8; 32],
    envelope: &WrappedKeyEnvelope,
) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = hex::decode(envelope.nonce.trim()).map_err(to_error)?;
    let encrypted = BASE64.decode(envelope.cipher.trim()).map_err(to_error)?;
    cipher
        .decrypt(Nonce::from_slice(&nonce), encrypted.as_slice())
        .map_err(to_error)
}

pub(crate) fn load_encryption_manifest(path: &Path) -> Result<Option<EncryptionManifest>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(to_error)?;
    let manifest = serde_json::from_str::<EncryptionManifest>(&raw).map_err(to_error)?;
    Ok(Some(manifest))
}

pub(crate) fn write_encryption_manifest(
    path: &Path,
    manifest: &EncryptionManifest,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(to_error)?;
    }
    let raw = serde_json::to_string_pretty(manifest).map_err(to_error)?;
    fs::write(path, raw).map_err(to_error)
}

pub(crate) fn create_encryption_manifest(
    scope: &str,
    password_check: &str,
    passphrase: &str,
) -> Result<(EncryptionManifest, [u8; 32]), String> {
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
) -> Result<[u8; 32], String> {
    if manifest.scope != expected_scope {
        return Err(format!("Unexpected encryption scope: {}", manifest.scope));
    }
    let kek = derive_kek_from_manifest(manifest, passphrase)?;
    let check = decrypt_bytes_with_key(&kek, &manifest.password_check)?;
    if check != password_check.as_bytes() {
        return Err("Wrong password.".to_string());
    }
    let key = decrypt_bytes_with_key(&kek, &manifest.wrapped_key)?;
    if key.len() != 32 {
        return Err("Wrapped key is corrupted.".to_string());
    }
    let mut out = [0_u8; 32];
    out.copy_from_slice(&key[..32]);
    Ok(out)
}

pub(crate) fn app_key_loaded(state: &AppState) -> Result<bool, String> {
    Ok(state.app_data_key.lock().map_err(to_error)?.is_some())
}

pub(crate) fn sync_key_loaded(state: &AppState) -> Result<bool, String> {
    Ok(state.sync_data_key.lock().map_err(to_error)?.is_some())
}

pub(crate) fn current_app_key(state: &AppState) -> Result<Option<[u8; 32]>, String> {
    Ok(*state.app_data_key.lock().map_err(to_error)?)
}

pub(crate) fn current_sync_key(state: &AppState) -> Result<Option<[u8; 32]>, String> {
    Ok(*state.sync_data_key.lock().map_err(to_error)?)
}

pub(crate) fn note_content_is_native_encrypted(value: &Value) -> bool {
    matches!(
        value,
        Value::Object(map)
            if map.get("ae").and_then(Value::as_u64) == Some(2)
                && map.get("nonce").and_then(Value::as_str).is_some()
                && map.get("cipher").and_then(Value::as_str).is_some()
    )
}

pub(crate) fn note_content_is_legacy_encrypted(value: &Value) -> bool {
    matches!(
        value,
        Value::Object(map)
            if map.get("ae").and_then(Value::as_u64) == Some(1)
                && map.get("iv").and_then(Value::as_str).is_some()
                && map.get("cipher").and_then(Value::as_str).is_some()
    )
}

pub(crate) fn note_row_needs_encryption(key: &str, value: &Value) -> bool {
    key.starts_with("notes.") && value.is_object()
}

pub(crate) fn encrypt_note_content_for_storage(
    state: &AppState,
    content: &Value,
) -> Result<Value, String> {
    if note_content_is_native_encrypted(content) || note_content_is_legacy_encrypted(content) {
        return Ok(content.clone());
    }
    let key = current_app_key(state)?.ok_or_else(|| {
        "App encryption key is locked. Unlock app encryption before writing notes.".to_string()
    })?;
    let plain = serde_json::to_vec(content).map_err(to_error)?;
    let envelope = encrypt_bytes_with_key(&key, &plain)?;
    Ok(serde_json::json!({
        "ae": 2,
        "nonce": envelope.nonce,
        "cipher": envelope.cipher,
    }))
}

pub(crate) fn decrypt_native_note_content(
    state: &AppState,
    content: &Value,
) -> Result<Option<Value>, String> {
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
            .and_then(Value::as_str)
            .ok_or_else(|| "Encrypted note nonce missing.".to_string())?
            .to_string(),
        cipher: content
            .get("cipher")
            .and_then(Value::as_str)
            .ok_or_else(|| "Encrypted note cipher missing.".to_string())?
            .to_string(),
    };
    let plain = decrypt_bytes_with_key(&key, &envelope)?;
    let value = serde_json::from_slice(&plain).map_err(to_error)?;
    Ok(Some(value))
}

pub(crate) fn app_encryption_enabled(_app: &AppHandle, state: &AppState) -> Result<bool, String> {
    Ok(state.app_encryption_active.load(Ordering::Acquire))
}

pub(crate) fn set_app_encryption_active(state: &AppState, enabled: bool) {
    state
        .app_encryption_active
        .store(enabled, Ordering::Release);
}

pub(crate) fn encrypt_note_row_for_storage(
    app: &AppHandle,
    state: &AppState,
    key: &str,
    value: Value,
) -> Result<Value, String> {
    if !note_row_needs_encryption(key, &value) {
        return Ok(value);
    }
    let app_enabled = app_encryption_enabled(app, state)?;
    if !app_enabled {
        return Ok(value);
    }
    let mut note = match value {
        Value::Object(note) => note,
        other => return Ok(other),
    };
    // If the app key is not yet unlocked, leave content as-is. The frontend
    // gates writes with ensureAppKeyReadyForWrite(), but we also degrade
    // gracefully here so we don't silently lose user data on a race.
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
    value: Value,
) -> Result<Value, String> {
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

pub(crate) fn path_for_name(
    app: &AppHandle,
    state: &AppState,
    name: &str,
) -> Result<PathBuf, String> {
    match name {
        "userData" => app_data_dir(app, state),
        "appData" => app.path().data_dir().map_err(to_error),
        "desktop" => {
            #[cfg(desktop)]
            {
                app.path().desktop_dir().map_err(to_error)
            }
            #[cfg(not(desktop))]
            {
                app.path()
                    .document_dir()
                    .or_else(|_| app.path().app_data_dir())
                    .map_err(to_error)
            }
        }
        "documents" => app.path().document_dir().map_err(to_error),
        "temp" => app.path().temp_dir().map_err(to_error),
        _ => Err(format!("Unsupported path name: {name}")),
    }
}

fn asset_roots(data_dir: &Path) -> [PathBuf; 2] {
    [data_dir.join("notes-assets"), data_dir.join("file-assets")]
}

pub(crate) fn is_local_asset_path(app: &AppHandle, target_path: &Path) -> bool {
    let state = app.state::<AppState>();
    let Ok(data_dir) = get_data_dir(app, state.inner()) else {
        return false;
    };
    asset_roots(&data_dir)
        .iter()
        .any(|root| is_path_inside(root, target_path))
}

pub(crate) fn resolve_asset_path_from_protocol_url(
    app: &AppHandle,
    url: &str,
    scheme: &str,
) -> Result<PathBuf, String> {
    let prefix = format!("{scheme}://");
    if !url.starts_with(&prefix) {
        return Err(format!("Invalid {scheme} protocol URL: {url}"));
    }

    let relative = url[prefix.len()..]
        .split('#')
        .next()
        .unwrap_or_default()
        .split('?')
        .next()
        .unwrap_or_default()
        .trim();
    let decoded = urlencoding::decode(relative).map_err(to_error)?.to_string();

    // Strict: decoded asset paths must be relative (no absolute paths / prefixes).
    if Path::new(&decoded).is_absolute() {
        return Err(format!("Asset path must be relative: {url}"));
    }
    #[cfg(target_os = "windows")]
    {
        if decoded.starts_with("\\\\") {
            return Err(format!("Asset path must be relative: {url}"));
        }
    }

    let root_name = match scheme {
        "assets" => "notes-assets",
        "file-assets" => "file-assets",
        _ => {
            return Err(format!("Unsupported asset scheme: {scheme}"));
        }
    };
    let state = app.state::<AppState>();
    let base = get_data_dir(app, state.inner())?.join(root_name);
    let resolved = base.join(decoded);
    if !is_path_inside(&base, &resolved) {
        return Err(format!("Asset path escapes base directory: {url}"));
    }
    Ok(resolved)
}

pub(crate) fn resolve_asset_path_from_uri(app: &AppHandle, uri: &str) -> Result<PathBuf, String> {
    if uri.starts_with("assets://") {
        return resolve_asset_path_from_protocol_url(app, uri, "assets");
    }
    if uri.starts_with("file-assets://") {
        return resolve_asset_path_from_protocol_url(app, uri, "file-assets");
    }
    Ok(PathBuf::from(uri))
}

pub(crate) static KEYRING_AVAILABLE: std::sync::atomic::AtomicBool =
std::sync::atomic::AtomicBool::new(!cfg!(target_os = "android"));

pub(crate) fn read_master_key() -> Result<Vec<u8>, String> {
    if KEYRING_AVAILABLE.load(std::sync::atomic::Ordering::Relaxed) {
        if let Ok(entry) = Entry::new(SAFE_STORAGE_SERVICE, SAFE_STORAGE_MASTER_ACCOUNT) {
            if let Ok(stored) = entry.get_password() {
                return BASE64.decode(stored.as_bytes()).map_err(to_error);
            }

            let mut key = vec![0_u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            if entry.set_password(&BASE64.encode(&key)).is_ok() {
                return Ok(key);
            }
        }
        KEYRING_AVAILABLE.store(false, std::sync::atomic::Ordering::Relaxed);
    }

    file_based_master_key()
}

const MASTER_KEY_FILE: &str = "master.key";

pub(crate) fn file_based_master_key() -> Result<Vec<u8>, String> {
    let data_dir = dirs::data_local_dir()
        .ok_or_else(|| "Cannot determine data directory".to_string())?
        .join("com.beaver-notes.beaver-notes");
    let key_path = data_dir.join(MASTER_KEY_FILE);

    if key_path.exists() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = fs::metadata(&key_path).map_err(to_error)?.permissions();
            if perms.mode() & 0o077 != 0 {
                fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600))
                    .map_err(to_error)?;
            }
        }
        let raw = fs::read_to_string(&key_path).map_err(to_error)?;
        let key_bytes = BASE64.decode(raw.trim().as_bytes()).map_err(to_error)?;
        if key_bytes.len() != 32 {
            return Err("Invalid file-based master key length".to_string());
        }
        return Ok(key_bytes);
    }

    let mut key = vec![0_u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    let encoded = BASE64.encode(&key);
    if let Some(parent) = key_path.parent() {
        fs::create_dir_all(parent).map_err(to_error)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                .map_err(to_error)?;
        }
    }
    fs::write(&key_path, encoded).map_err(to_error)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600))
            .map_err(to_error)?;
    }
    Ok(key)
}

pub(crate) fn safe_storage_encrypt_bytes(bytes: &[u8]) -> Result<String, String> {
    let key = read_master_key()?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let mut iv = [0_u8; 12];
    rand::thread_rng().fill_bytes(&mut iv);
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&iv), bytes)
        .map_err(to_error)?;
    let mut payload = iv.to_vec();
    payload.extend_from_slice(&encrypted);
    Ok(BASE64.encode(payload))
}

pub(crate) fn safe_storage_decrypt_bytes(value: &str) -> Result<Vec<u8>, String> {
    let key = read_master_key()?;
    let payload = BASE64.decode(value.as_bytes()).map_err(to_error)?;
    if payload.len() < 13 {
        return Err("Invalid encrypted payload".into());
    }
    let (iv, ciphertext) = payload.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    cipher
        .decrypt(Nonce::from_slice(iv), ciphertext)
        .map_err(to_error)
}

pub(crate) fn allowed_blob_key(key: &str) -> Result<(), String> {
    if ALLOWED_BLOB_KEYS.contains(&key) {
        Ok(())
    } else {
        Err(format!("[safeStorage] Unsupported blob key: {key}"))
    }
}

pub(crate) fn safe_storage_store_blob_cmd(
    _app: &AppHandle,
    state: &AppState,
    key: &str,
    value: Vec<u8>,
) -> Result<(), String> {
    state.secure_blobs.store_blob(state, key, value)
}

pub(crate) fn safe_storage_fetch_blob_cmd(
    _app: &AppHandle,
    state: &AppState,
    key: &str,
) -> Result<Option<Vec<u8>>, String> {
    state.secure_blobs.fetch_blob(state, key)
}

pub(crate) fn safe_storage_clear_blob_cmd(
    _app: &AppHandle,
    state: &AppState,
    key: &str,
) -> Result<(), String> {
    state.secure_blobs.clear_blob(state, key)
}

pub(crate) fn keyring_entry(account: &str) -> Result<Entry, String> {
    Entry::new(SAFE_STORAGE_SERVICE, account).map_err(to_error)
}

pub(crate) fn encrypt_asset_bytes_with_key(
    plain: &[u8],
    key: &[u8; 32],
) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let iv = random_nonce();
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&iv), plain)
        .map_err(to_error)?;
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
) -> Result<Vec<u8>, String> {
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
            .map_err(to_error);
    }
    Ok(encrypted.to_vec())
}

pub(crate) fn decrypt_asset_bytes_with_key_legacy(
    encrypted: &[u8],
    key: &[u8; 32],
) -> Result<Vec<u8>, String> {
    if encrypted.len() < 4 + 12 + 16 || &encrypted[..4] != b"BNA1" {
        return Ok(encrypted.to_vec());
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let iv = &encrypted[4..16];
    let tag = &encrypted[16..32];
    let ciphertext = &encrypted[32..];
    let mut payload = Vec::with_capacity(ciphertext.len() + tag.len());
    payload.extend_from_slice(ciphertext);
    payload.extend_from_slice(tag);
    cipher
        .decrypt(Nonce::from_slice(iv), payload.as_slice())
        .map_err(to_error)
}

pub(crate) fn encrypt_asset_streaming(
    input_path: &Path,
    output_path: &Path,
    key: &[u8; 32],
) -> Result<(), String> {
    let input = File::open(input_path).map_err(to_error)?;
    let output = File::create(output_path).map_err(to_error)?;
    let mut reader = BufReader::with_capacity(STREAM_CHUNK_SIZE, input);
    let mut writer = BufWriter::with_capacity(STREAM_CHUNK_SIZE, output);

    let nonce_seed = random_nonce();
    writer.write_all(ASSET_MAGIC_V3).map_err(to_error)?;
    writer.write_all(&nonce_seed).map_err(to_error)?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut chunk_buf = vec![0u8; STREAM_CHUNK_SIZE];
    let mut chunk_index = 0u64;

    loop {
        let bytes_read = reader.read(&mut chunk_buf).map_err(to_error)?;
        if bytes_read == 0 {
            break;
        }
        let chunk = &chunk_buf[..bytes_read];

        let nonce = derive_chunk_nonce(&nonce_seed, chunk_index, key);

        let encrypted = cipher
            .encrypt(Nonce::from_slice(&nonce), chunk)
            .map_err(to_error)?;

        let (ciphertext, tag) = encrypted.split_at(encrypted.len().saturating_sub(16));
        writer
            .write_all(&(encrypted.len() as u32).to_le_bytes())
            .map_err(to_error)?;
        writer.write_all(ciphertext).map_err(to_error)?;
        writer.write_all(tag).map_err(to_error)?;

        chunk_index += 1;
    }

    writer.flush().map_err(to_error)?;
    Ok(())
}

pub(crate) fn decrypt_asset_streaming(
    input_path: &Path,
    output_path: &Path,
    key: &[u8; 32],
) -> Result<(), String> {
    let input = File::open(input_path).map_err(to_error)?;
    let mut reader = BufReader::with_capacity(STREAM_CHUNK_SIZE + 32, input);

    let mut magic = [0u8; 4];
    match reader.read_exact(&mut magic) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
            drop(reader);
            fs::copy(input_path, output_path).map_err(to_error)?;
            return Ok(());
        }
        Err(e) => return Err(to_error(e)),
    }

    if &magic != ASSET_MAGIC && &magic != ASSET_MAGIC_V3 {
        drop(reader);
        let data = fs::read(input_path).map_err(to_error)?;
        let plain = decrypt_asset_bytes_with_key_legacy(&data, key)?;
        fs::write(output_path, plain).map_err(to_error)?;
        return Ok(());
    }

    let is_v3 = &magic == ASSET_MAGIC_V3;

    let mut nonce_seed = [0u8; 12];
    reader.read_exact(&mut nonce_seed).map_err(to_error)?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));

    let output = File::create(output_path).map_err(to_error)?;
    let mut writer = BufWriter::with_capacity(STREAM_CHUNK_SIZE, output);

    let mut len_buf = [0u8; 4];
    let mut chunk_index = 0u64;

    loop {
        match reader.read_exact(&mut len_buf) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(to_error(e)),
        }
        let chunk_len = u32::from_le_bytes(len_buf) as usize;

        if chunk_len == 0 || chunk_len > STREAM_CHUNK_SIZE + 16 + 64 {
            return Err(format!(
                "Invalid chunk length {} at index {}",
                chunk_len, chunk_index
            ));
        }

        let mut chunk_buf = vec![0u8; chunk_len];
        reader
            .read_exact(&mut chunk_buf)
            .map_err(|e| format!("Failed to read chunk {}: {}", chunk_index, e))?;

        let nonce = if is_v3 {
            derive_chunk_nonce(&nonce_seed, chunk_index, key)
        } else {
            let mut nonce_bytes = nonce_seed.to_vec();
            let index_bytes = chunk_index.to_le_bytes();
            nonce_bytes.extend_from_slice(&index_bytes);
            let nonce: [u8; 12] = nonce_bytes[..12]
                .try_into()
                .map_err(|_| "Invalid nonce length".to_string())?;
            nonce
        };

        let decrypted = cipher
            .decrypt(Nonce::from_slice(&nonce), chunk_buf.as_slice())
            .map_err(|_| format!("Decryption failed for chunk {}", chunk_index))?;

        writer.write_all(&decrypted).map_err(to_error)?;
        chunk_index += 1;
    }

    writer.flush().map_err(to_error)?;
    Ok(())
}

pub(crate) fn cache_decrypted_note(state: &AppState, note_id: &str, content: &[u8]) {
    if let Ok(mut cache) = state.decrypted_notes_cache.lock() {
        cache.put(note_id.to_string(), content.to_vec());
    }
}

pub(crate) fn get_cached_decrypted_note(state: &AppState, note_id: &str) -> Option<Vec<u8>> {
    if let Ok(mut cache) = state.decrypted_notes_cache.lock() {
        cache.get(note_id).cloned()
    } else {
        None
    }
}

pub(crate) fn cache_decrypted_asset(state: &AppState, asset_path: &str, content: &[u8]) {
    if let Ok(mut cache) = state.decrypted_assets_cache.lock() {
        cache.put(asset_path.to_string(), content.to_vec());
    }
}

pub(crate) fn get_cached_decrypted_asset(state: &AppState, asset_path: &str) -> Option<Vec<u8>> {
    if let Ok(mut cache) = state.decrypted_assets_cache.lock() {
        cache.get(asset_path).cloned()
    } else {
        None
    }
}

pub(crate) fn clear_decrypted_caches(state: &AppState) {
    if let Ok(mut cache) = state.decrypted_notes_cache.lock() {
        cache.clear();
    }
    if let Ok(mut cache) = state.decrypted_assets_cache.lock() {
        cache.clear();
    }
}

pub(crate) fn is_encrypted_asset_buffer(buffer: &[u8]) -> bool {
    (buffer.len() > 4 + 12 + 16
        && (&buffer[..4] == ASSET_MAGIC || &buffer[..4] == ASSET_MAGIC_V3))
    || buffer.len() > 4 + 12 + 16 && &buffer[..4] == b"BNA1"
}

pub(crate) fn is_encrypted_asset_v2(buffer: &[u8]) -> bool {
    buffer.len() > 4 + 12 + 16
        && (&buffer[..4] == ASSET_MAGIC || &buffer[..4] == ASSET_MAGIC_V3)
}

pub(crate) fn maybe_encrypt_asset(
    app: &AppHandle,
    state: &AppState,
    target_path: &Path,
    input: &[u8],
    skip: bool,
) -> Result<Vec<u8>, String> {
    if skip || !is_local_asset_path(app, target_path) || is_encrypted_asset_buffer(input) {
        return Ok(input.to_vec());
    }
    let manifest_path = app_encryption_manifest_path(app, state)?;
    if !manifest_path.exists() {
        return Ok(input.to_vec());
    }
    let key = current_app_key(state)?.ok_or_else(|| {
        "App encryption is enabled but locked. Unlock before writing assets.".to_string()
    })?;
    encrypt_asset_bytes_with_key(input, &key)
}

pub(crate) fn maybe_decrypt_asset(
    app: &AppHandle,
    state: &AppState,
    target_path: &Path,
    input: &[u8],
) -> Result<Vec<u8>, String> {
    if !is_local_asset_path(app, target_path) || !is_encrypted_asset_buffer(input) {
        return Ok(input.to_vec());
    }
    let key = current_app_key(state)?.ok_or_else(|| {
        "App encryption is enabled but locked. Unlock before reading assets.".to_string()
    })?;
    decrypt_asset_bytes_with_key(input, &key)
}

pub(crate) fn grant_trusted_path(state: &AppState, path: &Path) {
    if let Ok(mut granted) = state.granted_paths.lock() {
        granted.insert(path.to_path_buf());
    }
}

pub(crate) fn grant_dialog_paths(state: &AppState, paths: &[PathBuf]) {
    for path in paths {
        grant_trusted_path(state, path);
        if let Some(parent) = path.parent() {
            grant_trusted_path(state, parent);
        }
    }
}

pub(crate) fn sync_roots_from_settings(app: &AppHandle, state: &AppState) {
    for key in ["syncPath", "defaultPath", "default-path", "dataDir"] {
        if let Some(Value::String(value)) = get_settings_value(app, state, key) {
            if !value.trim().is_empty() {
                grant_trusted_path(state, Path::new(&value));
            }
        }
    }
}

pub(crate) fn assert_path_access(
    app: &AppHandle,
    state: &AppState,
    input: &Path,
    operation: &str,
) -> Result<(), String> {
    let mut allowed_roots = vec![
        app_data_dir(app, state)?,
        app.path().temp_dir().map_err(to_error)?,
    ];

    if let Ok(data_dir) = get_data_dir(app, state) {
        allowed_roots.push(data_dir);
    }
    for key in ["syncPath", "defaultPath", "default-path"] {
        if let Some(Value::String(value)) = get_settings_value(app, state, key) {
            if !value.trim().is_empty() {
                allowed_roots.push(PathBuf::from(value));
            }
        }
    }
    if let Ok(granted) = state.granted_paths.lock() {
        allowed_roots.extend(granted.iter().cloned());
    }

    if is_path_allowed_strict(&allowed_roots, input) {
        return Ok(());
    }

    Err(format!(
        r#"[fs-access] Blocked {operation}: "{path}". Re-select the folder/file from a system dialog to grant access."#,
        path = input.display()
    ))
}

pub(crate) fn to_file_stat(metadata: fs::Metadata) -> FileStat {
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let created = metadata
        .created()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or_default();
    FileStat {
        is_file: metadata.is_file(),
        is_directory: metadata.is_dir(),
        size: metadata.len(),
        mtime_ms: modified,
        ctime_ms: created,
    }
}

pub(crate) fn content_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "json" => "application/json",
        "html" => "text/html; charset=utf-8",
        "md" | "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn prune_asset_cache_dir(asset_cache_dir: &Path) {
    let Ok(entries) = fs::read_dir(asset_cache_dir) else {
        return;
    };
    let mut files = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let metadata = entry.metadata().ok()?;
            Some((path, metadata.modified().ok()?))
        })
        .collect::<Vec<_>>();

    files.sort_by_key(|(_, modified)| std::cmp::Reverse(*modified));
    let now = SystemTime::now();
    for (index, (path, modified)) in files.into_iter().enumerate() {
        let too_old = now.duration_since(modified).unwrap_or_default() > ASSET_CACHE_TTL;
        let over_limit = index >= ASSET_CACHE_MAX_FILES;
        if too_old || over_limit {
            let _ = fs::remove_file(path);
        }
    }
}

pub(crate) fn clear_asset_cache(state: &AppState) {
    let _ = fs::remove_dir_all(&state.asset_cache_dir);
}

pub(crate) fn clear_external_open_dir(state: &AppState) {
    let _ = fs::remove_dir_all(&state.external_open_dir);
}

pub(crate) fn decrypted_cache_path(
    asset_cache_dir: &Path,
    source: &Path,
    metadata: &fs::Metadata,
) -> Result<PathBuf, String> {
    fs::create_dir_all(asset_cache_dir).map_err(to_error)?;
    let cache_key = format!(
        "{}:{}:{}",
        source.display(),
        metadata
            .modified()
            .map_err(to_error)?
            .duration_since(SystemTime::UNIX_EPOCH)
            .map_err(to_error)?
            .as_millis(),
        metadata.len()
    );
    let mut hasher = Sha256::new();
    hasher.update(cache_key.as_bytes());
    let hash = hex::encode(hasher.finalize());
    Ok(asset_cache_dir.join(format!(
        "{}{}",
        hash,
        source
            .extension()
            .and_then(|s| s.to_str())
            .map(|ext| format!(".{ext}"))
            .unwrap_or_default()
    )))
}

pub(crate) fn cached_or_decrypted_asset(
    app: &AppHandle,
    asset_cache_dir: &Path,
    transient_passphrase: Option<&str>,
    path: &Path,
) -> Result<PathBuf, String> {
    let raw = fs::read(path).map_err(to_error)?;
    if !is_encrypted_asset_buffer(&raw) {
        return Ok(path.to_path_buf());
    }

    let metadata = fs::metadata(path).map_err(to_error)?;
    let cache_path = decrypted_cache_path(asset_cache_dir, path, &metadata)?;
    if cache_path.exists() {
        return Ok(cache_path);
    }
    let app_state = app.state::<AppState>();
    let key = if let Some(passphrase) = transient_passphrase.filter(|v| !v.is_empty()) {
        // Derive key from transient passphrase (e.g. during asset migration
        // before the main app key has been restored into state)
        let manifest_path = app_encryption_manifest_path(app, app_state.inner())?;
        let manifest = load_encryption_manifest(&manifest_path)?
            .ok_or_else(|| "App encryption manifest is missing.".to_string())?;
        unlock_key_from_manifest(
            &manifest,
            passphrase,
            APP_ENCRYPTION_SCOPE,
            APP_PASSWORD_CHECK,
        )?
    } else {
        current_app_key(app_state.inner())?.ok_or_else(|| {
            "App encryption is locked. Unlock before opening encrypted assets.".to_string()
        })?
    };
    let plain = decrypt_asset_bytes_with_key(&raw, &key)?;
    fs::write(&cache_path, plain).map_err(to_error)?;
    prune_asset_cache_dir(asset_cache_dir);
    Ok(cache_path)
}

pub(crate) fn dialog_file_paths_to_strings(paths: Vec<FilePath>) -> Vec<String> {
    paths
        .into_iter()
        .filter_map(|path| match path {
            FilePath::Path(path) => Some(path.to_string_lossy().to_string()),
            FilePath::Url(url) => Some(url.to_string()),
        })
        .collect()
}

pub(crate) fn dialog_file_path_to_string(path: FilePath) -> Option<String> {
    match path {
        FilePath::Path(path) => Some(path.to_string_lossy().to_string()),
        FilePath::Url(url) => Some(url.to_string()),
    }
}

pub(crate) fn dialog_file_path_to_trusted_path(path: &FilePath) -> Option<PathBuf> {
    match path {
        FilePath::Path(path) => Some(path.clone()),
        FilePath::Url(url) => url.to_file_path().ok(),
    }
}

pub(crate) fn dialog_file_paths_to_trusted_paths(paths: &[FilePath]) -> Vec<PathBuf> {
    paths
        .iter()
        .filter_map(dialog_file_path_to_trusted_path)
        .collect()
}

pub(crate) fn configure_file_dialog<R: tauri::Runtime>(
    builder: tauri_plugin_dialog::FileDialogBuilder<R>,
    props: &OpenDialogOptions,
    window: Option<&WebviewWindow<R>>,
) -> tauri_plugin_dialog::FileDialogBuilder<R> {
    let mut builder = builder;
    if let Some(title) = &props.title {
        builder = builder.set_title(title);
    }
    if let Some(default_path) = &props.default_path {
        builder = builder.set_directory(default_path);
    }
    #[cfg(desktop)]
    if let Some(window) = window {
        builder = builder.set_parent(window);
    }
    if let Some(filters) = &props.filters {
        for filter in filters {
            let exts = filter
                .extensions
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>();
            builder = builder.add_filter(filter.name.clone(), &exts);
        }
    }
    builder
}

pub(crate) fn protocol_response(
    status: StatusCode,
    path: &Path,
    bytes: Vec<u8>,
) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, content_type_for_path(path))
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(bytes)
        .unwrap_or_else(|_| {
            let mut r = Response::new(Vec::new());
            *r.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
            r
        })
}
