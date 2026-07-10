import { PluginPermissionError } from './PluginError';

const VALID_PERMISSIONS = Object.freeze([
  'notes:read',
  'notes:write',
  'filesystem',
  'network',
  'app:settings',
  'plugin:interop',
  'credentials',
]);

const _grants = new Map();
const _userGrants = new Map();
const _activePlugins = new Map();

export const CoreAccess = {
  get VALID_PERMISSIONS() {
    return VALID_PERMISSIONS;
  },

  register(pluginId, manifest, userApprovedPerms) {
    if (_activePlugins.has(pluginId)) {
      throw new Error(`Plugin "${pluginId}" is already registered`);
    }

    const declared = manifest.permissions || [];
    const invalid = declared.filter((p) => !VALID_PERMISSIONS.includes(p));
    if (invalid.length) {
      throw new Error(
        `Plugin "${pluginId}" declares unknown permissions: ${invalid.join(
          ', '
        )}`
      );
    }

    _grants.set(pluginId, new Set(declared));
    _activePlugins.set(pluginId, {
      manifest,
      loadedAt: Date.now(),
      planes: manifest.planes || [],
    });

    // Apply user-approved grants, defaulting to all declared if not set
    const effective =
      userApprovedPerms && userApprovedPerms.length > 0
        ? declared.filter((p) => userApprovedPerms.includes(p))
        : declared;
    _userGrants.set(pluginId, new Set(effective));
  },

  unregister(pluginId) {
    _grants.delete(pluginId);
    _userGrants.delete(pluginId);
    _activePlugins.delete(pluginId);
  },

  setUserGrants(pluginId, permissions) {
    const declared = _grants.get(pluginId);
    if (!declared) return;
    const valid = permissions.filter((p) => declared.has(p));
    _userGrants.set(pluginId, new Set(valid));
  },

  getDeclaredPermissions(pluginId) {
    const grants = _grants.get(pluginId);
    return grants ? [...grants] : [];
  },

  getEffectiveGrants(pluginId) {
    const grants = _userGrants.get(pluginId);
    return grants ? [...grants] : [];
  },

  hasPermission(pluginId, permission) {
    const grants = _userGrants.get(pluginId);
    return grants ? grants.has(permission) : false;
  },

  getGrants(pluginId) {
    return this.getEffectiveGrants(pluginId);
  },

  getActive() {
    return new Map(_activePlugins);
  },

  isActive(pluginId) {
    return _activePlugins.has(pluginId);
  },

  guard(pluginId, permission, fn) {
    if (!_grants.has(pluginId)) {
      throw new PluginPermissionError(pluginId, permission);
    }
    if (!_userGrants.get(pluginId)?.has(permission)) {
      throw new PluginPermissionError(pluginId, permission);
    }
    return fn();
  },

  async guardAsync(pluginId, permission, fn) {
    if (!_grants.has(pluginId)) {
      throw new PluginPermissionError(pluginId, permission);
    }
    if (!_userGrants.get(pluginId)?.has(permission)) {
      throw new PluginPermissionError(pluginId, permission);
    }
    return fn();
  },

  guardInterop(consumerId, providerId) {
    this.guard(consumerId, 'plugin:interop', () => {});
    const providerDeclared = _grants.get(providerId);
    if (!providerDeclared || !providerDeclared.has('plugin:interop')) {
      throw new PluginPermissionError(providerId, 'plugin:interop');
    }
    if (!_activePlugins.has(providerId)) {
      throw new PluginPermissionError(providerId, 'plugin:interop');
    }
  },
};
