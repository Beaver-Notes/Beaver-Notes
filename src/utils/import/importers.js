import { v4 as uuidv4 } from 'uuid';
import mammoth from 'mammoth';
import { path } from '@/lib/tauri-bridge';
import { getHelperPath } from '@/lib/native/app';
import {
  copyPath,
  ensureDir,
  isFile as nativeIsFile,
  pathExists as nativePathExists,
  readData,
  readDir,
  readFile,
  writeFile,
} from '@/lib/native/fs';
import { convertMarkdownToTiptap } from '@/utils/markdown-helper';
import {
  parseFrontmatter,
  stripNotionId,
  sanitizeFilename,
  buildFolderIdFromPath,
} from './importUtils';
import { useStorage } from '@/composable/storage';
import { htmlToTiptap } from './importRustBridge';

const storage = useStorage('settings');

function getPathParts(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
}

function getRelativeParts(rootPath, targetPath) {
  const rootParts = getPathParts(rootPath);
  const targetParts = getPathParts(targetPath);
  return targetParts.slice(rootParts.length);
}

function stripExtension(fileName) {
  return path.parse(fileName).name;
}

function parseDateValue(value) {
  if (!value) return Date.now();
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

function mergeLabels(...values) {
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

async function ensureDataDir(dataDir) {
  if (typeof dataDir === 'string' && dataDir.trim()) {
    return dataDir.trim();
  }
  const stored = await storage.get('dataDir', '');
  if (typeof stored === 'string' && stored.trim()) {
    return stored.trim();
  }
  const userDataDir = await getHelperPath('userData');
  return typeof userDataDir === 'string' ? userDataDir.trim() : '';
}

async function pathExists(targetPath) {
  try {
    return await nativePathExists(targetPath);
  } catch {
    return false;
  }
}

async function isFile(targetPath) {
  try {
    return await nativeIsFile(targetPath);
  } catch {
    return false;
  }
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function extensionForContentType(contentType) {
  switch (String(contentType || '').toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/png':
    default:
      return 'png';
  }
}

function parseDataUri(value) {
  const match = String(value || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;

  return {
    contentType: match[1],
    data: base64ToUint8Array(match[2]),
  };
}

async function convertWordToHtml(filePath) {
  const fileBase64 = await readData(filePath);
  const fileBytes = base64ToUint8Array(fileBase64);
  const arrayBuffer = fileBytes.buffer.slice(
    fileBytes.byteOffset,
    fileBytes.byteOffset + fileBytes.byteLength
  );

  return mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.inline(async (image) => {
        const base64 = await image.read('base64');
        return {
          src: `data:${image.contentType || 'image/png'};base64,${base64}`,
        };
      }),
    }
  );
}

async function storeWordImages(html, noteId, dataDir) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html || '', 'text/html');
  const images = Array.from(doc.querySelectorAll('img'));

  if (!images.length) {
    return doc.body.innerHTML;
  }

  const noteAssetsDir = path.join(dataDir, 'notes-assets', noteId);
  await ensureDir(noteAssetsDir);

  let imageIndex = 1;

  for (const image of images) {
    const parsed = parseDataUri(image.getAttribute('src'));
    if (!parsed?.data?.length) continue;

    const extension = extensionForContentType(parsed.contentType);
    const fileName = `word-image-${imageIndex}.${extension}`;
    imageIndex += 1;

    await writeFile(path.join(noteAssetsDir, fileName), parsed.data);
    image.setAttribute('src', `assets://${noteId}/${fileName}`);
  }

  return doc.body.innerHTML;
}

