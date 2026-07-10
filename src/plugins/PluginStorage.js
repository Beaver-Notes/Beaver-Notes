import { useStorage } from '@/composable/storage';
import { PluginStorageError } from './PluginError';

const PLUGIN_STORE_NAME = 'plugin-storage';
const _storage = useStorage(PLUGIN_STORE_NAME);
const MAX_BYTES = 5 * 1024 * 1024;

export function createPluginStorage(pluginId, storageSchemaVersion) {
  const prefix = `plugin:${pluginId}:`;
  const versions =
    storageSchemaVersion && typeof storageSchemaVersion === 'number'
      ? String(storageSchemaVersion)
      : null;

  async function getUsage() {
    try {
      const store = await _storage.store();
      if (!store) return 0;
      let total = 0;
      for (const key of Object.keys(store)) {
        if (key.startsWith(prefix)) {
          total += JSON.stringify(store[key]).length;
        }
      }
      return total;
    } catch {
      return 0;
    }
  }

  async function checkQuota(newValueSize) {
    const current = await getUsage();
    if (current + newValueSize > MAX_BYTES) {
      throw new PluginStorageError(
        pluginId,
        `storage quota exceeded (${(MAX_BYTES / 1024 / 1024).toFixed(1)} MB)`
      );
    }
  }

  return {
    async get(key, defaultValue) {
      try {
        const val = await _storage.get(prefix + key);
        return val !== null && val !== undefined ? val : defaultValue;
      } catch {
        return defaultValue;
      }
    },

    getSync(key, defaultValue) {
      return defaultValue;
    },

    async set(key, value) {
      const valueSize = JSON.stringify(value).length;
      await checkQuota(valueSize);
      return _storage.set(prefix + key, value);
    },

    async delete(key) {
      return _storage.delete(prefix + key);
    },

    async clear() {
      const store = await _storage.store();
      if (!store) return;

      const pluginKeys = Object.keys(store).filter((k) => k.startsWith(prefix));
      for (const key of pluginKeys) {
        await _storage.delete(key);
      }
    },

    async keys() {
      const store = await _storage.store();
      if (!store) return [];

      return Object.keys(store)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length));
    },

    async has(key) {
      return _storage.has(prefix + key);
    },

    async all() {
      const store = await _storage.store();
      if (!store) return {};

      const result = {};
      const pluginKeys = Object.keys(store).filter((k) => k.startsWith(prefix));
      for (const key of pluginKeys) {
        result[key.slice(prefix.length)] = store[key];
      }
      return result;
    },

    async usage() {
      const bytes = await getUsage();
      return { bytes, maxBytes: MAX_BYTES, percent: (bytes / MAX_BYTES) * 100 };
    },

    async getDataVersion() {
      if (!versions) return 1;
      try {
        const val = await _storage.get(prefix + '__schema');
        return val !== null && val !== undefined ? Number(val) : 1;
      } catch {
        return 1;
      }
    },

    async setDataVersion(version) {
      if (!versions) return;
      await _storage.set(prefix + '__schema', version);
    },

    async needsMigration() {
      if (!versions) return false;
      const current = await this.getDataVersion();
      return current < Number(versions);
    },
  };
}
