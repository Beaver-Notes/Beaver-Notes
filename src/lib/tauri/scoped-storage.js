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
import { invokeCommand } from './commands';
import { basenameSync, buildPath, extnameSync, parseSync } from './path';
import { isMobileRuntime } from './runtime';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const SCOPED_PATH_PREFIX = 'scoped:';

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
    resolvedPath: normalized,
  };
}

async function getStoredDataDir() {
  const value = await invokeCommand('storage:get', {
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
      ...scoped,
    };
  }

  return {
    kind: 'local',
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

  return invokeCommand('fs:pathExists', target.resolvedPath);
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

  return invokeCommand('fs:stat', target.resolvedPath);
}

async function readdirAt(target) {
  if (target.kind === 'scoped') {
    const entries = await scopedReadDir(target.folderId, target.relativePath);
    return entries
      .map((entry) => entry.name)
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  }

  return invokeCommand('fs:readdir', target.resolvedPath);
}

async function readBinaryAt(target) {
  if (target.kind === 'scoped') {
    return scopedReadFile(target.folderId, target.relativePath);
  }

  return base64ToUint8Array(
    await invokeCommand('fs:readData', target.resolvedPath)
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

  return invokeCommand('fs:writeFile', {
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

  return invokeCommand('fs:ensureDir', target.resolvedPath);
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

  return invokeCommand('fs:remove', target.resolvedPath);
}

async function copyBetween(source, destination) {
  if (source.kind === 'local' && destination.kind === 'local') {
    return invokeCommand('fs:copy', {
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
      return invokeCommand(channel, payload);
  }
}

async function handleMobileScopedDialog() {
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

  const tempDir = await invokeCommand('helper:get-path', 'temp');
  const stagingRoot = buildPath(
    tempDir,
    'beaver-notes-mobile-imports',
    uniqueToken()
  );

  await invokeCommand('fs:ensureDir', stagingRoot);

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
    await invokeCommand('fs:writeFile', {
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

function payloadUsesScopedPath(payload) {
  if (typeof payload === 'string') return isScopedPath(payload);
  if (!payload || typeof payload !== 'object') return false;
  return [payload.path, payload.dest].some((value) => isScopedPath(value));
}

function isScopedFsChannel(channel) {
  return channel.startsWith('fs:');
}

export async function invokeWithScopedSupport(channel, payload) {
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
    return handleMobileScopedDialog();
  }

  if (isScopedFsChannel(channel) && payloadUsesScopedPath(payload)) {
    return handleScopedFsInvoke(channel, payload);
  }

  if (channel === 'dialog:open' && payload?.useScopedStorage) {
    const { useScopedStorage, ...rest } = payload;
    return invokeCommand(channel, rest);
  }

  return invokeCommand(channel, payload);
}
