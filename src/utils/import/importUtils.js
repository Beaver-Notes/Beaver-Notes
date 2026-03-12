import { v4 as uuidv4 } from 'uuid';

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

export function sanitizeFilename(name) {
  return (
    String(name || '')
      .replace(/[\/\\:*?"<>|]/g, '-')
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
