import { PluginConflictError } from './PluginError';

const _extensions = new Map();
const _slashCommands = new Map();
const _appCommands = new Map();
const _toolbarItems = new Map();

export const ConflictRegistry = {
  checkExtension(pluginId, extension) {
    const name = extension?.name;
    if (!name) return;
    const existing = _extensions.get(name);
    if (existing && existing !== pluginId) {
      throw new PluginConflictError(pluginId, 'extension', name, existing);
    }
    _extensions.set(name, pluginId);
  },

  unregisterExtension(pluginId, extension) {
    const name = extension?.name;
    if (name && _extensions.get(name) === pluginId) {
      _extensions.delete(name);
    }
  },

  checkSlashCommand(pluginId, command) {
    const name = command?.name;
    if (!name) return;
    const existing = _slashCommands.get(name);
    if (existing && existing !== pluginId) {
      throw new PluginConflictError(pluginId, 'slash-command', name, existing);
    }
    _slashCommands.set(name, pluginId);
  },

  unregisterSlashCommand(pluginId, name) {
    if (_slashCommands.get(name) === pluginId) {
      _slashCommands.delete(name);
    }
  },

  checkAppCommand(pluginId, command) {
    const id = command?.id;
    if (!id) return;
    const existing = _appCommands.get(id);
    if (existing && existing !== pluginId) {
      throw new PluginConflictError(pluginId, 'app-command', id, existing);
    }
    _appCommands.set(id, pluginId);
  },

  unregisterAppCommand(pluginId, id) {
    if (_appCommands.get(id) === pluginId) {
      _appCommands.delete(id);
    }
  },

  checkToolbarItem(pluginId, item) {
    const id = item?.id;
    if (!id) return;
    const existing = _toolbarItems.get(id);
    if (existing && existing !== pluginId) {
      throw new PluginConflictError(pluginId, 'toolbar-item', id, existing);
    }
    _toolbarItems.set(id, pluginId);
  },

  unregisterToolbarItem(pluginId, id) {
    if (_toolbarItems.get(id) === pluginId) {
      _toolbarItems.delete(id);
    }
  },

  clearPlugin(pluginId) {
    for (const [name, pid] of _extensions) {
      if (pid === pluginId) _extensions.delete(name);
    }
    for (const [name, pid] of _slashCommands) {
      if (pid === pluginId) _slashCommands.delete(name);
    }
    for (const [name, pid] of _appCommands) {
      if (pid === pluginId) _appCommands.delete(name);
    }
    for (const [name, pid] of _toolbarItems) {
      if (pid === pluginId) _toolbarItems.delete(name);
    }
  },
};
