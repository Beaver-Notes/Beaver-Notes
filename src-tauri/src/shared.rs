use std::{
  collections::{ HashMap, HashSet },
  fs,
  path::{ Path, PathBuf },
  sync::{ Arc, Mutex, OnceLock },
  time::{ Duration, SystemTime },
};

use aes_gcm::{ aead::{ Aead, KeyInit }, Aes256Gcm, Key, Nonce };
use base64::{ engine::general_purpose::STANDARD as BASE64, Engine as _ };
use http::{ header::{ ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_TYPE }, Response, StatusCode };
use keyring::Entry;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{ Deserialize, Serialize };
use serde_json::Value;
use sha2::{ Digest, Sha256 };
use tauri::{ AppHandle, Manager, State, WebviewWindow };
use tauri_plugin_dialog::FilePath;
use tauri_plugin_stronghold::stronghold::Stronghold as SecureStronghold;
use tauri_plugin_updater::Update;

use crate::db::DbPool;

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";
pub(crate) const SETTINGS_STORE: &str = "settings.json";
pub(crate) const DATA_STORE: &str = "data.json";
pub(crate) const AUTH_STORE: &str = "auth.json";
pub(crate) const SAFE_STORAGE_SERVICE: &str = "com.beaver-notes.beaver-notes";
pub(crate) const SAFE_STORAGE_MASTER_ACCOUNT: &str = "__safe_storage_master_key__";
pub(crate) const APP_PASSPHRASE_ACCOUNT: &str = "__asset_passphrase__";
pub(crate) const ALLOWED_BLOB_KEYS: &[&str] = &["syncPassphraseBlob", "appPassphraseBlob"];
pub(crate) const STRONGHOLD_CLIENT: &[u8] = b"beaver-notes";
pub(crate) const STRONGHOLD_SNAPSHOT_FILE: &str = "secure-store.stronghold";
pub(crate) const WARN_THRESHOLD: u32 = 5;
pub(crate) const ASSET_MAGIC: &[u8; 4] = b"BNA1";
pub(crate) const PBKDF2_ITERATIONS: u32 = 100_000;
pub(crate) const ASSET_CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
pub(crate) const ASSET_CACHE_MAX_FILES: usize = 300;

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
  pub(crate) updater: Arc<Mutex<UpdaterState>>,
  pub(crate) pending_open_files: Arc<Mutex<Vec<String>>>,
  pub(crate) external_open_files: Arc<Mutex<HashMap<PathBuf, PathBuf>>>,
  pub(crate) asset_cache_dir: PathBuf,
  pub(crate) external_open_dir: PathBuf,
}

impl AppState {
  pub(crate) fn new(cache_dir: PathBuf, external_open_dir: PathBuf) -> Self {
    Self {
      db: DbState::new(),
      zoom_level: Mutex::new(1.0),
      failure_count: Mutex::new(0),
      granted_paths: Arc::new(Mutex::new(HashSet::new())),
      transient_passphrase: Mutex::new(String::new()),
      updater: Arc::new(
        Mutex::new(UpdaterState {
          auto_update_enabled: true,
          ..Default::default()
        })
      ),
      pending_open_files: Arc::new(Mutex::new(Vec::new())),
      external_open_files: Arc::new(Mutex::new(HashMap::new())),
      asset_cache_dir: cache_dir,
      external_open_dir,
    }
  }
}

pub(crate) fn to_error<E: std::fmt::Display>(error: E) -> String {
  error.to_string()
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

fn is_path_inside(root: &Path, candidate: &Path) -> bool {
  let root = normalize_for_compare(root);
  let candidate = normalize_for_compare(candidate);
  candidate == root || candidate.starts_with(&root)
}

pub(crate) fn now_millis() -> u128 {
  SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_millis()
}

pub(crate) fn allowed_store_name(name: &str) -> Result<&'static str, String> {
  match name {
    "data" => Ok(DATA_STORE),
    "settings" => Ok(SETTINGS_STORE),
    _ => Err(format!(r#"[storage] blocked access to unknown store: "{name}""#)),
  }
}

pub(crate) fn get_or_init_pool<'a>(
  app: &AppHandle,
  lock: &'a OnceLock<DbPool>,
  filename: &str
) -> Result<&'a DbPool, String> {
  if let Some(pool) = lock.get() {
    return Ok(pool);
  }
  let path = app.path().app_data_dir().map_err(to_error)?.join(filename);
  let pool = crate::db::open_pool(&path)?;
  Ok(lock.get_or_init(|| pool))
}

