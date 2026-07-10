const PLUGIN_STATES = {
  INSTALLED: 'installed',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ERROR: 'error',
};

export class Plugin {
  constructor(manifest, pluginData) {
    this.id = manifest.id;
    this.manifest = manifest;
    this.state = PLUGIN_STATES.INSTALLED;
    this.enabled = false;
    this.error = null;

    this._data = pluginData || {};
    this._beaverNotes = null;
    this._exports = null;
    this._settingsFn = null;
  }

  get planes() {
    return this.manifest.planes || [];
  }

  get permissions() {
    return this.manifest.permissions || [];
  }

  get isAppPlugin() {
    return this.planes.includes('app');
  }

  get isEditorPlugin() {
    return this.planes.includes('editor');
  }

  get isActive() {
    return this.state === PLUGIN_STATES.ACTIVE;
  }

  serialize() {
    return {
      id: this.id,
      manifest: this.manifest,
      enabled: this.enabled,
      state: this.state,
      error: this.error,
      planes: this.planes,
      permissions: this.permissions,
    };
  }
}
