import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import pluginManager from '@/plugins/PluginManager';
import { CoreAccess } from '@/plugins/CoreAccess';
import emitter from 'tiny-emitter/instance';
import { fetch as platformFetch } from '@tauri-apps/plugin-http';

export const usePluginStore = defineStore('plugins', () => {
  const installedPlugins = ref([]);
  const pluginExtensions = ref([]);
  const pluginSlashCommands = ref([]);
  const pluginAppCommands = ref([]);
  const pluginToolbarItems = ref([]);
  const loaded = ref(false);
  const extensionsVersion = ref(0);
  const storeUrl =
    'https://raw.githubusercontent.com/Beaver-Notes/beaver-notes-plugin-registry/main/plugins.json';

  async function fetchFromRegistry() {
    try {
      const res = await platformFetch(storeUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.error('[PluginStore] Failed to fetch registry:', e);
      return [];
    }
  }

  async function installFromGitHub(repo, branch, pluginId) {
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    const res = await platformFetch(apiUrl);
    if (res.ok) {
      const release = await res.json();
      const asset = release.assets.find((a) => a.name.endsWith('.beax'));
      if (asset) {
        const downloadUrl = `https://api.github.com/repos/${repo}/releases/assets/${asset.id}`;
        const dlRes = await platformFetch(downloadUrl, {
          headers: { Accept: 'application/octet-stream' },
        });
        if (dlRes.ok) {
          const buffer = await dlRes.arrayBuffer();
          return await installFromBeax(buffer, true);
        }
      }
    }
    const beaxUrl = `https://github.com/${repo}/releases/latest/download/plugin.beax`;
    const beaxRes = await platformFetch(beaxUrl);
    if (!beaxRes.ok) throw new Error(`Failed to download .beax from ${repo}`);
    const buffer = await beaxRes.arrayBuffer();
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
    installFromGitHub,
  };
});
