import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';

const closeFnList = [];

const commandAliases = {
  'app:info': 'app_info',
  'app:spellcheck': 'set_spellcheck',
  'app:set-zoom': 'set_zoom',
  'app:get-zoom': 'get_zoom',
  'app:change-menu-visibility': 'change_menu_visibility',
  'open-file-external': 'open_file_external',
  'print-pdf': 'print_pdf',
  'fs:output-json': 'fs_output_json',
  'fs:read-json': 'fs_read_json',
  'fs:ensureDir': 'fs_ensure_dir',
  'fs:pathExists': 'fs_path_exists',
  'fs:readFile': 'fs_read_file',
  'fs:readData': 'fs_read_data',
  'fs:writeFile': 'fs_write_file',
  'fs:copy': 'fs_copy',
  'fs:isFile': 'fs_is_file',
  'storage:store': 'storage_get_store',
  'storage:replace': 'storage_replace',
  'safeStorage:isEncryptionAvailable': 'safe_storage_is_available',
  'safeStorage:encryptString': 'safe_storage_encrypt',
  'safeStorage:decryptString': 'safe_storage_decrypt',
  'safeStorage:storeBlob': 'safe_storage_store_blob',
  'safeStorage:fetchBlob': 'safe_storage_fetch_blob',
  'safeStorage:clearBlob': 'safe_storage_clear_blob',
  'assetCrypto:setAppPassphrase': 'asset_crypto_set_passphrase',
  'assetCrypto:clearAppPassphrase': 'asset_crypto_clear_passphrase',
  'passwd:hash': 'passwd_hash',
  'passwd:compare': 'passwd_compare',
  'passwd:recordFailure': 'passwd_record_failure',
  'passwd:resetFailures': 'passwd_reset_failures',
  'dialog:open': 'dialog_open',
  'dialog:message': 'dialog_message',
  'dialog:save': 'dialog_save',
  'get-system-fonts': 'get_system_fonts',
  'check-for-updates': 'check_for_updates',
  'download-update': 'download_update',
  'install-update': 'install_update',
  'toggle-auto-update': 'toggle_auto_update',
  'get-auto-update-status': 'get_auto_update_status',
  'is-update-downloading': 'is_update_downloading',
  'get-update-info': 'get_update_info',
  'app-ready': 'app_ready',
  'helper:relaunch': 'helper_relaunch',
  'helper:get-path': 'helper_get_path',
  'helper:is-dark-theme': 'helper_is_dark_theme',
  'show-edit-context-menu': 'show_edit_context_menu',
};

function mapCommand(channel) {
  return commandAliases[channel] || channel.replace(/[:-]/g, '_');
}

function withKeyVariants(key, value) {
  if (key.includes('_')) {
    const camel = key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    return { [key]: value, [camel]: value };
  }
  const snake = key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
  return { [key]: value, [snake]: value };
}

function normalizeBinaryData(data) {
  if (data == null) return [];
  if (typeof data === 'string') {
    return Array.from(new TextEncoder().encode(data));
  }
  if (data instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(data));
  }
  if (ArrayBuffer.isView(data)) {
    return Array.from(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    );
  }
  if (Array.isArray(data)) {
    return data;
  }
  return Array.from(new TextEncoder().encode(String(data)));
}

function normalizePayload(channel, payload) {
  switch (channel) {
    case 'app:spellcheck':
      return withKeyVariants('enabled', payload);
    case 'open-file-external':
      return withKeyVariants('src', payload);
    case 'app:set-zoom':
      return withKeyVariants('level', payload);
    case 'app:change-menu-visibility':
      return withKeyVariants('visible', payload);
    case 'fs:read-json':
    case 'fs:ensureDir':
    case 'fs:pathExists':
    case 'fs:remove':
    case 'fs:readFile':
    case 'fs:readdir':
    case 'fs:stat':
    case 'fs:unlink':
    case 'fs:readData':
    case 'fs:isFile':
    case 'fs:access':
      return withKeyVariants('path', payload);
    case 'fs:copy':
      return {
        ...withKeyVariants('path', payload?.path),
        ...withKeyVariants('dest', payload?.dest),
      };
    case 'fs:mkdir':
      return {
        ...withKeyVariants('path', payload?.path),
        ...(payload?.mode != null ? withKeyVariants('mode', payload.mode) : {}),
      };
    case 'fs:writeFile':
      return {
        ...payload,
        ...withKeyVariants('path', payload?.path),
        ...withKeyVariants('data', normalizeBinaryData(payload?.data)),
        ...withKeyVariants('mode', payload?.mode),
      };
    case 'storage:store':
    case 'storage:clear':
      return withKeyVariants('name', payload);
    case 'storage:get':
      return {
        ...payload,
        ...withKeyVariants('name', payload?.name),
        ...withKeyVariants('key', payload?.key),
        ...withKeyVariants('def', payload?.def ?? null),
      };
    case 'storage:replace':
      return {
        ...withKeyVariants('name', payload?.name),
        data: payload?.data ?? {},
      };
    case 'storage:set':
      return {
        ...payload,
        ...withKeyVariants('name', payload?.name),
        ...withKeyVariants('key', payload?.key),
        ...withKeyVariants('value', payload?.value),
      };
    case 'storage:delete':
    case 'storage:has':
      return {
        ...payload,
        ...withKeyVariants('name', payload?.name),
        ...withKeyVariants('key', payload?.key),
      };
    case 'safeStorage:encryptString':
      return withKeyVariants('plain_text', payload);
    case 'safeStorage:decryptString':
      return withKeyVariants('encrypted_base64', payload);
    case 'safeStorage:fetchBlob':
    case 'safeStorage:clearBlob':
      return withKeyVariants('key', payload);
    case 'assetCrypto:setAppPassphrase':
      return withKeyVariants('passphrase', payload);
    case 'passwd:hash':
      return withKeyVariants('password', payload);
    case 'dialog:open':
    case 'dialog:message':
    case 'dialog:save':
      return { props: payload };
    case 'print-pdf':
      return {
        ...payload,
        ...withKeyVariants('pdf_name', payload?.pdfName ?? payload?.pdf_name),
      };
    case 'toggle-auto-update':
      return withKeyVariants('enabled', payload);
    case 'helper:get-path':
      return withKeyVariants('name', payload);
    case 'show-edit-context-menu':
      return payload;
    default:
      return payload ?? {};
  }
}

