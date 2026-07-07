import { CoreAccess } from './CoreAccess';
import { createPluginStorage } from './PluginStorage';
import { createPluginEvents, emitAppEvent } from './PluginEvents';
import { ConflictRegistry } from './ConflictRegistry';
import { PluginRegistry } from './PluginRegistry';
import { toolbarRegistry } from '@/utils/ui/toolbarRegistry';
import { registerIcon } from '@/lib/v-remixicon';
import emitter from 'tiny-emitter/instance';
import {
  Extension,
  Node,
  Mark,
  mergeAttributes,
  findChildren,
  posToDOMRect,
} from '@tiptap/core';
import {
  Plugin,
  PluginKey,
  NodeSelection,
  TextSelection,
  AllSelection,
} from '@tiptap/pm/state';
import { InputRule } from '@tiptap/pm/inputrules';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Fragment, Slice } from '@tiptap/pm/model';

import { backend } from '@/lib/tauri-bridge';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { useLabelStore } from '@/store/label';
import { useAppStore } from '@/store/app';
import { getSettingSync } from '@/composable/settings';

const NOTE_ALLOWLIST = [
  'id',
  'title',
  'body',
  'folderId',
  'labels',
  'pinned',
  'archived',
  'createdAt',
  'updatedAt',
];

function cleanNote(note, options = {}) {
  if (!note) return null;
  const result = {};
  const fields = options.fields || NOTE_ALLOWLIST;
  for (const field of fields) {
    if (field in note) result[field] = note[field];
  }
  if (options.excerpt) {
    result.excerpt = (note.body || '').slice(0, 200);
  }
  return result;
}

