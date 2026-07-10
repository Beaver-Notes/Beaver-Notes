import { v4 as uuidv4 } from 'uuid';
import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import {
  copyPath,
  ensureDir,
  isFile as nativeIsFile,
  pathExists as nativePathExists,
  readDir,
  readFile,
} from '@/lib/native/fs';
import { base64ToUint8Array } from '@/utils/helpers/index.js';
import { convertMarkdownToTiptap } from '@/utils/markdown';
import mime from 'mime';

function normalizeFolderCollection(folderStore) {
  return Array.isArray(folderStore?.data)
    ? folderStore.data
    : Object.values(folderStore?.data || {});
}

function parseScalarValue(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed;
}

function parseInlineArray(value) {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.trim()) return [];
  return inner
    .split(',')
    .map((item) => parseScalarValue(item))
    .filter(Boolean);
}

export function getPathParts(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
}

export function getRelativeParts(rootPath, targetPath) {
  const rootParts = getPathParts(rootPath);
  const targetParts = getPathParts(targetPath);
  return targetParts.slice(rootParts.length);
}

export function stripExtension(fileName) {
  return path.parse(fileName).name;
}

export function parseDateValue(value) {
  if (!value) return Date.now();
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

export function mergeLabels(...values) {
  return [
    ...new Set(
      values
        .flat()
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean)
    ),
  ];
}

export async function ensureAppDirectory(appDirectory) {
  if (typeof appDirectory === 'string' && appDirectory.trim()) {
    return appDirectory.trim();
  }
  const directory = await getAppDirectory();
  return typeof directory === 'string' ? directory.trim() : '';
}

export async function pathExists(targetPath) {
  try {
    return await nativePathExists(targetPath);
  } catch {
    return false;
  }
}

export async function isFile(targetPath) {
  try {
    return await nativeIsFile(targetPath);
  } catch {
    return false;
  }
}

export function extensionForContentType(contentType) {
  return mime.getExtension(String(contentType || '').toLowerCase()) || 'png';
}

export function parseDataUri(value) {
  const match = String(value || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    contentType: match[1],
    data: base64ToUint8Array(match[2]),
  };
}

export async function listFilesRecursive(rootPath, extensions, options = {}) {
  const files = [];
  const { ignoreDirs = [], ignoreHidden = false } = options;

  async function walk(currentPath) {
    const entries = await readDir(currentPath);
    for (const entry of entries) {
      if (ignoreHidden && entry.startsWith('.')) continue;
      if (ignoreDirs.includes(entry)) continue;

      const fullPath = path.join(currentPath, entry);
      if (await isFile(fullPath)) {
        if (
          extensions.some((extension) =>
            entry.toLowerCase().endsWith(extension.toLowerCase())
          )
        ) {
          files.push(fullPath);
        }
        continue;
      }
      await walk(fullPath);
    }
  }

  await walk(rootPath);
  return files;
}

export async function copyDirectoryContents(sourcePath, destPath) {
  if (!(await pathExists(sourcePath))) return;
  try {
    await ensureDir(destPath);
    await copyPath(sourcePath, destPath);
  } catch (error) {
    console.warn('Asset copy failed:', error);
  }
}

export async function prepareMarkdownStaging(
  noteId,
  appDirectory,
  assetDirs = []
) {
  const stagingRoot = path.join(appDirectory, '.import-staging', noteId);
  const noteAssetsDir = path.join(stagingRoot, 'notes-assets');
  const fileAssetsDir = path.join(stagingRoot, 'file-assets');
  await ensureDir(noteAssetsDir);
  await ensureDir(fileAssetsDir);

  for (const assetDir of assetDirs) {
    if (!(await pathExists(assetDir))) continue;
    try {
      await copyPath(assetDir, noteAssetsDir);
      await copyPath(assetDir, fileAssetsDir);
    } catch (error) {
      console.warn('Staging asset copy failed:', error);
    }
  }

  return stagingRoot;
}

