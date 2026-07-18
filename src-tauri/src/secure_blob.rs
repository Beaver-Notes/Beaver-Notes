use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

use crate::shared::{allowed_blob_key, safe_storage_decrypt_bytes, safe_storage_encrypt_bytes, AppError, AppState};

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
    ) -> Result<(), AppError> {
        allowed_blob_key(key)?;

        self.memory
            .lock()?
            .insert(key.to_string(), value.clone());

        // Best-effort: keep OS keyring copy when available.
        if let Ok(entry) = crate::shared::keyring_entry(key) {
            if let Ok(as_string) = String::from_utf8(value.clone()) {
                let _ = entry.set_password(&as_string);
            }
        }

        // Fallback: write an encrypted copy to disk so safe-storage works even without keyring.
        let encrypted = safe_storage_encrypt_bytes(&value)?;
        let _guard = self.disk_lock.lock()?;
        let mut disk = self.read_disk(state)?;
        disk.blobs.insert(key.to_string(), encrypted);
        self.write_disk(state, &disk)
    }

    pub(crate) fn fetch_blob(&self, state: &AppState, key: &str) -> Result<Option<Vec<u8>>, AppError> {
        allowed_blob_key(key)?;

        if let Some(value) = self
            .memory
            .lock()?
            .get(key)
            .cloned()
        {
            return Ok(Some(value));
        }

        if let Ok(entry) = crate::shared::keyring_entry(key) {
            if let Ok(value) = entry.get_password() {
                let bytes = value.into_bytes();
                self.memory
                    .lock()?
                    .insert(key.to_string(), bytes.clone());
                return Ok(Some(bytes));
            }
        }

        let _guard = self.disk_lock.lock()?;
        let disk = self.read_disk(state)?;
        let Some(encrypted) = disk.blobs.get(key) else {
            return Ok(None);
        };
        let bytes = safe_storage_decrypt_bytes(encrypted)?;
                self.memory
                    .lock()?
                    .insert(key.to_string(), bytes.clone());
        Ok(Some(bytes))
    }

    pub(crate) fn clear_blob(&self, state: &AppState, key: &str) -> Result<(), AppError> {
        allowed_blob_key(key)?;

        let _ = self
            .memory
            .lock()?
            .remove(key);

        if let Ok(entry) = crate::shared::keyring_entry(key) {
            let _ = entry.delete_password();
        }

        let _guard = self.disk_lock.lock()?;
        let mut disk = self.read_disk(state)?;
        disk.blobs.remove(key);
        self.write_disk(state, &disk)
    }

    fn storage_dir(state: &AppState) -> Result<PathBuf, AppError> {
        if let Some(ref dir) = state.portable_storage_dir {
            return Ok(dir.clone());
        }
        Ok(dirs::data_local_dir()
            .ok_or_else(|| AppError::Other("Cannot determine data directory".into()))?
            .join("com.beaver-notes.beaver-notes")
            .into())
    }

    fn storage_path(state: &AppState) -> Result<PathBuf, AppError> {
        Ok(Self::storage_dir(state)?.join("secure_blobs.json"))
    }

    fn read_disk(&self, state: &AppState) -> Result<SecureBlobsDisk, AppError> {
        let path = Self::storage_path(state)?;
        if !path.exists() {
            return Ok(SecureBlobsDisk::default());
        }
        let raw = fs::read_to_string(&path)?;
        Ok(serde_json::from_str::<SecureBlobsDisk>(&raw)?)
    }

    fn write_disk(&self, state: &AppState, disk: &SecureBlobsDisk) -> Result<(), AppError> {
        let dir = Self::storage_dir(state)?;
        fs::create_dir_all(&dir)?;
        let path = dir.join("secure_blobs.json");
        let payload = serde_json::to_string(disk)?;
        fs::write(&path, payload)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
            let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
        }
        Ok(())
    }
}
