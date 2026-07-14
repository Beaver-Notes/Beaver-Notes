use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
    time::{Duration, SystemTime},
};

use http::{
    header::{ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_TYPE},
    Response, StatusCode,
};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::FilePath;
use tauri_plugin_updater::Update;

use crate::db::DbPool;
use crate::secure_blob::SecureBlobCache;

mod cache;
pub(crate) use cache::*;

mod crypto;
pub(crate) use crypto::*;

mod error;
pub(crate) use error::*;

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";
pub(crate) const SETTINGS_STORE: &str = "settings.json";
pub(crate) const DATA_STORE: &str = "data.json";
pub(crate) const AUTH_STORE: &str = "auth.json";
pub(crate) const SAFE_STORAGE_SERVICE: &str = "com.beavernotes.beaver-notes";
pub(crate) const ALLOWED_BLOB_KEYS: &[&str] = &["encryptionPassphraseBlob"];
pub(crate) const WARN_THRESHOLD: u32 = 5;
/// Consecutive failed passphrase attempts before the app-encryption unlock is
/// rate-limited (lockout), and the base lockout duration. Each further failure
/// while locked extends the lockout by `LOCKOUT_BASE_SECS`, capped at `LOCKOUT_MAX_SECS`.
pub(crate) const LOCKOUT_THRESHOLD: u32 = 5;
pub(crate) const LOCKOUT_BASE_SECS: u64 = 30;
pub(crate) const LOCKOUT_MAX_SECS: u64 = 300;
pub(crate) const ASSET_CACHE_TTL: Duration = Duration::from_secs(60 * 60);
pub(crate) const ASSET_CACHE_MAX_FILES: usize = 75;
pub(crate) const SYNC_PASSWORD_CHECK: &str = "BeaverNotes-sync-manifest-v3";
pub(crate) const SYNC_ENCRYPTION_SCOPE: &str = "sync";

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
    /// True when the unlock is currently rate-limited (lockout active).
    pub(crate) locked: bool,
    /// Seconds remaining in the current lockout (0 when not locked).
    pub(crate) lockout_seconds: u64,
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
    pub(crate) app_dir: Option<String>,
    pub(crate) has_legacy_data: bool,
    pub(crate) already_migrated: bool,
    pub(crate) target_has_data: bool,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LegacyMigrationResult {
    pub(crate) legacy_dir: Option<String>,
    pub(crate) app_dir: Option<String>,
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
    pub(crate) data: Mutex<Option<DbPool>>,
    pub(crate) settings: Mutex<Option<DbPool>>,
}

impl DbState {
    pub(crate) fn new() -> Self {
        Self {
            data: Mutex::new(None),
            settings: Mutex::new(None),
        }
    }
}

/// Snapshot of the app-encryption session. Lives behind a single `RwLock` in
/// `AppState` so the items-key ring, current key id, cached KEK, loaded data
/// key, and active flag are always mutated/observed atomically (no TOCTOU).
#[derive(Default, Debug)]
pub(crate) struct CryptoSession {
    /// Items data key (decrypted). Present only while the app is unlocked.
    pub(crate) app_data_key: Option<[u8; 32]>,
    /// Ring of items keys (current + previous), keyed by items-key id. Enables
    /// lazy rotation: old data stays decryptable after a new items key is created.
    pub(crate) items_keys: HashMap<String, [u8; 32]>,
    /// ID of the current items key (empty when locked / unconfigured).
    pub(crate) current_items_key_id: String,
    /// Cached KEK derived from the passphrase; enables key rotation without
    /// re-prompting. Present only while unlocked.
    pub(crate) master_key_cache: Option<[u8; 32]>,
    /// Whether app encryption is enabled (a manifest exists).
    pub(crate) active: bool,
}