export async function addImportedNote(noteStore, payload) {
  await noteStore.add({
    id: payload.id,
    title: payload.title,
    content: payload.content,
    labels: payload.labels || [],
    folderId: payload.folderId || null,
    createdAt: payload.createdAt || Date.now(),
    updatedAt: payload.updatedAt || Date.now(),
    isBookmarked: false,
    isArchived: false,
  });
}

export function extractBearTags(markdown) {
  const labels = new Set();
  let output = '';
  let index = 0;
  let inFence = false;
  let inInlineCode = false;

  while (index < markdown.length) {
    if (markdown.startsWith('```', index)) {
      inFence = !inFence;
      output += '```';
      index += 3;
      continue;
    }

    const char = markdown[index];
    if (!inFence && char === '`') {
      inInlineCode = !inInlineCode;
      output += char;
      index += 1;
      continue;
    }

    if (!inFence && !inInlineCode && char === '#') {
      const prev = index === 0 ? ' ' : markdown[index - 1];
      const next = markdown[index + 1] || '';
      if (/\s|[([{"'.,;:!?]/.test(prev) && /[A-Za-z0-9_-]/.test(next)) {
        let end = index + 1;
        while (end < markdown.length && /[A-Za-z0-9_-]/.test(markdown[end])) {
          end += 1;
        }
        const tag = markdown.slice(index + 1, end);
        if (tag) {
          labels.add(tag);
          index = end;
          continue;
        }
      }
    }

    output += char;
    index += 1;
  }

  return {
    labels: [...labels],
    body: output.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n'),
  };
}

export async function importMarkdownFile({
  filePath,
  sourceRoot,
  noteStore,
  folderStore,
  appDirectory,
  createdFolderIds,
  assetDirs = [],
  labels = [],
  onProgress,
  done,
  total,
  folderPartsTransform = (parts) => parts,
  titleTransform = (value) => value,
}) {
  const rawMarkdown = await readFile(filePath);
  const { meta, body } = parseFrontmatter(rawMarkdown);
  const id = uuidv4();
  const fileName = path.basename(filePath);
  const derivedTitle = titleTransform(stripExtension(fileName));
  const title = meta.title || derivedTitle || 'Untitled';
  const directoryPath = path.dirname(filePath);
  const relativeFolderParts = folderPartsTransform(
    getRelativeParts(sourceRoot, directoryPath)
  );
  const folderId =
    relativeFolderParts.length > 0
      ? await buildFolderIdFromPath(
          relativeFolderParts,
          folderStore,
          createdFolderIds
        )
      : null;
  const stagingRoot =
    assetDirs.length > 0
      ? await prepareMarkdownStaging(id, appDirectory, assetDirs)
      : directoryPath;
  const { content } = await convertMarkdownToTiptap(body, id, stagingRoot);

  await addImportedNote(noteStore, {
    id,
    title,
    content,
    labels: mergeLabels(meta.labels || [], labels),
    folderId,
    createdAt: parseDateValue(meta.created),
    updatedAt: parseDateValue(meta.updated),
  });

  for (const assetDir of assetDirs) {
    await copyDirectoryContents(
      assetDir,
      path.join(appDirectory, 'notes-assets', id)
    );
  }

  onProgress?.({ done, total, current: title });
}

export function applyMarkToNode(node, mark) {
  if (!node) return node;
  if (Array.isArray(node)) {
    return node.map((item) => applyMarkToNode(item, mark));
  }
  if (node.type === 'text') {
    return {
      ...node,
      marks: [...(node.marks || []), mark],
    };
  }
  if (Array.isArray(node.content)) {
    return {
      ...node,
      content: node.content.map((child) => applyMarkToNode(child, mark)),
    };
  }
  return node;
}

export function flattenNodes(nodes) {
  return (nodes || []).flatMap((node) => (Array.isArray(node) ? node : [node]));
}

export function extractTextContent(node) {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  return Array.from(node.childNodes || [])
    .map((child) => extractTextContent(child))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveRelativeAssetValue(value, noteId, resources = []) {
  const source = String(value || '').trim();
  if (!source) return '';
  if (
    /^https?:\/\//i.test(source) ||
    /^mailto:/i.test(source) ||
    source.startsWith('assets://') ||
    source.startsWith('file-assets://')
  ) {
    return source;
  }

  if (source.startsWith('resource://')) {
    const hash = source.replace('resource://', '');
    const match = resources.find((resource) => resource.hash === hash);
    return match ? `assets://${noteId}/${match.filename}` : source;
  }

  const fileName = path.basename(source);
  return `assets://${noteId}/${fileName}`;
}

export function resolveRelativeFileValue(value, noteId, resources = []) {
  const source = String(value || '').trim();
  if (!source) return '';
  if (
    /^https?:\/\//i.test(source) ||
    /^mailto:/i.test(source) ||
    source.startsWith('assets://') ||
    source.startsWith('file-assets://')
  ) {
    return source;
  }

  if (source.startsWith('resource://')) {
    const hash = source.replace('resource://', '');
    const match = resources.find((resource) => resource.hash === hash);
    return match ? `file-assets://${noteId}/${match.filename}` : source;
  }

  const fileName = path.basename(source);
  return `file-assets://${noteId}/${fileName}`;
}

export function sanitizeFilename(name) {
  return (
    String(name || '')
      .replace(/[/\\:*?"<>|]/g, '-')
      .trim() || 'Untitled'
  );
}

export function stripNotionId(name) {
  return String(name || '')
    .replace(/\s+[0-9a-f]{32}(\.[^.]+)?$/i, '$1')
    .trim();
}

export function parseFrontmatter(markdown) {
  const source = String(markdown || '');
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    return { meta: {}, body: source };
  }

  const normalized = source.replace(/\r\n/g, '\n');
  const endIndex = normalized.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return { meta: {}, body: source };
  }

  const frontmatter = normalized.slice(4, endIndex);
  const body = normalized.slice(endIndex + 5);
  const meta = {};
  let currentArrayKey = null;

  frontmatter.split('\n').forEach((rawLine) => {
    const line = rawLine.trimEnd();
    if (!line.trim()) return;

    const arrayMatch = line.match(/^\s*-\s+(.*)$/);
    if (arrayMatch && currentArrayKey) {
      if (!Array.isArray(meta[currentArrayKey])) {
        meta[currentArrayKey] = [];
      }
      meta[currentArrayKey].push(parseScalarValue(arrayMatch[1]));
      return;
    }

    currentArrayKey = null;
    const separator = line.indexOf(':');
    if (separator === -1) return;

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    if (!key) return;

    if (!value) {
      meta[key] = [];
      currentArrayKey = key;
      return;
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = parseInlineArray(value);
      return;
    }

    meta[key] = parseScalarValue(value);
  });

  return { meta, body };
}

export async function getOrCreateFolder(
  name,
  parentId,
  folderStore,
  createdFolderIds = null
) {
  const normalizedName = String(name || '').trim();
  const normalizedParentId = parentId || null;
  const existing = normalizeFolderCollection(folderStore).find(
    (folder) =>
      folder?.name === normalizedName &&
      (folder?.parentId || null) === normalizedParentId
  );

  if (existing) return existing.id;

  const id = uuidv4();
  await folderStore.add({
    id,
    name: normalizedName,
    parentId: normalizedParentId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  createdFolderIds?.add(id);
  return id;
}

export async function buildFolderIdFromPath(
  parts,
  folderStore,
  createdFolderIds = null
) {
  let parentId = null;

  for (const rawPart of parts || []) {
    const part = String(rawPart || '').trim();
    if (!part) continue;
    parentId = await getOrCreateFolder(
      part,
      parentId,
      folderStore,
      createdFolderIds
    );
  }

  return parentId;
}
