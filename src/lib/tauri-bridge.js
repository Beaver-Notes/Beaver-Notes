import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import {
  exists as scopedExists,
  getFolderInfo as scopedGetFolderInfo,
  mkdir as scopedMkdir,
  pickFolder as scopedPickFolder,
  readDir as scopedReadDir,
  readFile as scopedReadFile,
  removeDir as scopedRemoveDir,
  removeFile as scopedRemoveFile,
  stat as scopedStat,
  writeFile as scopedWriteFile,
} from 'tauri-plugin-scoped-storage-api';

const closeFnList = [];
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MOBILE_USER_AGENT_RE = /Android|iPhone|iPad|iPod/i;
const SCOPED_PATH_PREFIX = 'scoped:';

const commandAliases = {
  'app:info': 'app_info',
  'migration:status': 'migration_status',
  'migration:run': 'migration_run',
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
  'import:evernote': 'import_evernote',
  'import:apple-notes': 'import_apple_notes',
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

function invokeDirect(channel, payload) {
  return invoke(mapCommand(channel), normalizePayload(channel, payload));
}

function isMobileRuntime() {
  return (
    typeof navigator !== 'undefined' &&
    MOBILE_USER_AGENT_RE.test(navigator.userAgent || '')
  );
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripQueryAndHash(value) {
  return String(value || '')
    .split('#')[0]
    .split('?')[0];
}

function normalizeFileUrl(value) {
  const normalized = String(value || '').trim();
  if (!/^file:\/\//i.test(normalized)) return normalized;

  try {
    const url = new URL(normalized);
    const pathname = safeDecode(url.pathname || '');
    return pathname.replace(/^\/([A-Za-z]:\/)/, '$1');
  } catch {
    return normalized;
  }
}

function normalizeScopedToken(value) {
  return String(value || '').replace(/^\/+/, '');
}

function uniqueToken() {
  return typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeFileName(value, fallback = 'file') {
  const normalized = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .trim();
  return normalized || fallback;
}

function hasDialogProperty(payload, property) {
  return (
    payload?.[property] === true ||
    payload?.properties?.includes(property) ||
    payload?.properties?.includes(
      property === 'openDirectory' ? 'directory' : property
    )
  );
}

function buildAcceptAttribute(filters = []) {
  return filters
    .flatMap((filter) => filter?.extensions || [])
    .map((extension) =>
      extension.startsWith('.')
        ? extension.toLowerCase()
        : `.${extension.toLowerCase()}`
    )
    .filter(Boolean)
    .join(',');
}

function ensureSuggestedExtension(fileName, filters = []) {
  const normalized = sanitizeFileName(fileName, 'Untitled');
  if (extnameSync(normalized)) return normalized;

  const extension = filters
    .flatMap((filter) => filter?.extensions || [])
    .map((value) =>
      String(value || '')
        .replace(/^\./, '')
        .trim()
    )
    .find(Boolean);

  return extension ? `${normalized}.${extension}` : normalized;
}

function toUint8Array(data) {
  if (data == null) return new Uint8Array();
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (Array.isArray(data)) return new Uint8Array(data);
  if (typeof data === 'string') return textEncoder.encode(data);
  return textEncoder.encode(String(data));
}

function uint8ArrayToBase64(data) {
  const bytes = toUint8Array(data);
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function isScopedPath(value) {
  return String(value || '').startsWith(SCOPED_PATH_PREFIX);
}

function parseScopedPath(value) {
  const normalized = safeDecode(stripQueryAndHash(String(value || '').trim()));
  if (!isScopedPath(normalized)) return null;

  const raw = normalizeScopedToken(normalized.slice(SCOPED_PATH_PREFIX.length));
  const [folderToken = '', ...parts] = raw.split('/').filter(Boolean);
  const folderId = folderToken.split('::')[0];

  if (!folderId) return null;

  return {
    folderId,
    relativePath: parts.join('/'),
    scopedPath: normalized,
  };
}

async function getStoredDataDir() {
  const value = await invokeDirect('storage:get', {
    name: 'settings',
    key: 'dataDir',
    def: '',
  });
  return typeof value === 'string' ? value.trim() : '';
}

async function resolveAssetVirtualPath(value) {
  const normalized = normalizeFileUrl(
    safeDecode(stripQueryAndHash(String(value || '').trim()))
  );
  if (!normalized) return normalized;

  const fileAssetMatch = normalized.match(/^file-assets:\/\/([^/]+)\/(.+)$/);
  if (fileAssetMatch) {
    const dataDir = await getStoredDataDir();
    return dataDir
      ? buildPath(dataDir, 'file-assets', fileAssetMatch[1], fileAssetMatch[2])
      : normalized;
  }

  const noteAssetMatch = normalized.match(/^assets:\/\/([^/]+)\/(.+)$/);
  if (noteAssetMatch) {
    const dataDir = await getStoredDataDir();
    return dataDir
      ? buildPath(dataDir, 'notes-assets', noteAssetMatch[1], noteAssetMatch[2])
      : normalized;
  }

  return normalized;
}

async function describeFsTarget(value) {
  const resolvedPath = await resolveAssetVirtualPath(value);
  const scoped = parseScopedPath(resolvedPath);
  if (scoped) {
    return {
      kind: 'scoped',
      originalPath: value,
      resolvedPath,
      folderId: scoped.folderId,
      relativePath: scoped.relativePath,
    };
  }

  return {
    kind: 'local',
    originalPath: value,
    resolvedPath,
  };
}

function toCompatFileStat(entry = {}) {
  const modified = Number(entry.lastModified || 0);
  return {
    isFile: Boolean(entry.isFile),
    isDirectory: Boolean(entry.isDir),
    size: Number(entry.size || 0),
    mtimeMs: modified,
    ctimeMs: modified,
  };
}

async function existsAt(target) {
  if (target.kind === 'scoped') {
    if (!target.relativePath) {
      await scopedGetFolderInfo(target.folderId);
      return true;
    }
    return scopedExists(target.folderId, target.relativePath);
  }

  return invokeDirect('fs:pathExists', target.resolvedPath);
}

async function statAt(target) {
  if (target.kind === 'scoped') {
    if (!target.relativePath) {
      await scopedGetFolderInfo(target.folderId);
      return {
        isFile: false,
        isDirectory: true,
        size: 0,
        mtimeMs: 0,
        ctimeMs: 0,
      };
    }
    return toCompatFileStat(
      await scopedStat(target.folderId, target.relativePath)
    );
  }

  return invokeDirect('fs:stat', target.resolvedPath);
}

async function readdirAt(target) {
  if (target.kind === 'scoped') {
    const entries = await scopedReadDir(target.folderId, target.relativePath);
    return entries
      .map((entry) => entry.name)
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  }

  return invokeDirect('fs:readdir', target.resolvedPath);
}

async function readBinaryAt(target) {
  if (target.kind === 'scoped') {
    return scopedReadFile(target.folderId, target.relativePath);
  }

  return base64ToUint8Array(
    await invokeDirect('fs:readData', target.resolvedPath)
  );
}

async function writeBinaryAt(target, data, options = {}) {
  const bytes = toUint8Array(data);

  if (target.kind === 'scoped') {
    if (!target.relativePath) {
      throw new Error('Cannot write to the root of a scoped folder.');
    }
    return scopedWriteFile(target.folderId, target.relativePath, bytes, {
      recursive: true,
    });
  }

  return invokeDirect('fs:writeFile', {
    ...options,
    path: target.resolvedPath,
    data: bytes,
  });
}

async function ensureDirAt(target) {
  if (target.kind === 'scoped') {
    if (!target.relativePath) return;
    return scopedMkdir(target.folderId, target.relativePath, true);
  }

  return invokeDirect('fs:ensureDir', target.resolvedPath);
}

async function removeAt(target) {
  if (target.kind === 'scoped') {
    if (!target.relativePath) {
      throw new Error('Cannot remove the root of a scoped folder.');
    }
    const details = await statAt(target);
    return details.isDirectory
      ? scopedRemoveDir(target.folderId, target.relativePath, true)
      : scopedRemoveFile(target.folderId, target.relativePath);
  }

  return invokeDirect('fs:remove', target.resolvedPath);
}

async function copyBetween(source, destination) {
  if (source.kind === 'local' && destination.kind === 'local') {
    return invokeDirect('fs:copy', {
      path: source.resolvedPath,
      dest: destination.resolvedPath,
    });
  }

  const sourceStat = await statAt(source);
  if (sourceStat.isDirectory) {
    await ensureDirAt(destination);
    const entries = await readdirAt(source);
    for (const entry of entries) {
      const childSource = await describeFsTarget(
        buildPath(source.resolvedPath, entry)
      );
      const childDestination = await describeFsTarget(
        buildPath(destination.resolvedPath, entry)
      );
      await copyBetween(childSource, childDestination);
    }
    return;
  }

  let destinationTarget = destination;
  if (await existsAt(destination)) {
    const destinationStat = await statAt(destination);
    if (destinationStat.isDirectory) {
      destinationTarget = await describeFsTarget(
        buildPath(destination.resolvedPath, basenameSync(source.resolvedPath))
      );
    }
  }

  await writeBinaryAt(destinationTarget, await readBinaryAt(source));
}

async function handleScopedFsInvoke(channel, payload) {
  switch (channel) {
    case 'fs:read-json': {
      const target = await describeFsTarget(payload);
      return JSON.parse(textDecoder.decode(await readBinaryAt(target)));
    }
    case 'fs:output-json': {
      const target = await describeFsTarget(payload?.path);
      return writeBinaryAt(
        target,
        JSON.stringify(payload?.data ?? {}, null, 2),
        payload
      );
    }
    case 'fs:ensureDir':
    case 'fs:mkdir':
      return ensureDirAt(await describeFsTarget(payload?.path ?? payload));
    case 'fs:pathExists':
    case 'fs:access':
      return existsAt(await describeFsTarget(payload));
    case 'fs:readFile':
      return textDecoder.decode(
        await readBinaryAt(await describeFsTarget(payload))
      );
    case 'fs:readData':
      return uint8ArrayToBase64(
        await readBinaryAt(await describeFsTarget(payload))
      );
    case 'fs:writeFile':
      return writeBinaryAt(
        await describeFsTarget(payload?.path),
        payload?.data,
        payload
      );
    case 'fs:copy':
      return copyBetween(
        await describeFsTarget(payload?.path),
        await describeFsTarget(payload?.dest)
      );
    case 'fs:isFile':
      return (await statAt(await describeFsTarget(payload))).isFile;
    case 'fs:remove':
    case 'fs:unlink':
      return removeAt(await describeFsTarget(payload?.path ?? payload));
    case 'fs:readdir':
      return readdirAt(await describeFsTarget(payload));
    case 'fs:stat':
      return statAt(await describeFsTarget(payload));
    default:
      return invokeDirect(channel, payload);
  }
}

async function handleMobileScopedDialog(payload) {
  const folder = await scopedPickFolder();
  return {
    canceled: !folder?.id,
    filePaths: folder?.id ? [`${SCOPED_PATH_PREFIX}${folder.id}`] : [],
  };
}

function pickFilesWithBrowserInput(payload = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = hasDialogProperty(payload, 'multiSelections');

    const accept = buildAcceptAttribute(payload?.filters);
    if (accept) {
      input.accept = accept;
    }

    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.width = '1px';
    input.style.height = '1px';

    let settled = false;

    const finish = (files) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocusBack);
      input.removeEventListener('cancel', onCancel);
      input.remove();
      resolve(files);
    };

    const onCancel = () => finish([]);
    const onFocusBack = () => {
      window.setTimeout(() => {
        if (!settled && !(input.files?.length > 0)) {
          finish([]);
        }
      }, 400);
    };

    input.addEventListener('change', () =>
      finish(Array.from(input.files || []))
    );
    input.addEventListener('cancel', onCancel);
    window.addEventListener('focus', onFocusBack, { once: true });

    document.body.appendChild(input);
    input.click();
  });
}

async function stageMobileSelectedFiles(files) {
  if (!files.length) return [];

  const tempDir = await invokeDirect('helper:get-path', 'temp');
  const stagingRoot = buildPath(
    tempDir,
    'beaver-notes-mobile-imports',
    uniqueToken()
  );

  await invokeDirect('fs:ensureDir', stagingRoot);

  const usedNames = new Set();
  const stagedPaths = [];

  for (const file of files) {
    const rawName = sanitizeFileName(file?.name, 'file');
    let candidateName = rawName;
    let collisionIndex = 1;

    while (usedNames.has(candidateName)) {
      const parsed = parseSync(rawName);
      candidateName = `${parsed.name || 'file'}-${collisionIndex}${parsed.ext}`;
      collisionIndex += 1;
    }

    usedNames.add(candidateName);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const destination = buildPath(stagingRoot, candidateName);
    await invokeDirect('fs:writeFile', {
      path: destination,
      data: bytes,
      skipAssetEncryption: true,
    });
    stagedPaths.push(destination);
  }

  return stagedPaths;
}

async function handleMobileFileOpenDialog(payload) {
  const files = await pickFilesWithBrowserInput(payload);
  const filePaths = await stageMobileSelectedFiles(files);

  return {
    canceled: filePaths.length === 0,
    filePaths,
  };
}

async function handleMobileSaveDialog(payload = {}) {
  const folder = await scopedPickFolder();
  if (!folder?.id) {
    return {
      canceled: true,
      filePath: null,
    };
  }

  const defaultFileName = ensureSuggestedExtension(
    basenameSync(payload?.defaultPath || '') || 'Untitled',
    payload?.filters
  );

  return {
    canceled: false,
    filePath: `${SCOPED_PATH_PREFIX}${folder.id}/${defaultFileName}`,
  };
}

const pathCache = {
  'path:join': (segments) => buildPath(...segments),
  'path:dirname': (target) => dirnameSync(target),
  'path:basename': (target) => basenameSync(target),
  'path:extname': (target) => extnameSync(target),
};

function payloadUsesScopedPath(payload) {
  if (typeof payload === 'string') return isScopedPath(payload);
  if (!payload || typeof payload !== 'object') return false;
  return [payload.path, payload.dest].some((value) => isScopedPath(value));
}

function isScopedFsChannel(channel) {
  return channel.startsWith('fs:');
}

export const backend = {
  async invoke(channel, payload) {
    if (
      channel === 'dialog:open' &&
      isMobileRuntime() &&
      hasDialogProperty(payload, 'openFile')
    ) {
      return handleMobileFileOpenDialog(payload);
    }

    if (channel === 'dialog:save' && isMobileRuntime()) {
      return handleMobileSaveDialog(payload);
    }

    if (
      channel === 'dialog:open' &&
      payload?.useScopedStorage &&
      isMobileRuntime()
    ) {
      return handleMobileScopedDialog(payload);
    }

    if (isScopedFsChannel(channel) && payloadUsesScopedPath(payload)) {
      return handleScopedFsInvoke(channel, payload);
    }

    if (channel === 'dialog:open' && payload?.useScopedStorage) {
      const { useScopedStorage, ...rest } = payload;
      return invokeDirect(channel, rest);
    }

    return invokeDirect(channel, payload);
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
  isMobileRuntime() {
    return isMobileRuntime();
  },
};

export const ipcRenderer = {
  callMain(channel, payload) {
    return backend.invoke(channel, payload);
  },
  on(channel, callback) {
    return backend.listen(channel, callback);
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
  return backend.invoke('fs:access', dir);
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