pub(crate) struct AppState {
    pub(crate) db: DbState,
    pub(crate) zoom_level: Mutex<f64>,
    pub(crate) reduced_motion: Mutex<bool>,
    pub(crate) high_contrast: Mutex<bool>,
    pub(crate) failure_count: Mutex<u32>,
    /// When set, app-encryption unlock is rate-limited until this instant.
    pub(crate) lockout_until: Mutex<Option<SystemTime>>,
    pub(crate) granted_paths: Arc<Mutex<HashSet<PathBuf>>>,
    pub(crate) transient_passphrase: Mutex<String>,
    pub(crate) asset_key_cache: Mutex<Option<[u8; 32]>>,
    /// All app-encryption session state, behind one lock (see `CryptoSession`).
    pub(crate) crypto: RwLock<CryptoSession>,
    pub(crate) decrypted_notes_cache: Mutex<ByteLruCache>,
    pub(crate) decrypted_assets_cache: Mutex<ByteLruCache>,
    pub(crate) updater: Arc<Mutex<UpdaterState>>,
    pub(crate) pending_open_files: Arc<Mutex<Vec<String>>>,
    pub(crate) external_open_files: Arc<Mutex<HashMap<PathBuf, PathBuf>>>,
    pub(crate) asset_cache_dir: PathBuf,
    pub(crate) external_open_dir: PathBuf,
    pub(crate) portable_storage_dir: Option<PathBuf>,
    pub(crate) secure_blobs: SecureBlobCache,
}

impl AppState {
    pub(crate) fn new(
        cache_dir: PathBuf,
        external_open_dir: PathBuf,
        portable_storage_dir: Option<PathBuf>,
    ) -> Self {
        Self {
            db: DbState::new(),
            zoom_level: Mutex::new(1.0),
            reduced_motion: Mutex::new(false),
            high_contrast: Mutex::new(false),
            failure_count: Mutex::new(0),
            lockout_until: Mutex::new(None),
            granted_paths: Arc::new(Mutex::new(HashSet::new())),
            transient_passphrase: Mutex::new(String::new()),
            asset_key_cache: Mutex::new(None),
            crypto: RwLock::new(CryptoSession::default()),
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
            portable_storage_dir,
            secure_blobs: SecureBlobCache::new(),
        }
    }
}

