import { PluginConflictError, PluginInteropError } from './PluginError';

const _apiRegistry = new Map();
const _pluginNames = new Map();
const _readyCallbacks = new Map();

export const PluginRegistry = {
  registerAPI(pluginId, api) {
    if (_apiRegistry.has(pluginId)) {
      throw new PluginConflictError(pluginId, 'exposed-api', pluginId, 'self');
    }
    _apiRegistry.set(pluginId, api);

    const pending = _readyCallbacks.get(pluginId);
    if (pending) {
      for (const cb of pending) {
        try { cb(api); } catch (e) { console.error(`[PluginRegistry] onPluginReady callback error:`, e); }
      }
      _readyCallbacks.delete(pluginId);
    }
  },

  unregisterAPI(pluginId) {
    _apiRegistry.delete(pluginId);
  },

  getAPI(pluginId) {
    return _apiRegistry.get(pluginId);
  },

  onPluginReady(pluginId, callback) {
    const existing = _apiRegistry.get(pluginId);
    if (existing) {
      try { callback(existing); } catch (e) { console.error(`[PluginRegistry] onPluginReady callback error:`, e); }
      return;
    }
    if (!_readyCallbacks.has(pluginId)) {
      _readyCallbacks.set(pluginId, []);
    }
    _readyCallbacks.get(pluginId).push(callback);
  },

  clearPlugin(pluginId) {
    _apiRegistry.delete(pluginId);
    _readyCallbacks.delete(pluginId);
  },
};