export function createPluginAPI(pluginId, manifest) {
  const planes = manifest.planes || [];
  const storage = createPluginStorage(pluginId, manifest.storageSchemaVersion);

  const lifecycleHooks = {
    activate: [],
    deactivate: [],
  };

  function fireHooks(name) {
    const hooks = lifecycleHooks[name] || [];
    for (const hook of hooks) {
      try {
        hook();
      } catch (e) {
        console.error(
          `[PluginAPI] Error in ${name} hook for "${pluginId}":`,
          e
        );
      }
    }
  }

  const appPlane = planes.includes('app')
    ? createAppPlane(pluginId, manifest)
    : null;
  const editorPlane = planes.includes('editor')
    ? createEditorPlane(pluginId)
    : null;

  const beaverNotes = {
    id: pluginId,
    manifest,
    planes: [...planes],

    app: appPlane,
    editor: editorPlane,

    storage: {
      get: (key, def) => storage.get(key, def),
      set: (key, value) => storage.set(key, value),
      delete: (key) => storage.delete(key),
      clear: () => storage.clear(),
      keys: () => storage.keys(),
      has: (key) => storage.has(key),
    },

    ui: createUIPlane(pluginId),

    expose(api) {
      const perms = manifest.permissions || [];
      if (!perms.includes('plugin:interop')) {
        console.warn(
          `[PluginAPI] Plugin "${pluginId}" needs "plugin:interop" permission to expose APIs`
        );
        return;
      }
      PluginRegistry.registerAPI(pluginId, api);
    },

    async import(targetPluginId) {
      try {
        CoreAccess.guardInterop(pluginId, targetPluginId);
      } catch (e) {
        console.warn(
          `[PluginAPI] Plugin "${pluginId}" cannot import "${targetPluginId}": ${e.message}`
        );
        return undefined;
      }

      const existing = await backend.invoke('get_interop_grants', { pluginId });
      if (existing?.includes(targetPluginId)) {
        return PluginRegistry.getAPI(targetPluginId);
      }

      const consumerName = manifest.name || pluginId;
      const granted = await new Promise((resolve) => {
        emitter.emit('show-dialog', 'confirm', {
          title: 'Interop Request',
          body: `"${consumerName}" wants to access the API of plugin "${targetPluginId}". Only grant this if you trust both plugins.`,
          okText: 'Allow',
          okVariant: 'primary',
          cancelText: 'Deny',
          icon: 'ri-share-line',
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });

      if (!granted) {
        return undefined;
      }

      await backend.invoke('add_interop_grant', {
        pluginId,
        targetPluginId,
      });

      return PluginRegistry.getAPI(targetPluginId);
    },

    onPluginReady(targetPluginId, callback) {
      PluginRegistry.onPluginReady(targetPluginId, callback);
    },

    onActivate(cb) {
      if (typeof cb !== 'function') return;
      lifecycleHooks.activate.push(cb);
    },

    onDeactivate(cb) {
      if (typeof cb !== 'function') return;
      lifecycleHooks.deactivate.push(cb);
    },

    _fireActivate() {
      fireHooks('activate');
    },

    _fireDeactivate() {
      fireHooks('deactivate');
    },

    _destroy() {
      if (editorPlane && editorPlane._destroy) {
        editorPlane._destroy();
      }
      PluginRegistry.clearPlugin(pluginId);
      lifecycleHooks.activate.length = 0;
      lifecycleHooks.deactivate.length = 0;
    },
  };

  return beaverNotes;
}

function createAppPlane(pluginId, manifest) {
  const events = createPluginEvents(pluginId);

  return {
    notes: createNotesAPI(pluginId),
    folders: createFoldersAPI(pluginId),
    labels: createLabelsAPI(pluginId),
    filesystem: createFilesystemAPI(pluginId),

    settings: {
      get(key) {
        return CoreAccess.guard(pluginId, 'app:settings', () => {
          return getSettingSync(key);
        });
      },
      async set(key, value) {
        await CoreAccess.guardAsync(pluginId, 'app:settings', async () => {
          const appStore = useAppStore();
          await appStore.setSettingStorage(key, value);
        });
      },
    },

    commands: {
      register(command) {
        if (!command || !command.id || !command.title || !command.handler) {
          console.warn('[PluginAPI] Invalid command registration:', command);
          return;
        }
        ConflictRegistry.checkAppCommand(pluginId, command);
        emitter.emit('plugin:register-command', {
          pluginId,
          command: {
            ...command,
            pluginId,
          },
        });
      },
    },

    network: {
      async request(url, options = {}) {
        return CoreAccess.guardAsync(pluginId, 'network', async () => {
          const response = await fetch(url, options);
          return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            text: () => response.text(),
            json: () => response.json(),
            blob: () => response.blob(),
            arrayBuffer: () => response.arrayBuffer(),
          };
        });
      },
    },

    on: events.on,
    once: events.once,
    off: events.off,
    _destroy: events.destroy,
  };
}

function createNotesAPI(pluginId) {
  function getStore() {
    const store = useNoteStore();
    return store;
  }

  const SUMMARY_FIELDS = [
    'id',
    'title',
    'folderId',
    'labels',
    'pinned',
    'archived',
    'createdAt',
    'updatedAt',
  ];

  return {
    list(options = {}) {
      return CoreAccess.guard(pluginId, 'notes:read', () => {
        const store = getStore();
        const allNotes = store.notes;

        let result = allNotes;
        if (options.folderId) {
          result = store.getByFolder(options.folderId);
        }
        if (options.labelId) {
          result = result.filter(
            (n) => n.labels && n.labels.includes(options.labelId)
          );
        }
        if (options.limit) {
          result = result.slice(0, options.limit);
        }
        if (options.offset) {
          result = result.slice(options.offset);
        }

        return result.map((note) =>
          cleanNote(note, { fields: SUMMARY_FIELDS, excerpt: true })
        );
      });
    },

    get(id) {
      return CoreAccess.guard(pluginId, 'notes:read', () => {
        const store = getStore();
        const note = store.getById(id);
        if (!note) return null;
        return cleanNote({ ...note });
      });
    },

    async create(data) {
      return CoreAccess.guardAsync(pluginId, 'notes:write', async () => {
        const store = getStore();
        const note = {
          title: data.title || '',
          body: data.body || '',
          folderId: data.folderId || null,
          labels: data.labels || [],
          pinned: data.pinned || false,
          archived: data.archived || false,
        };
        await store.add(note);
        const created = store.notes[store.notes.length - 1];
        return cleanNote(created);
      });
    },

    async update(id, data) {
      return CoreAccess.guardAsync(pluginId, 'notes:write', async () => {
        const store = getStore();
        const existing = store.getById(id);
        if (!existing) throw new Error(`Note "${id}" not found`);
        await store.update(id, { ...existing, ...data });
        return cleanNote(store.getById(id));
      });
    },

    async delete(id) {
      return CoreAccess.guardAsync(pluginId, 'notes:write', async () => {
        const store = getStore();
        await store.delete(id);
      });
    },

    search(query, options = {}) {
      return CoreAccess.guard(pluginId, 'notes:read', () => {
        const store = getStore();
        return store
          .searchNotes(query, options)
          .map((note) =>
            cleanNote(note, { fields: SUMMARY_FIELDS, excerpt: true })
          );
      });
    },
  };
}

function createFoldersAPI(pluginId) {
  function getStore() {
    return useFolderStore();
  }

  const FOLDER_FIELDS = ['id', 'name', 'parentId', 'icon', 'archived'];

  return {
    list() {
      return CoreAccess.guard(pluginId, 'notes:read', () => {
        const store = getStore();
        const folders = store.folders || [];
        return folders.map((f) => cleanNote(f, { fields: FOLDER_FIELDS }));
      });
    },

    get(id) {
      return CoreAccess.guard(pluginId, 'notes:read', () => {
        const store = getStore();
        const folder = (store.folders || []).find((f) => f.id === id);
        if (!folder) return null;
        return cleanNote(folder, { fields: FOLDER_FIELDS });
      });
    },

    async create(data) {
      return CoreAccess.guardAsync(pluginId, 'notes:write', async () => {
        const store = getStore();
        await store.add({ name: data.name, parentId: data.parentId || null });
        const folders = store.folders || [];
        const created = folders.find(
          (f) => f.name === data.name && f.parentId === (data.parentId || null)
        );
        return cleanNote(created, { fields: FOLDER_FIELDS });
      });
    },

    async update(id, data) {
      return CoreAccess.guardAsync(pluginId, 'notes:write', async () => {
        const store = getStore();
        const folder = (store.folders || []).find((f) => f.id === id);
        if (!folder) throw new Error(`Folder "${id}" not found`);
        if (data.name !== undefined) folder.name = data.name;
        if (data.icon !== undefined) folder.icon = data.icon;
        if (data.archived !== undefined) folder.archived = data.archived;
        await store.update(id, folder);
      });
    },

    async delete(id) {
      return CoreAccess.guardAsync(pluginId, 'notes:write', async () => {
        const store = getStore();
        await store.delete(id);
      });
    },
  };
}

function createLabelsAPI(pluginId) {
  function getStore() {
    return useLabelStore();
  }

  return {
    list() {
      return CoreAccess.guard(pluginId, 'notes:read', () => {
        const store = getStore();
        const labelNames = store.data || [];
        return labelNames.map((name) => ({
          id: name,
          name,
          color: store.getColor(name),
        }));
      });
    },

    get(id) {
      return CoreAccess.guard(pluginId, 'notes:read', () => {
        const store = getStore();
        const labelNames = store.data || [];
        if (!labelNames.includes(id)) return null;
        return { id, name: id, color: store.getColor(id) };
      });
    },

    async create(data) {
      return CoreAccess.guardAsync(pluginId, 'notes:write', async () => {
        const store = getStore();
        const name = typeof data === 'string' ? data : data.name;
        const created = await store.add(name);
        if (created) {
          if (data.color) await store.setColor(created, data.color);
        }
        return created
          ? { id: created, name: created, color: data.color || null }
          : null;
      });
    },

    async update(id, data) {
      return CoreAccess.guardAsync(pluginId, 'notes:write', async () => {
        const store = getStore();
        const labelNames = store.data || [];
        if (!labelNames.includes(id))
          throw new Error(`Label "${id}" not found`);
        if (data.color !== undefined) {
          await store.setColor(id, data.color);
        }
      });
    },

    async delete(id) {
      return CoreAccess.guardAsync(pluginId, 'notes:write', async () => {
        const store = getStore();
        await store.delete(id);
      });
    },
  };
}

function createFilesystemAPI(pluginId) {
  return {
    async readText(path) {
      return CoreAccess.guardAsync(pluginId, 'filesystem', async () => {
        return backend.invoke('plugin:fs_read_text', { pluginId, path });
      });
    },

    async writeText(path, content) {
      return CoreAccess.guardAsync(pluginId, 'filesystem', async () => {
        await backend.invoke('plugin:fs_write_text', {
          pluginId,
          path,
          content,
        });
      });
    },

    async readBinary(path) {
      return CoreAccess.guardAsync(pluginId, 'filesystem', async () => {
        return backend.invoke('plugin:fs_read_binary', { pluginId, path });
      });
    },

    async writeBinary(path, base64Data) {
      return CoreAccess.guardAsync(pluginId, 'filesystem', async () => {
        await backend.invoke('plugin:fs_write_binary', {
          pluginId,
          path,
          data: base64Data,
        });
      });
    },

    async delete(path) {
      return CoreAccess.guardAsync(pluginId, 'filesystem', async () => {
        await backend.invoke('plugin:fs_delete', { pluginId, path });
      });
    },

    async list(dir) {
      return CoreAccess.guardAsync(pluginId, 'filesystem', async () => {
        const entries = await backend.invoke('plugin:fs_list', {
          pluginId,
          dir: dir || '',
        });
        return entries || [];
      });
    },

    async exists(path) {
      return CoreAccess.guardAsync(pluginId, 'filesystem', async () => {
        const result = await backend.invoke('plugin:fs_exists', {
          pluginId,
          path,
        });
        return !!result;
      });
    },
  };
}

function createEditorPlane(pluginId) {
  const registeredExtensions = [];
  const registeredSlashCommands = [];
  const registeredToolbarItems = [];

  return {
    tiptap: {
      Extension,
      Node,
      Mark,
      Plugin,
      PluginKey,
      InputRule,
      NodeSelection,
      TextSelection,
      AllSelection,
      Decoration,
      DecorationSet,
      Fragment,
      Slice,
      mergeAttributes,
      findChildren,
      posToDOMRect,
    },

    registerExtension(extension) {
      if (!extension) {
        console.warn('[PluginAPI] Invalid extension registration');
        return;
      }
      ConflictRegistry.checkExtension(pluginId, extension);
      registeredExtensions.push(extension);
      emitter.emit('plugin:register-extension', {
        pluginId,
        extension,
      });
    },

    registerSlashCommand(command) {
      if (!command || !command.name || !command.action) {
        console.warn('[PluginAPI] Invalid slash command registration');
        return;
      }
      ConflictRegistry.checkSlashCommand(pluginId, command);
      registeredSlashCommands.push({ ...command, pluginId });
      emitter.emit('plugin:register-slash-command', {
        pluginId,
        command: { ...command, pluginId },
      });
    },

    registerToolbarItem(item) {
      if (!item || !item.id) {
        console.warn('[PluginAPI] Invalid toolbar item registration');
        return;
      }
      ConflictRegistry.checkToolbarItem(pluginId, item);
      const fullItem = { ...item, pluginId, group: item.group || 'plugins' };
      registeredToolbarItems.push(fullItem);
      toolbarRegistry.register(fullItem);
      emitter.emit('plugin:register-toolbar-item', {
        pluginId,
        item: fullItem,
      });
    },

    _destroy() {
      for (const item of registeredToolbarItems) {
        try {
          toolbarRegistry.unregister(item.id);
          ConflictRegistry.unregisterToolbarItem(pluginId, item.id);
        } catch (e) {
          console.error(
            `[PluginAPI] Failed to unregister toolbar item "${item.id}" for "${pluginId}":`,
            e
          );
        }
      }
      emitter.emit('plugin:unregister-toolbar-item', { pluginId });
      emitter.emit('plugin:unregister-extension', { pluginId });
      emitter.emit('plugin:unregister-slash-command', { pluginId });
      emitter.emit('plugin:unregister-command', { pluginId });
      registeredExtensions.length = 0;
      registeredSlashCommands.length = 0;
      registeredToolbarItems.length = 0;
    },
  };
}

function createUIPlane(pluginId) {
  function button(options = {}) {
    const btn = document.createElement('button');
    const { label, variant = 'default', icon, disabled, onClick } = options;
    btn.className = `plugin-btn${icon ? ' plugin-btn-icon' : ''} plugin-btn-${variant}`;
    if (disabled) {
      btn.classList.add('plugin-btn-disabled');
      btn.disabled = true;
    }
    if (icon) {
      const ic = document.createElement('i');
      ic.className = icon;
      btn.appendChild(ic);
    }
    if (label) btn.textContent = label;
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  }

  function input(options = {}) {
    const el = document.createElement('input');
    el.className = 'plugin-input';
    const { placeholder, value, type = 'text', onChange } = options;
    if (placeholder) el.placeholder = placeholder;
    if (value !== undefined) el.value = value;
    el.type = type;
    if (onChange) el.addEventListener('input', (e) => onChange(e.target.value));
    return el;
  }

  function toggle(options = {}) {
    const label = document.createElement('label');
    label.className = 'relative inline-flex items-center cursor-pointer';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'peer sr-only';
    if (options.checked) input.checked = true;
    const track = document.createElement('div');
    track.className = 'plugin-switch-track';
    label.append(input, track);
    if (options.onChange) {
      input.addEventListener('change', (e) => options.onChange(e.target.checked));
    }
    return label;
  }

  function checkbox(options = {}) {
    const label = document.createElement('label');
    label.className = 'inline-flex items-center gap-2 cursor-pointer';
    const wrapper = document.createElement('div');
    wrapper.className = 'plugin-checkbox';
    if (options.checked) wrapper.classList.add('plugin-checkbox-checked');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'sr-only';
    if (options.checked) input.checked = true;
    wrapper.appendChild(input);
    label.appendChild(wrapper);
    if (options.label) {
      const span = document.createElement('span');
      span.textContent = options.label;
      label.appendChild(span);
    }
    if (options.onChange) {
      input.addEventListener('change', (e) => {
        wrapper.classList.toggle('plugin-checkbox-checked', e.target.checked);
        options.onChange(e.target.checked);
      });
    }
    return label;
  }

  function select(options = {}) {
    const container = document.createElement('div');
    container.className = 'relative';
    const btn = document.createElement('button');
    btn.className = 'plugin-select';
    const { options: items, value, placeholder, onChange } = options;
    const selected = items?.find((o) => o.value === value);
    btn.textContent = selected?.text || placeholder || '';
    container.appendChild(btn);
    let open = false;
    let dropdown = null;
    function close() {
      if (dropdown) { dropdown.remove(); dropdown = null; }
      open = false;
    }
    btn.addEventListener('click', () => {
      if (open) { close(); return; }
      open = true;
      dropdown = document.createElement('div');
      dropdown.className = 'plugin-select-dropdown absolute';
      dropdown.style.minWidth = `${btn.offsetWidth}px`;
      for (const item of (items || [])) {
        const opt = document.createElement('div');
        opt.className = 'plugin-select-option';
        opt.textContent = item.text;
        if (item.value === value) opt.classList.add('bg-neutral-100', 'dark:bg-neutral-700');
        opt.addEventListener('click', () => {
          btn.textContent = item.text;
          close();
          if (onChange) onChange(item.value);
        });
        dropdown.appendChild(opt);
      }
      container.appendChild(dropdown);
    });
    document.addEventListener('click', (e) => {
      if (open && !container.contains(e.target)) close();
    }, { once: true });
    return container;
  }

  function el(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.class) element.className = options.class;
    if (options.text) element.textContent = options.text;
    if (options.attrs) {
      for (const [k, v] of Object.entries(options.attrs)) {
        element.setAttribute(k, v);
      }
    }
    if (options.children) {
      for (const child of options.children) {
        if (typeof child === 'string') element.appendChild(document.createTextNode(child));
        else element.appendChild(child);
      }
    }
    return element;
  }

  return {
    dialog: {
      async alert(options = {}) {
        return new Promise((resolve) => {
          emitter.emit('show-dialog', 'alert', {
            ...options,
            onConfirm: () => resolve(),
          });
        });
      },
      async confirm(options = {}) {
        return new Promise((resolve) => {
          emitter.emit('show-dialog', 'confirm', {
            ...options,
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
      },
      async prompt(options = {}) {
        return new Promise((resolve) => {
          emitter.emit('show-dialog', 'prompt', {
            ...options,
            onConfirm: (value) => resolve(value),
            onCancel: () => resolve(null),
          });
        });
      },
    },

    notify(title, body) {
      emitter.emit('plugin:notify', { pluginId, title, body });
    },

    registerIcon,
    button,
    input,
    switch: toggle,
    checkbox,
    select,
    el,
  };
}
