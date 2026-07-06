import { Plugin } from './Plugin';
import {
  PluginDuplicateError,
  PluginLoadError,
  PluginBusyError,
  PluginUpdateError,
} from './PluginError';
import { CoreAccess } from './CoreAccess';
import { ConflictRegistry } from './ConflictRegistry';
import { loadBeaxFile, evaluatePlugin, evaluateSettings } from './PluginLoader';
import { compare as semverCompare } from './semver';

import { backend } from '@/lib/tauri-bridge';
import { getAppInfo } from '@/lib/native/app';

import { createPluginAPI } from './PluginAPI';

const ICON_MIME_BY_MAGIC = new Map([
  ['89504e47', 'image/png'],
  ['47494638', 'image/gif'],
  ['ffd8ff', 'image/jpeg'],
]);

function detectIconMime(bytes, fileName) {
  if (bytes && bytes.length >= 4) {
    const hex = Array.from(bytes.slice(0, 4))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    for (const [magic, mime] of ICON_MIME_BY_MAGIC) {
      if (hex.startsWith(magic)) return mime;
    }
    const firstBytes = hex.slice(0, 8);
    if (firstBytes === '52494646' && hex.slice(12, 16) === '574542') {
      return 'image/webp';
    }
    if (bytes.length >= 5) {
      const head = new TextDecoder().decode(bytes.slice(0, 5)).trimStart();
      if (head.startsWith('<') || head.startsWith('<svg'))
        return 'image/svg+xml';
    }
  }
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const extMap = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      ico: 'image/x-icon',
      bmp: 'image/bmp',
    };
    if (extMap[ext]) return extMap[ext];
  }
  return 'image/png';
}

class PluginManager {
  constructor() {
    this._plugins = new Map();
    this._busy = new Set();
    this._blockedIds = new Set();
  }

  _acquireBusy(pluginId, operation) {
    if (this._busy.has(pluginId)) {
      throw new PluginBusyError(pluginId, operation);
    }
    this._busy.add(pluginId);
  }

  _releaseBusy(pluginId) {
    this._busy.delete(pluginId);
  }

  isBlocked(pluginId) {
    return this._blockedIds.has(pluginId);
  }

  setBlocked(pluginId, blocked) {
    if (blocked) {
      this._blockedIds.add(pluginId);
    } else {
      this._blockedIds.delete(pluginId);
    }
  }

  get plugins() {
    return this._plugins;
  }

  get(id) {
    return this._plugins.get(id) || null;
  }

  has(id) {
    return this._plugins.has(id);
  }

  list() {
    return [...this._plugins.values()].map((p) => p.serialize());
  }

  getActive() {
    return [...this._plugins.values()]
      .filter((p) => p.isActive)
      .map((p) => p.serialize());
  }

  async previewFromBeax(arrayBuffer) {
    const { manifest, sourceCode, settingsSource, iconBuffer } =
      await loadBeaxFile(arrayBuffer);

    const existingPlugin = this._plugins.get(manifest.id);
    const declaredPermissions = manifest.permissions || [];

    let newPermissions = [];
    if (existingPlugin) {
      const oldPerms = new Set(existingPlugin.manifest.permissions || []);
      newPermissions = declaredPermissions.filter((p) => !oldPerms.has(p));
    }

    return {
      manifest,
      declaredPermissions,
      newPermissions,
      isUpdate: !!existingPlugin,
      existingVersion: existingPlugin ? existingPlugin.manifest.version : null,
      existingActive: existingPlugin ? existingPlugin.isActive : false,
    };
  }

