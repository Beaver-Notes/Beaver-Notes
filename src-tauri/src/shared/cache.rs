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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_then_get_hits() {
        let mut cache = ByteLruCache::new(1024);
        cache.put("a".to_string(), vec![1, 2, 3]);
        assert_eq!(cache.get("a"), Some(&vec![1, 2, 3]));
    }

    #[test]
    fn get_missing_key_returns_none() {
        let mut cache = ByteLruCache::new(1024);
        assert_eq!(cache.get("absent"), None);
    }

    #[test]
    fn single_oversized_value_is_still_inserted_and_retained() {
        // The current implementation cannot evict an oversized entry that is the
        // sole occupant (the eviction loop is skipped when `inner` is empty), so a
        // value larger than `max_bytes` is stored verbatim. This pins today's
        // behavior for the Task 10 refactor.
        let mut cache = ByteLruCache::new(4);
        cache.put("big".to_string(), vec![1, 2, 3, 4, 5, 6]);
        assert_eq!(cache.get("big"), Some(&vec![1, 2, 3, 4, 5, 6]));
    }

    #[test]
    fn put_of_same_key_updates_value() {
        let mut cache = ByteLruCache::new(1024);
        cache.put("k".to_string(), vec![1, 2, 3]);
        cache.put("k".to_string(), vec![4, 5, 6, 7]);
        assert_eq!(cache.get("k"), Some(&vec![4, 5, 6, 7]));
        assert_eq!(cache.get("missing"), None);
    }

    #[test]
    fn byte_limit_evicts_least_recently_used() {
        let mut cache = ByteLruCache::new(10);
        cache.put("a".to_string(), vec![0u8; 4]);
        cache.put("b".to_string(), vec![0u8; 4]);
        cache.get("a");
        cache.put("c".to_string(), vec![0u8; 4]);

        assert_eq!(cache.get("a"), Some(&vec![0u8; 4]), "a was promoted, should survive");
        assert_eq!(cache.get("b"), None, "b was LRU, should have been evicted");
        assert_eq!(cache.get("c"), Some(&vec![0u8; 4]), "c was just inserted, should survive");
    }

    #[test]
    fn clear_removes_all_entries() {
        let mut cache = ByteLruCache::new(1024);
        cache.put("a".to_string(), vec![1]);
        cache.put("b".to_string(), vec![2]);
        cache.clear();
        assert_eq!(cache.get("a"), None);
        assert_eq!(cache.get("b"), None);
    }
}
