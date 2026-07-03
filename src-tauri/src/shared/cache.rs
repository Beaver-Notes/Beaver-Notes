use lru::LruCache;
use std::num::NonZero;

use super::AppState;

pub(crate) const NOTE_CACHE_BYTES: usize = 64 * 1024 * 1024;
pub(crate) const ASSET_CACHE_BYTES: usize = 128 * 1024 * 1024;

pub(crate) struct ByteLruCache {
    inner: LruCache<String, Vec<u8>>,
    current_bytes: usize,
    max_bytes: usize,
}

impl ByteLruCache {
    pub(crate) fn new(max_bytes: usize) -> Self {
        let max_entries = NonZero::new(1024).unwrap();
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
