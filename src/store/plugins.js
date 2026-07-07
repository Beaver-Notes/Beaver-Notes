import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import pluginManager from '@/plugins/PluginManager';
import { CoreAccess } from '@/plugins/CoreAccess';
import emitter from 'tiny-emitter/instance';
import { fetch as platformFetch } from '@tauri-apps/plugin-http';

function hex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Digest(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return hex(hash);
}

const pagesUrl =
  'https://beaver-notes.github.io/beaver-notes-plugin-registry/plugins.json';
const rawUrl =
  'https://raw.githubusercontent.com/Beaver-Notes/beaver-notes-plugin-registry/main/plugins.json';

export const usePluginStore = defineStore('plugins', () => {
  const installedPlugins = ref([]);
  const pluginExtensions = ref([]);
  const pluginSlashCommands = ref([]);
  const pluginAppCommands = ref([]);
  const pluginToolbarItems = ref([]);
  const loaded = ref(false);
  const extensionsVersion = ref(0);

  async function fetchFromRegistry() {
    for (const url of [pagesUrl, rawUrl]) {
      try {
        const res = await platformFetch(url);
        if (res.ok) return await res.json();
      } catch {}
    }
    console.error('[PluginStore] Failed to fetch registry');
    return [];
  }

  async function installFromRegistry(pluginId) {
    const registry = await fetchFromRegistry();
    const entry = registry.find((p) => p.id === pluginId);
    if (!entry) {
      return installFromBeaxLegacy(pluginId);
    }

    const url = entry.download_url;
    if (!url) {
      return installFromBeaxLegacy(pluginId);
    }

    const res = await platformFetch(url);
    if (!res.ok) {
      console.warn(`[PluginStore] download_url failed (${res.status}), trying legacy`);
      return installFromBeaxLegacy(pluginId);
    }

    const buffer = await res.arrayBuffer();

    if (entry.sha256) {
      const hash = await sha256Digest(buffer);
      if (hash !== entry.sha256) {
        throw new Error(
          `SHA-256 mismatch for ${pluginId}: expected ${entry.sha256}, got ${hash}. ` +
            `The downloaded .beax may be corrupted or tampered with.`
        );
      }
      console.log(`[PluginStore] SHA-256 verified for ${pluginId}`);
    }

    return await installFromBeax(buffer, true);
  }

  async function installFromBeaxLegacy(pluginId) {
    const registry = await fetchFromRegistry();
    const entry = registry.find((p) => p.id === pluginId);
    if (!entry) throw new Error(`Plugin ${pluginId} not found in registry`);

    const { repo } = entry;
    const beaxUrl = `https://github.com/${repo}/releases/latest/download/plugin.beax`;
    const res = await platformFetch(beaxUrl);
    if (!res.ok) throw new Error(`Failed to download .beax from ${repo}`);
    const buffer = await res.arrayBuffer();
    return await installFromBeax(buffer, true);
  }

  const loading = ref(false);
  const error = ref(null);

  const activePlugins = computed(() =>
    installedPlugins.value.filter((p) => p.state === 'active')
  );

  const editorPlugins = computed(() =>
    installedPlugins.value.filter((p) => p.planes.includes('editor'))
  );

  const appPlugins = computed(() =>
    installedPlugins.value.filter((p) => p.planes.includes('app'))
  );

  function syncState() {
    installedPlugins.value = pluginManager.list();
  }

  async function init() {
    loading.value = true;
    error.value = null;
    try {
      await pluginManager.loadAllFromDisk();
      syncState();
      activateAllEnabled();
    } catch (e) {
      error.value = e.message || String(e);
      console.error('[PluginStore] Init error:', e);
    } finally {
      loading.value = false;
      loaded.value = true;
    }
  }

  async function previewFromBeax(arrayBuffer) {
    return pluginManager.previewFromBeax(arrayBuffer);
  }

  async function installFromBeax(arrayBuffer, allowReplace, userGrants) {
    const plugin = await pluginManager.installFromBeax(
      arrayBuffer,
      allowReplace,
      userGrants
    );
    syncState();
    return plugin;
  }

  async function activatePlugin(pluginId) {
    const plugin = pluginManager.get(pluginId);
    if (!plugin) return;
    const userGrants = plugin._data.userGrants || null;
    pluginManager.initAPI(pluginId);
    await pluginManager.activate(pluginId, userGrants);
    syncState();
  }

  async function deactivatePlugin(pluginId) {
    await pluginManager.deactivate(pluginId);
    syncState();
  }

  async function togglePlugin(pluginId) {
    const plugin = pluginManager.get(pluginId);
    if (!plugin) return;

    if (plugin.isActive) {
      await deactivatePlugin(pluginId);
    } else {
      await activatePlugin(pluginId);
    }
  }

  async function uninstallPlugin(pluginId) {
    await deactivatePlugin(pluginId).catch(() => {});
    await pluginManager.uninstall(pluginId);
    syncState();
  }

  async function activateAllEnabled() {
    for (const plugin of pluginManager.list()) {
      if (plugin.enabled && plugin.state !== 'active') {
        try {
          pluginManager.initAPI(plugin.id);
          await pluginManager.activate(plugin.id);
        } catch (e) {
          console.error(`[PluginStore] Failed to activate "${plugin.id}":`, e);
        }
      }
    }
    syncState();
  }

  setupEventListeners();

  function setupEventListeners() {
    emitter.on('plugin:register-extension', ({ pluginId, extension }) => {
      const existing = pluginExtensions.value.find(
        (e) => e._pluginId === pluginId && e === extension
      );
      if (!existing) {
        extension._pluginId = pluginId;
        pluginExtensions.value = [...pluginExtensions.value, extension];
        extensionsVersion.value++;
      }
    });

    emitter.on('plugin:unregister-extension', ({ pluginId }) => {
      const next = pluginExtensions.value.filter(
        (e) => e._pluginId !== pluginId
      );
      if (next.length !== pluginExtensions.value.length) {
        pluginExtensions.value = next;
        extensionsVersion.value++;
      }
    });

    emitter.on('plugin:register-slash-command', ({ pluginId, command }) => {
      pluginSlashCommands.value = [
        ...pluginSlashCommands.value,
        { ...command, pluginId },
      ];
    });

    emitter.on('plugin:unregister-slash-command', ({ pluginId }) => {
      pluginSlashCommands.value = pluginSlashCommands.value.filter(
        (cmd) => cmd.pluginId !== pluginId
      );
    });

    emitter.on('plugin:register-command', ({ pluginId, command }) => {
      pluginAppCommands.value = [
        ...pluginAppCommands.value,
        { ...command, pluginId },
      ];
    });

    emitter.on('plugin:unregister-command', ({ pluginId }) => {
      pluginAppCommands.value = pluginAppCommands.value.filter(
        (cmd) => cmd.pluginId !== pluginId
      );
    });

    emitter.on('plugin:register-toolbar-item', ({ pluginId, item }) => {
      const existing = pluginToolbarItems.value.find(
        (t) => t.id === item.id && t.pluginId === pluginId
      );
      if (!existing) {
        pluginToolbarItems.value = [
          ...pluginToolbarItems.value,
          { ...item, pluginId },
        ];
      }
    });

    emitter.on('plugin:unregister-toolbar-item', ({ pluginId }) => {
      pluginToolbarItems.value = pluginToolbarItems.value.filter(
        (item) => item.pluginId !== pluginId
      );
    });
  }

  function getPluginStore(pluginId) {
    return pluginManager.get(pluginId);
  }

  async function getPluginSettings(pluginId) {
    return pluginManager.loadSettings(pluginId);
  }

  function getPluginGrants(pluginId) {
    return CoreAccess.getEffectiveGrants(pluginId);
  }

  function getDeclaredPermissions(pluginId) {
    return CoreAccess.getDeclaredPermissions(pluginId);
  }

  async function setPluginGrants(pluginId, permissions) {
    CoreAccess.setUserGrants(pluginId, permissions);
    const plugin = pluginManager.get(pluginId);
    if (plugin) {
      plugin._data.userGrants = permissions;
      await pluginManager._persistUserGrants(pluginId, permissions);
    }
  }

  return {
    installedPlugins,
    pluginExtensions,
    pluginSlashCommands,
    pluginAppCommands,
    pluginToolbarItems,
    loading,
    loaded,
    extensionsVersion,
    error,
    activePlugins,
    editorPlugins,
    appPlugins,
    init,
    previewFromBeax,
    installFromBeax,
    activatePlugin,
    deactivatePlugin,
    togglePlugin,
    uninstallPlugin,
    syncState,
    getPluginStore,
    getPluginSettings,
    getPluginGrants,
    getDeclaredPermissions,
    setPluginGrants,
    fetchFromRegistry,
    installFromRegistry,
  };
});
