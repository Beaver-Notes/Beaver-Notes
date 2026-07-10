import { PluginConflictError, PluginInteropError } from './PluginError';

const _apiRegistry = new Map();
const _pluginNames = new Map();
const _readyCallbacks = new Map();
const _saveTransforms = new Map();
const _loadTransforms = new Map();

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

  registerSaveTransform(pluginId, fn) {
    if (typeof fn !== 'function') {
      console.warn(`[PluginRegistry] Save transform for "${pluginId}" must be a function`);
      return;
    }
    _saveTransforms.set(pluginId, fn);
  },

  registerLoadTransform(pluginId, fn) {
    if (typeof fn !== 'function') {
      console.warn(`[PluginRegistry] Load transform for "${pluginId}" must be a function`);
      return;
    }
    _loadTransforms.set(pluginId, fn);
  },

  async runSaveTransforms(content, noteId) {
    let result = content;
    for (const [pluginId, fn] of _saveTransforms) {
      try {
        const transformed = await fn(result, noteId);
        if (transformed !== undefined) result = transformed;
      } catch (e) {
        console.error(`[PluginRegistry] Save transform "${pluginId}" failed for note "${noteId}":`, e);
      }
    }
    return result;
  },

  async runLoadTransforms(content, noteId) {
    let result = content;
    for (const [pluginId, fn] of _loadTransforms) {
      try {
        const transformed = await fn(result, noteId);
        if (transformed !== undefined) result = transformed;
      } catch (e) {
        console.error(`[PluginRegistry] Load transform "${pluginId}" failed for note "${noteId}":`, e);
      }
    }
    return result;
  },

  clearPlugin(pluginId) {
    _apiRegistry.delete(pluginId);
    _readyCallbacks.delete(pluginId);
    _saveTransforms.delete(pluginId);
    _loadTransforms.delete(pluginId);
  },
};