  async installFromBeax(arrayBuffer, allowReplace, userGrants) {
    const { manifest, sourceCode, settingsSource, iconBuffer } =
      await loadBeaxFile(arrayBuffer);

    const existingPlugin = this._plugins.get(manifest.id);

    if (existingPlugin && !allowReplace) {
      throw new PluginDuplicateError(manifest.id);
    }

    if (existingPlugin) {
      const cmp = semverCompare(
        manifest.version,
        existingPlugin.manifest.version
      );
      if (cmp <= 0) {
        throw new PluginUpdateError(
          manifest.id,
          `Installed version ${existingPlugin.manifest.version} is >= ${manifest.version}`
        );
      }
    }

    let iconData = null;
    if (iconBuffer) {
      const bytes = new Uint8Array(iconBuffer);
      const mime = detectIconMime(bytes, manifest.icon);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      iconData = `data:${mime};base64,` + btoa(binary);
    }

    const wasActive = existingPlugin?.isActive || false;

    if (existingPlugin && existingPlugin.isActive) {
      try {
        await this.deactivate(manifest.id);
      } catch (e) {
        console.error(
          `[PluginManager] Failed to deactivate "${manifest.id}" before update:`,
          e
        );
      }
    }

    if (existingPlugin) {
      ConflictRegistry.clearPlugin(manifest.id);
      this._plugins.delete(manifest.id);
    }

    const pluginData = {
      sourceCode,
      settingsSource,
      iconUrl: iconData,
      userGrants: userGrants || existingPlugin?._data?.userGrants || null,
    };

    const plugin = new Plugin(manifest, pluginData);
    this._plugins.set(manifest.id, plugin);

    try {
      await this._persistInstalledPlugin(manifest, pluginData);
    } catch (e) {
      console.error(
        `[PluginManager] Failed to persist plugin "${manifest.id}":`,
        e
      );
    }

    if (wasActive) {
      try {
        this.initAPI(manifest.id);
        await this.activate(manifest.id, pluginData.userGrants);
      } catch (e) {
        console.error(
          `[PluginManager] Failed to re-activate "${manifest.id}" after update:`,
          e
        );
      }
    }

    return plugin.serialize();
  }

  async loadFromManifest(manifest, pluginData) {
    const plugin = new Plugin(manifest, {
      ...pluginData,
      sourceCode: pluginData.sourceCode || '',
      settingsSource: pluginData.settingsSource || null,
      iconUrl: pluginData.iconUrl || null,
      userGrants: pluginData.userGrants || null,
    });

    this._plugins.set(manifest.id, plugin);
    return plugin;
  }

  async activate(pluginId, userApprovedPerms) {
    const plugin = this._plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);

    if (this.isBlocked(pluginId)) {
      throw new Error(`Plugin "${pluginId}" has been blocked by the developer`);
    }

    this._acquireBusy(pluginId, 'activate');

    try {
      const manifest = plugin.manifest;

      if (manifest.minAppVersion) {
        let appVersion = '0.0.0';
        try {
          const info = await getAppInfo();
          appVersion = info.version || '0.0.0';
        } catch {
          console.warn(
            `[PluginManager] Could not read app version; assuming 0.0.0`
          );
        }
        if (semverCompare(appVersion, manifest.minAppVersion) < 0) {
          throw new Error(
            `Plugin "${pluginId}" requires app version >= ${manifest.minAppVersion} (current: ${appVersion})`
          );
        }
      }

      CoreAccess.register(pluginId, plugin.manifest, userApprovedPerms);

      const beaverNotes = plugin._data._api;
      if (!beaverNotes) {
        throw new Error('Plugin API not initialized');
      }

      let exports;
      try {
        exports = await evaluatePlugin(beaverNotes, plugin._data.sourceCode);
      } catch (e) {
        CoreAccess.unregister(pluginId);
        throw new PluginLoadError(pluginId, e.message || 'Unknown error', e);
      }

      plugin._exports = exports;
      plugin._beaverNotes = beaverNotes;

      try {
        exports.setup(beaverNotes);
        beaverNotes._fireActivate();
      } catch (e) {
        try {
          plugin._beaverNotes?._destroy?.();
        } catch (cleanupError) {
          console.error(
            `[PluginManager] Cleanup after failed activate for "${pluginId}":`,
            cleanupError
          );
        }
        CoreAccess.unregister(pluginId);
        plugin._beaverNotes = null;
        plugin._exports = null;
        plugin.state = 'error';
        plugin.error = e.message || String(e);
        plugin.enabled = false;
        throw new PluginLoadError(pluginId, e.message || 'Unknown error', e);
      }

      plugin.enabled = true;
      plugin.state = 'active';
      plugin.error = null;
    } finally {
      this._releaseBusy(pluginId);
    }