pub(crate) fn data_pool<'a>(app: &AppHandle, state: &'a AppState) -> Result<&'a DbPool, String> {
  get_or_init_pool(app, &state.db.data, "data.db")
}

pub(crate) fn settings_pool<'a>(
  app: &AppHandle,
  state: &'a AppState
) -> Result<&'a DbPool, String> {
  get_or_init_pool(app, &state.db.settings, "settings.db")
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
  app.path().app_data_dir().map_err(to_error)
}

pub(crate) fn path_for_name(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
  match name {
    "userData" => app.path().app_data_dir().map_err(to_error),
    "appData" => app.path().data_dir().map_err(to_error),
    "desktop" => {
      #[cfg(desktop)]
      {
        app.path().desktop_dir().map_err(to_error)
      }
      #[cfg(not(desktop))]
      {
        app
          .path()
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
  scheme: &str
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
    .trim_start_matches('/');
  let decoded = urlencoding::decode(relative).map_err(to_error)?.to_string();
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

fn read_master_key() -> Result<Vec<u8>, String> {
  let entry = Entry::new(SAFE_STORAGE_SERVICE, SAFE_STORAGE_MASTER_ACCOUNT).map_err(to_error)?;
  if let Ok(stored) = entry.get_password() {
    return BASE64.decode(stored.as_bytes()).map_err(to_error);
  }

  let mut key = vec![0_u8; 32];
  rand::thread_rng().fill_bytes(&mut key);
  entry.set_password(&BASE64.encode(&key)).map_err(to_error)?;
  Ok(key)
}

pub(crate) fn safe_storage_encrypt_bytes(bytes: &[u8]) -> Result<String, String> {
  let key = read_master_key()?;
  let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
  let mut iv = [0_u8; 12];
  rand::thread_rng().fill_bytes(&mut iv);
  let encrypted = cipher.encrypt(Nonce::from_slice(&iv), bytes).map_err(to_error)?;
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
  cipher.decrypt(Nonce::from_slice(iv), ciphertext).map_err(to_error)
}

fn stronghold_snapshot_path(app: &AppHandle) -> Result<PathBuf, String> {
  let state = app.state::<AppState>();
  Ok(get_data_dir(app, state.inner())?.join(STRONGHOLD_SNAPSHOT_FILE))
}

fn open_stronghold(app: &AppHandle) -> Result<SecureStronghold, String> {
  let snapshot_path = stronghold_snapshot_path(app)?;
  SecureStronghold::new(&snapshot_path, read_master_key()?).map_err(to_error)
}

fn load_or_create_stronghold_client(
  stronghold: &SecureStronghold
) -> Result<iota_stronghold::Client, String> {
  stronghold
    .load_client(STRONGHOLD_CLIENT)
    .or_else(|_| stronghold.create_client(STRONGHOLD_CLIENT))
    .map_err(to_error)
}

pub(crate) fn stronghold_get_record(app: &AppHandle, key: &str) -> Result<Option<Vec<u8>>, String> {
  let snapshot_path = stronghold_snapshot_path(app)?;
  if !snapshot_path.exists() {
    return Ok(None);
  }

  let stronghold = open_stronghold(app)?;
  let client = stronghold.load_client(STRONGHOLD_CLIENT).map_err(to_error)?;
  client.store().get(key.as_bytes()).map_err(to_error)
}

pub(crate) fn stronghold_save_record(
  app: &AppHandle,
  key: &str,
  value: Vec<u8>
) -> Result<(), String> {
  let stronghold = open_stronghold(app)?;
  let client = load_or_create_stronghold_client(&stronghold)?;
  client.store().insert(key.as_bytes().to_vec(), value, None).map_err(to_error)?;
  stronghold.save().map_err(to_error)
}

pub(crate) fn stronghold_remove_record(app: &AppHandle, key: &str) -> Result<(), String> {
  let snapshot_path = stronghold_snapshot_path(app)?;
  if !snapshot_path.exists() {
    return Ok(());
  }

  let stronghold = open_stronghold(app)?;
  let client = stronghold.load_client(STRONGHOLD_CLIENT).map_err(to_error)?;
  client.store().delete(key.as_bytes()).map_err(to_error)?;
  stronghold.save().map_err(to_error)
}

pub(crate) fn allowed_blob_key(key: &str) -> Result<(), String> {
  if ALLOWED_BLOB_KEYS.contains(&key) {
    Ok(())
  } else {
    Err(format!("[safeStorage] Unsupported blob key: {key}"))
  }
}

pub(crate) fn keyring_entry(account: &str) -> Result<Entry, String> {
  Entry::new(SAFE_STORAGE_SERVICE, account).map_err(to_error)
}

fn derive_asset_key(passphrase: &str, salt: &[u8]) -> [u8; 32] {
  let mut key = [0_u8; 32];
  pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
  key
}

pub(crate) fn encrypt_asset_bytes(
  passphrase: &str,
  plain: &[u8],
  salt_hex: &str
) -> Result<Vec<u8>, String> {
  let salt = hex::decode(salt_hex.trim()).map_err(to_error)?;
  let key = derive_asset_key(passphrase, &salt);
  let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
  let mut iv = [0_u8; 12];
  rand::thread_rng().fill_bytes(&mut iv);
  let encrypted = cipher.encrypt(Nonce::from_slice(&iv), plain).map_err(to_error)?;
  let (ciphertext, tag) = encrypted.split_at(encrypted.len().saturating_sub(16));
  let mut output = Vec::with_capacity(4 + 12 + 16 + ciphertext.len());
  output.extend_from_slice(ASSET_MAGIC);
  output.extend_from_slice(&iv);
  output.extend_from_slice(tag);
  output.extend_from_slice(ciphertext);
  Ok(output)
}

pub(crate) fn decrypt_asset_bytes(
  passphrase: &str,
  encrypted: &[u8],
  salt_hex: &str
) -> Result<Vec<u8>, String> {
  if encrypted.len() < 4 + 12 + 16 || &encrypted[..4] != ASSET_MAGIC {
    return Ok(encrypted.to_vec());
  }
  let salt = hex::decode(salt_hex.trim()).map_err(to_error)?;
  let key = derive_asset_key(passphrase, &salt);
  let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
  let iv = &encrypted[4..16];
  let tag = &encrypted[16..32];
  let ciphertext = &encrypted[32..];
  let mut payload = Vec::with_capacity(ciphertext.len() + tag.len());
  payload.extend_from_slice(ciphertext);
  payload.extend_from_slice(tag);
  cipher.decrypt(Nonce::from_slice(iv), payload.as_slice()).map_err(to_error)
}

pub(crate) fn is_encrypted_asset_buffer(buffer: &[u8]) -> bool {
  buffer.len() > 4 + 12 + 16 && &buffer[..4] == ASSET_MAGIC
}

pub(crate) fn app_crypto_salt_hex(app: &AppHandle) -> Result<String, String> {
  let state = app.state::<AppState>();
  let salt_path = get_data_dir(app, state.inner())?.join("app-crypto").join("salt");
  fs::read_to_string(salt_path).map_err(to_error)
}

pub(crate) fn current_asset_passphrase(
  app: &AppHandle,
  state: &AppState
) -> Result<String, String> {
  let current = state.transient_passphrase.lock().map_err(to_error)?.clone();
  if !current.is_empty() {
    return Ok(current);
  }

  if
    let Some(passphrase) = stronghold_get_record(app, APP_PASSPHRASE_ACCOUNT)?
      .and_then(|value| String::from_utf8(value).ok())
      .filter(|value| !value.is_empty())
  {
    return Ok(passphrase);
  }

  let passphrase = keyring_entry(APP_PASSPHRASE_ACCOUNT)?.get_password().map_err(to_error)?;
  let _ = stronghold_save_record(app, APP_PASSPHRASE_ACCOUNT, passphrase.as_bytes().to_vec());
  Ok(passphrase)
}

pub(crate) fn maybe_encrypt_asset(
  app: &AppHandle,
  state: &State<'_, AppState>,
  target_path: &Path,
  input: &[u8],
  skip: bool
) -> Result<Vec<u8>, String> {
  if skip || !is_local_asset_path(app, target_path) || is_encrypted_asset_buffer(input) {
    return Ok(input.to_vec());
  }
  let passphrase = current_asset_passphrase(app, state)?;
  if passphrase.is_empty() {
    return Ok(input.to_vec());
  }
  let salt_hex = app_crypto_salt_hex(app)?;
  encrypt_asset_bytes(&passphrase, input, &salt_hex)
}

pub(crate) fn maybe_decrypt_asset(
  app: &AppHandle,
  state: &State<'_, AppState>,
  target_path: &Path,
  input: &[u8]
) -> Result<Vec<u8>, String> {
  if !is_local_asset_path(app, target_path) || !is_encrypted_asset_buffer(input) {
    return Ok(input.to_vec());
  }
  let passphrase = current_asset_passphrase(app, state)?;
  let salt_hex = app_crypto_salt_hex(app)?;
  decrypt_asset_bytes(&passphrase, input, &salt_hex)
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
  operation: &str
) -> Result<(), String> {
  let mut allowed_roots = vec![
    app.path().app_data_dir().map_err(to_error)?,
    app.path().temp_dir().map_err(to_error)?
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

  if allowed_roots.iter().any(|root| is_path_inside(root, input)) {
    Ok(())
  } else {
    Err(
      format!(
        r#"[fs-access] Blocked {operation}: "{path}". Re-select the folder/file from a system dialog to grant access."#,
        path = input.display()
      )
    )
  }
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
  match
    path
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

fn decrypted_cache_path(
  asset_cache_dir: &Path,
  source: &Path,
  metadata: &fs::Metadata
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
  Ok(
    asset_cache_dir.join(
      format!(
        "{}{}",
        hash,
        source
          .extension()
          .and_then(|s| s.to_str())
          .map(|ext| format!(".{ext}"))
          .unwrap_or_default()
      )
    )
  )
}

pub(crate) fn cached_or_decrypted_asset(
  app: &AppHandle,
  asset_cache_dir: &Path,
  transient_passphrase: Option<&str>,
  path: &Path
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

  let passphrase = transient_passphrase
    .filter(|value| !value.is_empty())
    .map(str::to_owned)
    .or_else(|| {
      stronghold_get_record(app, APP_PASSPHRASE_ACCOUNT)
        .ok()
        .flatten()
        .and_then(|value| String::from_utf8(value).ok())
        .filter(|value| !value.is_empty())
    })
    .or_else(|| { keyring_entry(APP_PASSPHRASE_ACCOUNT).ok()?.get_password().ok() })
    .ok_or_else(|| "Asset passphrase unavailable".to_string())?;
  let salt_hex = app_crypto_salt_hex(app)?;
  let plain = decrypt_asset_bytes(&passphrase, &raw, &salt_hex)?;
  fs::write(&cache_path, plain).map_err(to_error)?;
  prune_asset_cache_dir(asset_cache_dir);
  Ok(cache_path)
}

pub(crate) fn dialog_file_paths_to_strings(paths: Vec<FilePath>) -> Vec<String> {
  paths
    .into_iter()
    .filter_map(|path| {
      match path {
        FilePath::Path(path) => Some(path.to_string_lossy().to_string()),
        FilePath::Url(url) => Some(url.to_string()),
      }
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
  paths.iter().filter_map(dialog_file_path_to_trusted_path).collect()
}

pub(crate) fn configure_file_dialog<R: tauri::Runtime>(
  builder: tauri_plugin_dialog::FileDialogBuilder<R>,
  props: &OpenDialogOptions,
  window: Option<&WebviewWindow<R>>
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
      let exts = filter.extensions.iter().map(String::as_str).collect::<Vec<_>>();
      builder = builder.add_filter(filter.name.clone(), &exts);
    }
  }
  builder
}

pub(crate) fn protocol_response(
  status: StatusCode,
  path: &Path,
  bytes: Vec<u8>
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