async function listFilesRecursive(rootPath, extensions, options = {}) {
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

async function copyDirectoryContents(sourcePath, destPath) {
  if (!(await pathExists(sourcePath))) return;
  try {
    await ensureDir(destPath);
    await copyPath(sourcePath, destPath);
  } catch (error) {
    console.warn('Asset copy failed:', error);
  }
}

async function prepareMarkdownStaging(noteId, dataDir, assetDirs = []) {
  const stagingRoot = path.join(dataDir, '.import-staging', noteId);
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

async function addImportedNote(noteStore, payload) {
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

function extractBearTags(markdown) {
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

async function importMarkdownFile({
  filePath,
  sourceRoot,
  noteStore,
  folderStore,
  dataDir,
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
      ? await prepareMarkdownStaging(id, dataDir, assetDirs)
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
      path.join(dataDir, 'notes-assets', id)
    );
  }

  onProgress?.({ done, total, current: title });
}

export async function importObsidian(
  vaultPath,
  noteStore,
  folderStore,
  dataDir,
  onProgress
) {
  const resolvedDataDir = await ensureDataDir(dataDir);
  const files = await listFilesRecursive(vaultPath, ['.md'], {
    ignoreDirs: ['.obsidian', '.trash'],
    ignoreHidden: true,
  });
  const errors = [];
  const createdFolderIds = new Set();
  let imported = 0;
  let done = 0;

  for (const filePath of files) {
    try {
      const markdown = await readFile(filePath);
      const { meta } = parseFrontmatter(markdown);
      const fallbackTitle = stripExtension(path.basename(filePath));
      const title = meta.title || fallbackTitle || 'Untitled';
      const assetDir = path.join(path.dirname(filePath), title);

      await importMarkdownFile({
        filePath,
        sourceRoot: vaultPath,
        noteStore,
        folderStore,
        dataDir: resolvedDataDir,
        createdFolderIds,
        assetDirs: (await pathExists(assetDir)) ? [assetDir] : [],
        onProgress,
        done: done + 1,
        total: files.length,
      });
      imported += 1;
    } catch (error) {
      errors.push({
        title: path.basename(filePath),
        reason: error?.message || String(error),
      });
    } finally {
      done += 1;
      if (errors.at(-1)?.title === path.basename(filePath)) {
        onProgress?.({
          done,
          total: files.length,
          current: path.basename(filePath),
        });
      }
    }
  }

  return { imported, folders: createdFolderIds.size, errors };
}

export async function importNotion(
  exportPath,
  noteStore,
  folderStore,
  dataDir,
  onProgress
) {
  const resolvedDataDir = await ensureDataDir(dataDir);
  const files = await listFilesRecursive(exportPath, ['.md', '.html'], {
    ignoreHidden: true,
  });
  const errors = [];
  const createdFolderIds = new Set();
  let imported = 0;
  let done = 0;

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const notionBaseName = stripExtension(fileName);
    const assetDir = path.join(path.dirname(filePath), notionBaseName);
    const title = stripNotionId(notionBaseName) || 'Untitled';
    const folderParts = getRelativeParts(
      exportPath,
      path.dirname(filePath)
    ).map((part) => stripNotionId(part));

    try {
      if (fileName.toLowerCase().endsWith('.md')) {
        await importMarkdownFile({
          filePath,
          sourceRoot: exportPath,
          noteStore,
          folderStore,
          dataDir: resolvedDataDir,
          createdFolderIds,
          assetDirs: (await pathExists(assetDir)) ? [assetDir] : [],
          onProgress,
          done: done + 1,
          total: files.length,
          folderPartsTransform: () => folderParts,
          titleTransform: (value) => stripNotionId(value),
        });
      } else {
        const html = await readFile(filePath);
        const id = uuidv4();
        const folderId =
          folderParts.length > 0
            ? await buildFolderIdFromPath(
                folderParts,
                folderStore,
                createdFolderIds
              )
            : null;

        if (await pathExists(assetDir)) {
          await copyDirectoryContents(
            assetDir,
            path.join(resolvedDataDir, 'notes-assets', id)
          );
        }

        const content = await htmlToTiptap(html, id, resolvedDataDir);
        await addImportedNote(noteStore, {
          id,
          title,
          content,
          labels: [],
          folderId,
        });
        onProgress?.({ done: done + 1, total: files.length, current: title });
      }
      imported += 1;
    } catch (error) {
      errors.push({
        title,
        reason: error?.message || String(error),
      });
      onProgress?.({ done: done + 1, total: files.length, current: title });
    } finally {
      done += 1;
    }
  }

  return { imported, folders: createdFolderIds.size, errors };
}

export async function importBear(
  exportPath,
  noteStore,
  _folderStore,
  dataDir,
  onProgress
) {
  const resolvedDataDir = await ensureDataDir(dataDir);
  const entries = await readDir(exportPath);
  const files = entries
    .filter((entry) => entry.toLowerCase().endsWith('.md'))
    .map((entry) => path.join(exportPath, entry));
  const errors = [];
  let imported = 0;
  let done = 0;

  for (const filePath of files) {
    try {
      const rawMarkdown = await readFile(filePath);
      const { labels: inlineLabels, body: bodyWithoutTags } =
        extractBearTags(rawMarkdown);
      const { meta, body } = parseFrontmatter(bodyWithoutTags);
      const id = uuidv4();
      const title =
        meta.title || stripExtension(path.basename(filePath)) || 'Untitled';
      const assetDir = path.join(exportPath, title);
      const stagingRoot = (await pathExists(assetDir))
        ? await prepareMarkdownStaging(id, resolvedDataDir, [assetDir])
        : exportPath;
      const { content } = await convertMarkdownToTiptap(body, id, stagingRoot);

      if (await pathExists(assetDir)) {
        await copyDirectoryContents(
          assetDir,
          path.join(resolvedDataDir, 'notes-assets', id)
        );
      }

      await addImportedNote(noteStore, {
        id,
        title,
        content,
        labels: mergeLabels(meta.labels || [], inlineLabels),
        folderId: null,
        createdAt: parseDateValue(meta.created),
        updatedAt: parseDateValue(meta.updated),
      });
      imported += 1;
      onProgress?.({ done: done + 1, total: files.length, current: title });
    } catch (error) {
      errors.push({
        title: path.basename(filePath),
        reason: error?.message || String(error),
      });
      onProgress?.({
        done: done + 1,
        total: files.length,
        current: path.basename(filePath),
      });
    } finally {
      done += 1;
    }
  }

  return { imported, folders: 0, errors };
}

export async function importSimplenote(jsonPath, noteStore, onProgress) {
  const raw = await readFile(jsonPath);
  const parsed = JSON.parse(raw);
  const notes = Array.isArray(parsed.activeNotes) ? parsed.activeNotes : [];
  const errors = [];
  let imported = 0;
  let done = 0;

  for (const note of notes) {
    try {
      const id = uuidv4();
      const [titleLine = 'Untitled', ...bodyLines] = String(
        note?.content || ''
      ).split('\n');
      const { content } = await convertMarkdownToTiptap(
        bodyLines.join('\n').trim(),
        id,
        path.dirname(jsonPath)
      );

      await addImportedNote(noteStore, {
        id,
        title: titleLine.trim() || 'Untitled',
        content,
        labels: note?.tags || [],
        folderId: null,
        createdAt: parseDateValue(note?.creationDate),
        updatedAt: parseDateValue(note?.lastModified),
      });
      imported += 1;
      onProgress?.({
        done: done + 1,
        total: notes.length,
        current: titleLine.trim() || 'Untitled',
      });
    } catch (error) {
      errors.push({
        title: note?.content?.split('\n')[0] || 'Untitled',
        reason: error?.message || String(error),
      });
      onProgress?.({
        done: done + 1,
        total: notes.length,
        current: note?.content?.split('\n')[0] || 'Untitled',
      });
    } finally {
      done += 1;
    }
  }

  return { imported, folders: 0, errors };
}

export async function importGenericMarkdown(
  folderPath,
  noteStore,
  folderStore,
  dataDir,
  onProgress
) {
  const resolvedDataDir = await ensureDataDir(dataDir);
  const files = await listFilesRecursive(folderPath, ['.md'], {
    ignoreHidden: true,
  });
  const errors = [];
  const createdFolderIds = new Set();
  let imported = 0;
  let done = 0;

  for (const filePath of files) {
    try {
      await importMarkdownFile({
        filePath,
        sourceRoot: folderPath,
        noteStore,
        folderStore,
        dataDir: resolvedDataDir,
        createdFolderIds,
        onProgress,
        done: done + 1,
        total: files.length,
      });
      imported += 1;
    } catch (error) {
      errors.push({
        title: sanitizeFilename(path.basename(filePath)),
        reason: error?.message || String(error),
      });
      onProgress?.({
        done: done + 1,
        total: files.length,
        current: path.basename(filePath),
      });
    } finally {
      done += 1;
    }
  }

  return { imported, folders: createdFolderIds.size, errors };
}

export async function importWordDocuments(
  filePaths,
  noteStore,
  _folderStore,
  dataDir,
  onProgress
) {
  const resolvedDataDir = await ensureDataDir(dataDir);
  const files = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter(
    Boolean
  );
  const errors = [];
  let imported = 0;
  let done = 0;

  for (const filePath of files) {
    const title = stripExtension(path.basename(filePath)) || 'Untitled';

    try {
      const id = uuidv4();
      const { value: html, messages = [] } = await convertWordToHtml(filePath);
      const preparedHtml = await storeWordImages(html, id, resolvedDataDir);
      const content = await htmlToTiptap(preparedHtml, id, resolvedDataDir);

      await addImportedNote(noteStore, {
        id,
        title,
        content,
        labels: [],
        folderId: null,
      });

      messages.forEach((message) => {
        if (message?.message) {
          errors.push({
            title,
            reason: message.message,
          });
        }
      });

      imported += 1;
      onProgress?.({ done: done + 1, total: files.length, current: title });
    } catch (error) {
      errors.push({
        title,
        reason: error?.message || String(error),
      });
      onProgress?.({ done: done + 1, total: files.length, current: title });
    } finally {
      done += 1;
    }
  }

  return { imported, folders: 0, errors };
}
