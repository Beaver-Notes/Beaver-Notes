use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

use crate::shared::{allowed_blob_key, safe_storage_decrypt_bytes, safe_storage_encrypt_bytes, to_error, AppState};

#[derive(Default)]
pub(crate) struct SecureBlobCache {
    memory: Mutex<HashMap<String, Vec<u8>>>,
    disk_lock: Mutex<()>,
}

#[derive(Default, Serialize, Deserialize)]
struct SecureBlobsDisk {
    #[serde(default)]
    blobs: HashMap<String, String>,
}

impl SecureBlobCache {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn store_blob(
        &self,
        state: &AppState,
        key: &str,
        value: Vec<u8>,
    ) -> Result<(), String> {
        allowed_blob_key(key)?;

        self.memory
            .lock()
            .map_err(to_error)?
            .insert(key.to_string(), value.clone());

        // Best-effort: keep OS keyring copy when available.
        if let Ok(entry) = crate::shared::keyring_entry(key) {
            if let Ok(as_string) = String::from_utf8(value.clone()) {
                let _ = entry.set_password(&as_string);
            }
        }

        // Fallback: write an encrypted copy to disk so safe-storage works even without keyring.
        let encrypted = safe_storage_encrypt_bytes(&value)?;
        let _guard = self.disk_lock.lock().map_err(to_error)?;
        let mut disk = self.read_disk(state)?;
        disk.blobs.insert(key.to_string(), encrypted);
        self.write_disk(state, &disk)
    }

    pub(crate) fn fetch_blob(&self, state: &AppState, key: &str) -> Result<Option<Vec<u8>>, String> {
        allowed_blob_key(key)?;

        if let Some(value) = self
            .memory
            .lock()
            .map_err(to_error)?
            .get(key)
            .cloned()
        {
            return Ok(Some(value));
        }

        if let Ok(entry) = crate::shared::keyring_entry(key) {
            if let Ok(value) = entry.get_password() {
                let bytes = value.into_bytes();
                self.memory
                    .lock()
                    .map_err(to_error)?
                    .insert(key.to_string(), bytes.clone());
                return Ok(Some(bytes));
            }
        }

        let _guard = self.disk_lock.lock().map_err(to_error)?;
        let disk = self.read_disk(state)?;
        let Some(encrypted) = disk.blobs.get(key) else {
            return Ok(None);
        };
        let bytes = safe_storage_decrypt_bytes(encrypted)?;
        self.memory
            .lock()
            .map_err(to_error)?
            .insert(key.to_string(), bytes.clone());
        Ok(Some(bytes))
    }

    pub(crate) fn clear_blob(&self, state: &AppState, key: &str) -> Result<(), String> {
        allowed_blob_key(key)?;

        let _ = self
            .memory
            .lock()
            .map_err(to_error)?
            .remove(key);

        if let Ok(entry) = crate::shared::keyring_entry(key) {
            let _ = entry.delete_password();
        }

        let _guard = self.disk_lock.lock().map_err(to_error)?;
        let mut disk = self.read_disk(state)?;
        disk.blobs.remove(key);
        self.write_disk(state, &disk)
    }

    fn storage_dir(state: &AppState) -> Result<PathBuf, String> {
        if let Some(ref dir) = state.portable_storage_dir {
            return Ok(dir.clone());
        }
        Ok(dirs::data_local_dir()
            .ok_or_else(|| "Cannot determine data directory".to_string())?
            .join("com.beaver-notes.beaver-notes")
            .into())
    }

    fn storage_path(state: &AppState) -> Result<PathBuf, String> {
        Ok(Self::storage_dir(state)?.join("secure_blobs.json"))
    }

    fn read_disk(&self, state: &AppState) -> Result<SecureBlobsDisk, String> {
        let path = Self::storage_path(state)?;
        if !path.exists() {
            return Ok(SecureBlobsDisk::default());
        }
        let raw = fs::read_to_string(&path).map_err(to_error)?;
        serde_json::from_str::<SecureBlobsDisk>(&raw).map_err(to_error)
    }

    fn write_disk(&self, state: &AppState, disk: &SecureBlobsDisk) -> Result<(), String> {
        let dir = Self::storage_dir(state)?;
        fs::create_dir_all(&dir).map_err(to_error)?;
        let path = dir.join("secure_blobs.json");
        let payload = serde_json::to_string(disk).map_err(to_error)?;
        fs::write(&path, payload).map_err(to_error)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
            let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
        }
        Ok(())
    }
}