pub(crate) fn app_storage_dir(app: &AppHandle, _state: &AppState) -> Result<PathBuf, String> {
    if let Ok(override_dir) = std::env::var("BEAVER_NOTES_DATA_DIR") {
        let p = PathBuf::from(override_dir);
        if !p.exists() {
            fs::create_dir_all(&p).map_err(|e| format!("Failed to create data dir: {e}"))?;
        }
        return Ok(p);
    }
    app.path().app_data_dir().map_err(to_error)
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum InstallationSource {
    Standalone,
    Scoop,
    Brew,
    LinuxPackage,
    AppStore,
}

pub(crate) fn current_installation_source() -> InstallationSource {
    #[cfg(mobile)]
    {
        InstallationSource::AppStore
    }

    #[cfg(all(not(mobile), target_os = "macos"))]
    {
        let is_brew = std::env::current_exe()
            .ok()
            .and_then(|p| std::fs::canonicalize(&p).ok())
            .is_some_and(|p| p.to_string_lossy().to_lowercase().contains("/cellar/"));
        if is_brew {
            InstallationSource::Brew
        } else {
            InstallationSource::Standalone
        }
    }

    #[cfg(all(not(mobile), target_os = "windows"))]
    {
        let is_scoop = std::env::current_exe()
            .ok()
            .is_some_and(|p| p.to_string_lossy().to_lowercase().contains("scoop"));
        if is_scoop {
            InstallationSource::Scoop
        } else {
            InstallationSource::Standalone
        }
    }

    #[cfg(not(any(mobile, target_os = "macos", target_os = "windows")))]
    {
        InstallationSource::LinuxPackage
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

/// Return an owned clone of the active workspace data pool (cheap Arc clone).
/// Lazily initializes from the active workspace on first call.
pub(crate) fn data_pool(app: &AppHandle, state: &AppState) -> Result<DbPool, String> {
    {
        let guard = state.db.data.lock().map_err(to_error)?;
        if let Some(pool) = guard.as_ref() {
            return Ok(pool.clone());
        }
    }
    let workspace_id = read_active_workspace_from_json(app, state)?;
    let path = workspace_data_path(app, state, &workspace_id)?;
    let pool = crate::db::open_pool(&path)?;
    let mut guard = state.db.data.lock().map_err(to_error)?;
    if guard.is_some() {
        return Ok(guard.as_ref().unwrap().clone());
    }
    *guard = Some(pool.clone());
    Ok(pool)
}

/// Swap the active data pool to a different workspace's database.
pub(crate) fn swap_data_pool(
    app: &AppHandle,
    state: &AppState,
    workspace_id: &str,
) -> Result<(), String> {
    let path = workspace_data_path(app, state, workspace_id)?;
    let pool = crate::db::open_pool(&path)?;
    let mut guard = state.db.data.lock().map_err(to_error)?;
    *guard = Some(pool);
    Ok(())
}

/// Return an owned clone of the active workspace settings pool.
/// Lazily initializes from the active workspace on first call.
pub(crate) fn settings_pool(app: &AppHandle, state: &AppState) -> Result<DbPool, String> {
    {
        let guard = state.db.settings.lock().map_err(to_error)?;
        if let Some(pool) = guard.as_ref() {
            return Ok(pool.clone());
        }
    }
    let workspace_id = read_active_workspace_from_json(app, state)?;
    let path = workspace_settings_path(app, state, &workspace_id)?;
    let pool = crate::db::open_pool(&path)?;
    let mut guard = state.db.settings.lock().map_err(to_error)?;
    if guard.is_some() {
        return Ok(guard.as_ref().unwrap().clone());
    }
    *guard = Some(pool.clone());
    Ok(pool)
}

/// Swap the active settings pool to a different workspace's database.
pub(crate) fn swap_settings_pool(
    app: &AppHandle,
    state: &AppState,
    workspace_id: &str,
) -> Result<(), String> {
    let path = workspace_settings_path(app, state, workspace_id)?;
    let pool = crate::db::open_pool(&path)?;
    let mut guard = state.db.settings.lock().map_err(to_error)?;
    *guard = Some(pool);
    Ok(())
}

// ─── Workspace helpers ────────────────────────────────────────────────────────

pub(crate) const DEFAULT_WORKSPACE_ID: &str = "default";
pub(crate) const DEFAULT_WORKSPACE_NAME: &str = "Default";
pub(crate) const WORKSPACES_DIR: &str = "workspaces";
pub(crate) const WORKSPACES_JSON: &str = "workspaces.json";

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceInfo {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) created_at: String,
}

/// Internal shape of workspaces.json
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacesJson {
    #[serde(default = "default_workspace_id")]
    active_workspace: String,
    #[serde(default)]
    workspaces: Vec<WorkspaceInfo>,
}

fn default_workspace_id() -> String {
    DEFAULT_WORKSPACE_ID.to_string()
}

/// Path to the workspaces.json registry file at the app root.
pub(crate) fn workspaces_json_path(app: &AppHandle, state: &AppState) -> Result<PathBuf, String> {
    Ok(app_storage_dir(app, state)?.join(WORKSPACES_JSON))
}

/// Root directory for workspace data (app_data_dir/workspaces).
pub(crate) fn workspace_root(app: &AppHandle, state: &AppState) -> Result<PathBuf, String> {
    Ok(app_storage_dir(app, state)?.join(WORKSPACES_DIR))
}

/// Path to a specific workspace's data.db.
pub(crate) fn workspace_data_path(
    app: &AppHandle,
    state: &AppState,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    Ok(workspace_root(app, state)?
        .join(workspace_id)
        .join("data.db"))
}

/// Path to a specific workspace's settings.db.
pub(crate) fn workspace_settings_path(
    app: &AppHandle,
    state: &AppState,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    Ok(workspace_root(app, state)?
        .join(workspace_id)
        .join("settings.db"))
}

// ─── Workspace registry (workspaces.json) ─────────────────────────────────────

fn read_workspaces_json(app: &AppHandle, state: &AppState) -> Result<WorkspacesJson, String> {
    let path = workspaces_json_path(app, state)?;
    if !path.exists() {
        return Ok(WorkspacesJson {
            active_workspace: default_workspace_id(),
            workspaces: vec![],
        });
    }
    let text = fs::read_to_string(&path).map_err(to_error)?;
    let data: WorkspacesJson = serde_json::from_str(&text).map_err(to_error)?;
    Ok(data)
}

fn write_workspaces_json(
    app: &AppHandle,
    state: &AppState,
    data: &WorkspacesJson,
) -> Result<(), String> {
    let path = workspaces_json_path(app, state)?;
    let json = serde_json::to_string_pretty(data).map_err(to_error)?;
    fs::write(&path, format!("{json}\n")).map_err(to_error)
}

/// Read the active workspace ID from workspaces.json.
pub(crate) fn current_workspace_id(app: &AppHandle, state: &AppState) -> Result<String, String> {
    let data = read_workspaces_json(app, state)?;
    Ok(data.active_workspace)
}

/// Read the workspace registry from workspaces.json.
pub(crate) fn load_workspace_registry(
    app: &AppHandle,
    state: &AppState,
) -> Result<Vec<WorkspaceInfo>, String> {
    let data = read_workspaces_json(app, state)?;
    Ok(data.workspaces)
}

/// Save the workspace registry to workspaces.json.
pub(crate) fn save_workspace_registry(
    app: &AppHandle,
    state: &AppState,
    list: &[WorkspaceInfo],
) -> Result<(), String> {
    let mut data = read_workspaces_json(app, state)?;
    data.workspaces = list.to_vec();
    write_workspaces_json(app, state, &data)
}

/// Save the active workspace ID to workspaces.json.
pub(crate) fn save_active_workspace_id(
    app: &AppHandle,
    state: &AppState,
    id: &str,
) -> Result<(), String> {
    let mut data = read_workspaces_json(app, state)?;
    data.active_workspace = id.to_string();
    write_workspaces_json(app, state, &data)
}

/// Read the active workspace ID directly from workspaces.json (no pool needed).
pub(crate) fn read_active_workspace_from_json(
    app: &AppHandle,
    state: &AppState,
) -> Result<String, String> {
    current_workspace_id(app, state)
}

pub(crate) fn get_settings_value(app: &AppHandle, state: &AppState, key: &str) -> Option<Value> {
    let pool = settings_pool(app, state).ok()?;
    let raw = crate::db::db_get(&pool, key).ok()??;
    serde_json::from_str(&raw).ok()
}

pub(crate) fn app_encryption_manifest_path(
    app: &AppHandle,
    state: &AppState,
) -> Result<PathBuf, String> {
    Ok(app_storage_dir(app, state)?.join("app-crypto/manifest.v2.json"))
}

pub(crate) fn path_for_name(
    app: &AppHandle,
    state: &AppState,
    name: &str,
) -> Result<PathBuf, String> {
    match name {
        "userData" => app_storage_dir(app, state),
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

fn asset_roots(app_dir: &Path) -> [PathBuf; 2] {
    [app_dir.join("notes-assets"), app_dir.join("file-assets")]
}

pub(crate) fn is_local_asset_path(app: &AppHandle, target_path: &Path) -> bool {
    let state = app.state::<AppState>();
    let Ok(app_dir) = app_storage_dir(app, state.inner()) else {
        return false;
    };
    asset_roots(&app_dir)
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
    let base = app_storage_dir(app, state.inner())?.join(root_name);
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

pub(crate) fn keyring_entry(account: &str) -> Result<Entry, String> {
    Entry::new(SAFE_STORAGE_SERVICE, account).map_err(to_error)
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
    for key in ["syncPath", "defaultPath", "default-path"] {
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
        app_storage_dir(app, state)?,
        app.path().temp_dir().map_err(to_error)?,
    ];

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