function detectWindowsPath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\');
}

function pathSeparator(values) {
  return values.some(
    (value) => typeof value === 'string' && detectWindowsPath(value)
  )
    ? '\\'
    : '/';
}

function toSegments(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
}

function buildPath(...parts) {
  if (parts.length === 0) return '';

  const source = parts.map((part) => String(part ?? ''));
  const sep = pathSeparator(source);
  const first = source[0].replace(/\\/g, '/');
  const driveMatch = first.match(/^([A-Za-z]:)(\/.*)?$/);
  const isAbsolute = first.startsWith('/') || Boolean(driveMatch);
  const prefix = driveMatch ? driveMatch[1] : isAbsolute ? sep : '';
  const stack = [];

  source.forEach((part) => {
    const normalized = String(part || '').replace(/\\/g, '/');
    normalized.split('/').forEach((segment) => {
      if (!segment || segment === '.') return;
      if (segment === '..') {
        if (stack.length > 0) stack.pop();
        return;
      }
      if (/^[A-Za-z]:$/.test(segment)) {
        stack.length = 0;
        return;
      }
      stack.push(segment);
    });
  });

  const body = stack.join(sep);
  if (!prefix) return body;
  if (!body) return prefix;
  return prefix.endsWith(sep) ? `${prefix}${body}` : `${prefix}${sep}${body}`;
}

function dirnameSync(value) {
  const raw = String(value || '');
  if (!raw) return '';
  const normalized = raw.replace(/\\/g, '/');
  const withoutTrailing = normalized.replace(/\/+$/, '');
  const lastSlash = withoutTrailing.lastIndexOf('/');
  if (lastSlash <= 0) {
    const driveMatch = withoutTrailing.match(/^([A-Za-z]:)$/);
    if (driveMatch) return `${driveMatch[1]}\\`;
    return lastSlash === 0 ? raw.slice(0, 1) : '';
  }
  const dir = withoutTrailing.slice(0, lastSlash);
  return pathSeparator([raw]) === '\\' ? dir.replace(/\//g, '\\') : dir;
}

function basenameSync(value) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  return normalized.split('/').pop() || '';
}

function extnameSync(value) {
  const base = basenameSync(value);
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(index) : '';
}

function parseSync(value) {
  const base = basenameSync(value);
  const ext = extnameSync(base);
  return {
    root: '',
    dir: dirnameSync(value),
    base,
    ext,
    name: ext ? base.slice(0, -ext.length) : base,
  };
}

const pathCache = {
  'path:join': (segments) => buildPath(...segments),
  'path:dirname': (target) => dirnameSync(target),
  'path:basename': (target) => basenameSync(target),
  'path:extname': (target) => extnameSync(target),
};

export const backend = {
  invoke(channel, payload) {
    return invoke(mapCommand(channel), normalizePayload(channel, payload));
  },
  listen(channel, callback) {
    return listen(channel, (event) => callback(event, event.payload));
  },
  listenPayload(channel, callback) {
    return listen(channel, (event) => callback(event.payload));
  },
  resolve(channel, payload) {
    return pathCache[channel]?.(payload);
  },
};

export const path = {
  join: (...args) => buildPath(...args),
  dirname: (target) => dirnameSync(target),
  basename: (target) => basenameSync(target),
  extname: (target) => extnameSync(target),
  parse: (target) => parseSync(target),
};

export const clipboard = {
  writeText: (text) => writeText(text),
  readText: () => readText(),
};

export function showNotification(props) {
  return invoke('show_notification', props);
}

export function canAccessPath(dir) {
  return invoke('fs_access', withKeyVariants('path', dir));
}

export function onFileOpened(callback) {
  return listen('file-opened', (event) => callback(event.payload));
}

export function addCloseHandler(fn) {
  if (!closeFnList.includes(fn)) {
    closeFnList.push(fn);
  }
}

if (typeof window !== 'undefined' && !window.__beaverCloseFnsBound) {
  window.__beaverCloseFnsBound = true;
  window.addEventListener('beforeunload', () => {
    closeFnList.forEach((fn) => {
      try {
        fn();
      } catch (error) {
        console.error(error);
      }
    });
  });
}

export const versions = {};
