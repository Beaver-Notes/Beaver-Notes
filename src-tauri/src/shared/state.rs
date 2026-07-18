use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex, RwLock},
    time::SystemTime,
};

use super::*;

/// UI presentation preferences, persisted across sessions via settings.
pub(crate) struct UiState {
    pub(crate) zoom_level: Mutex<f64>,
    pub(crate) reduced_motion: Mutex<bool>,
    pub(crate) high_contrast: Mutex<bool>,
}

impl UiState {
    pub(crate) fn new() -> Self {
        Self {
            zoom_level: Mutex::new(1.0),
            reduced_motion: Mutex::new(false),
            high_contrast: Mutex::new(false),
        }
    }
}

/// App-encryption security bookkeeping: lockout state and the transient
/// passphrase used during migration before the main key is restored.
pub(crate) struct SecurityState {
    pub(crate) failure_count: Mutex<u32>,
    /// When set, app-encryption unlock is rate-limited until this instant.
    pub(crate) lockout_until: Mutex<Option<SystemTime>>,
    pub(crate) granted_paths: Arc<Mutex<HashSet<PathBuf>>>,
    pub(crate) transient_passphrase: Mutex<String>,
}

impl SecurityState {
    pub(crate) fn new() -> Self {
        Self {
            failure_count: Mutex::new(0),
            lockout_until: Mutex::new(None),
            granted_paths: Arc::new(Mutex::new(HashSet::new())),
            transient_passphrase: Mutex::new(String::new()),
        }
    }
}

/// All app-encryption session state, behind one lock (see `CryptoSession`).
pub(crate) struct CryptoState {
    pub(crate) session: RwLock<CryptoSession>,
    pub(crate) asset_key_cache: Mutex<Option<[u8; 32]>>,
}

impl CryptoState {
    pub(crate) fn new() -> Self {
        Self {
            session: RwLock::new(CryptoSession::default()),
            asset_key_cache: Mutex::new(None),
        }
    }
}

/// Decrypted byte caches for notes and assets, plus the secure blob cache.
pub(crate) struct CacheState {
    pub(crate) decrypted_notes_cache: Mutex<ByteLruCache>,
    pub(crate) decrypted_assets_cache: Mutex<ByteLruCache>,
    pub(crate) secure_blobs: SecureBlobCache,
}

impl CacheState {
    pub(crate) fn new() -> Self {
        Self {
            decrypted_notes_cache: Mutex::new(ByteLruCache::new(NOTE_CACHE_BYTES)),
            decrypted_assets_cache: Mutex::new(ByteLruCache::new(ASSET_CACHE_BYTES)),
            secure_blobs: SecureBlobCache::new(),
        }
    }
}

/// Filesystem paths and handles for external/open-file tracking.
pub(crate) struct FileState {
    pub(crate) pending_open_files: Arc<Mutex<Vec<String>>>,
    pub(crate) external_open_files: Arc<Mutex<HashMap<PathBuf, PathBuf>>>,
    pub(crate) asset_cache_dir: PathBuf,
    pub(crate) external_open_dir: PathBuf,
    pub(crate) portable_storage_dir: Option<PathBuf>,
}

impl FileState {
    pub(crate) fn new(
        asset_cache_dir: PathBuf,
        external_open_dir: PathBuf,
        portable_storage_dir: Option<PathBuf>,
    ) -> Self {
        Self {
            pending_open_files: Arc::new(Mutex::new(Vec::new())),
            external_open_files: Arc::new(Mutex::new(HashMap::new())),
            asset_cache_dir,
            external_open_dir,
            portable_storage_dir,
        }
    }
}