    return plugin.serialize();
  }

  async deactivate(pluginId) {
    const plugin = this._plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);

    this._acquireBusy(pluginId, 'deactivate');

    try {
      if (plugin._beaverNotes) {
        try {
          plugin._beaverNotes._fireDeactivate();
          plugin._beaverNotes._destroy();
        } catch (e) {
          console.error(`[PluginManager] Error deactivating "${pluginId}":`, e);
        }
      }

      CoreAccess.unregister(pluginId);
      ConflictRegistry.clearPlugin(pluginId);

      plugin._beaverNotes = null;
      plugin._exports = null;
      plugin._settingsFn = null;
      plugin.state = 'inactive';
      plugin.enabled = false;
    } finally {
      this._releaseBusy(pluginId);
    }

    return plugin.serialize();
  }

  async uninstall(pluginId) {
    this._acquireBusy(pluginId, 'uninstall');

    try {
      const plugin = this._plugins.get(pluginId);
      if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);

      if (plugin.isActive) {
        await this.deactivate(pluginId);
      }

      this._plugins.delete(pluginId);
      this._blockedIds.delete(pluginId);

      try {
        await backend.invoke('plugin:uninstall', { pluginId });
      } catch (e) {
        console.error(`[PluginManager] Failed to remove plugin files:`, e);
      }
    } finally {
      this._releaseBusy(pluginId);
    }
  }

  initAPI(pluginId) {
    const plugin = this._plugins.get(pluginId);
    if (!plugin) return null;

    if (!plugin._data._api) {
      plugin._data._api = createPluginAPI(
        pluginId,
        plugin.manifest,
        plugin.manifest.storageSchemaVersion
      );
    }

    return plugin._data._api;
  }

  async loadSettings(pluginId) {
    const plugin = this._plugins.get(pluginId);
    if (!plugin) return null;

    if (plugin._settingsFn) return plugin._settingsFn;

    if (plugin._data.settingsSource) {
      try {
        plugin._settingsFn = await evaluateSettings(
          plugin._data.settingsSource,
          pluginId,
          plugin.manifest
        );
        return plugin._settingsFn;
      } catch (e) {
        console.error(
          `[PluginManager] Failed to evaluate settings for "${pluginId}":`,
          e
        );
        return null;
      }
    }

    return null;
  }

  async loadAllFromDisk() {
    try {
      const installed = await backend.invoke('plugin:list');
      if (!installed || !Array.isArray(installed)) return [];

      for (const entry of installed) {
        const manifest = entry.manifest;
        if (!manifest || !manifest.id) continue;

        let sourceCode = '';
        let settingsSource = null;
        let iconUrl = null;
        let userGrants = null;

        try {
          sourceCode = entry.sourceCode || '';
          settingsSource = entry.settingsSource || null;
          iconUrl = entry.iconUrl || null;
          userGrants = entry.userGrants || null;
        } catch (e) {
          console.error(
            `[PluginManager] Failed to read plugin files for "${manifest.id}":`,
            e
          );
          continue;
        }

        await this.loadFromManifest(manifest, {
          sourceCode,
          settingsSource,
          iconUrl,
          userGrants,
        });

        if (entry.enabled) {
          try {
            this.initAPI(manifest.id);
            await this.activate(manifest.id, userGrants);
          } catch (e) {
            console.error(
              `[PluginManager] Failed to activate "${manifest.id}":`,
              e
            );
          }
        }
      }
    } catch (e) {
      console.error('[PluginManager] Failed to load plugins from disk:', e);
    }
  }

  async _persistInstalledPlugin(manifest, pluginData) {
    try {
      await backend.invoke('plugin:install', {
        pluginId: manifest.id,
        manifest: JSON.stringify(manifest),
        sourceCode: pluginData.sourceCode,
        settingsSource: pluginData.settingsSource || '',
        iconUrl: pluginData.iconUrl || '',
      });
    } catch (e) {
      console.error(
        `[PluginManager] Failed to persist plugin "${manifest.id}":`,
        e
      );
    }
  }

  async _persistUserGrants(pluginId, permissions) {
    try {
      await backend.invoke('plugin:set-grants', {
        pluginId,
        grants: permissions,
      });
    } catch (e) {
      console.error(
        `[PluginManager] Failed to persist grants for "${pluginId}":`,
        e
      );
    }
  }
}

const pluginManager = new PluginManager();

export default pluginManager;
