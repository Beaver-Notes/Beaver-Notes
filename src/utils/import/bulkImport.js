import { v4 as uuidv4 } from 'uuid';
import { path } from '@/lib/tauri-bridge';
import { ensureDir, readDir, readFile, writeFile } from '@/lib/native/fs';
import { onImportComplete, onImportProgress } from '@/lib/native/imports';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { convertMarkdownToTiptap } from '@/utils/markdown';
import {
  createMediaFallbackNode,
  sanitizeImageSource,
  sanitizeImportedHtml,
} from '@/utils/note/contentSecurity.js';
import { ensureKeyReadyForWrite } from '@/utils/crypto/encryption.js';
import {
  stripExtension,
  stripNotionId,
  sanitizeFilename,
  parseFrontmatter,
  buildFolderIdFromPath,
  ensureAppDirectory,
  pathExists,
  listFilesRecursive,
  copyDirectoryContents,
  prepareMarkdownStaging,
  addImportedNote,
  flushImportedNotes,
  importMarkdownFile,
  parseDateValue,
  mergeLabels,
  extractBearTags,
  getRelativeParts,
  applyMarkToNode,
  flattenNodes,
  extractTextContent,
  resolveRelativeAssetValue,
  resolveRelativeFileValue,
} from './helpers';

// ─── HTML to Tiptap conversion ───────────────────────────────────────────────

function convertHtmlNodeToTiptap(node, noteId, resources = []) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || '';
    if (!text.trim()) return null;
    return { type: 'text', text };
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const tagName = node.tagName.toUpperCase();
  let content = flattenNodes(
    Array.from(node.childNodes || [])
      .map((child) => convertHtmlNodeToTiptap(child, noteId, resources))
      .filter(Boolean)
  );

  switch (tagName) {
    case 'P':
      return { type: 'paragraph', content };
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6':
      return {
        type: 'heading',
        attrs: { level: Number(tagName.replace('H', '')) },
        content,
      };
    case 'UL':
      return {
        type: 'bulletList',
        content: flattenNodes(content).filter(
          (child) => child?.type === 'listItem'
        ),
      };
    case 'OL':
      return {
        type: 'orderedList',
        attrs: { order: Number(node.getAttribute('start') || 1) },
        content: flattenNodes(content).filter(
          (child) => child?.type === 'listItem'
        ),
      };
    case 'LI':
      return {
        type: 'listItem',
        content:
          content.length > 0
            ? content
            : [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: extractTextContent(node) }],
                },
              ],
      };
    case 'BLOCKQUOTE':
      return { type: 'blockquote', content };
    case 'PRE': {
      const codeElement = node.querySelector('code');
      const codeText = codeElement?.textContent || node.textContent || '';
      const className = codeElement?.getAttribute('class') || '';
      return {
        type: 'codeBlock',
        attrs: { language: className.replace('language-', '') },
        content: [{ type: 'text', text: codeText }],
      };
    }
    case 'CODE':
      if (node.parentElement?.tagName?.toUpperCase() === 'PRE') {
        return null;
      }
      return applyMarkToNode(
        { type: 'text', text: node.textContent || '' },
        { type: 'code' }
      );
    case 'TABLE': {
      const rows = Array.from(node.querySelectorAll('tr')).map(
        (row, rowIndex) => ({
          type: 'tableRow',
          content: Array.from(row.cells).map((cell) => ({
            type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
            attrs: {
              colspan: cell.colSpan || 1,
              rowspan: cell.rowSpan || 1,
            },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: extractTextContent(cell) }],
              },
            ],
          })),
        })
      );
      return { type: 'table', content: rows };
    }
    case 'IMG': {
      const src = resolveRelativeAssetValue(
        node.getAttribute('src'),
        noteId,
        resources
      );
      const safeSrc = sanitizeImageSource(src);

      if (!safeSrc) {
        return createMediaFallbackNode('image', {
          src: node.getAttribute('src'),
          alt: node.getAttribute('alt') || '',
        });
      }

      return {
        type: 'image',
        attrs: {
          src: safeSrc,
          alt: node.getAttribute('alt') || '',
        },
      };
    }
    case 'STRONG':
      return content.map((child) => applyMarkToNode(child, { type: 'bold' }));
    case 'EM':
      return content.map((child) => applyMarkToNode(child, { type: 'italic' }));
    case 'S':
      return content.map((child) => applyMarkToNode(child, { type: 'strike' }));
    case 'A': {
      const href = node.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
        return content.map((child) =>
          applyMarkToNode(child, {
            type: 'link',
            attrs: {
              href,
              target: '_blank',
              rel: 'noopener noreferrer nofollow',
            },
          })
        );
      }

      return {
        type: 'fileEmbed',
        attrs: {
          src: resolveRelativeFileValue(href, noteId, resources),
          fileName: node.textContent?.trim() || path.basename(href),
        },
      };
    }
    case 'HR':
      return { type: 'horizontalRule' };
    case 'IFRAME':
      return createMediaFallbackNode(
        'iframe',
        { src: node.getAttribute('src') },
        node.parentElement?.tagName?.toLowerCase()
      );
    case 'BR':
      return { type: 'hardBreak' };
    default: {
      const fallbackText = extractTextContent(node);
      if (!fallbackText) return null;
      return {
        type: 'paragraph',
        content: [{ type: 'text', text: fallbackText }],
      };
    }
  }
}

// ─── Concurrency helper ──────────────────────────────────────────────────────

async function processWithConcurrency(items, fn, concurrency = 4) {
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    await Promise.all(batch.map(fn));
    if (typeof yieldToUi === 'function') await yieldToUi();
  }
}

// ─── Native Rust import ──────────────────────────────────────────────────────

async function processRustImportNote(note, state, appDirectory) {
  const noteStore = useNoteStore();
  const folderStore = useFolderStore();
  const id = uuidv4();
  let folderId = null;

  if (note.folder) {
    const parts = note.folder
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      folderId = await buildFolderIdFromPath(
        parts,
        folderStore,
        state.folderIds
      );
    }
  }

  const noteAssetDir = path.join(appDirectory, 'assets', id);
  await ensureDir(noteAssetDir);

  await ensureKeyReadyForWrite();

  const resourcePromises = (note.resources || []).map((resource) => {
    try {
      return readFile(resource.path).then((data) =>
        writeFile(
          path.join(noteAssetDir, resource.filename || resource.hash),
          data
        )
      );
    } catch (error) {
      console.warn('Resource write failed:', error);
      return Promise.resolve();
    }
  });
  await Promise.all(resourcePromises);

  const content = await htmlToTiptap(note.content || '', id, appDirectory, {
    resources: note.resources || [],
  });

  addImportedNote(noteStore, {
    id,
    title: note.title || 'Untitled',
    content,
    labels: note.labels || [],
    folderId,
    createdAt: note.createdAt || Date.now(),
    updatedAt: note.updatedAt || Date.now(),
  });

  state.imported += 1;
}

export function startRustImport(source, onProgress) {
  return new Promise((resolve) => {
    const state = {
      imported: 0,
      folderIds: new Set(),
      errors: [],
    };
    const pendingNotes = [];
    let processing = Promise.resolve();

    (async () => {
      const appDirectory = await ensureAppDirectory();

      const unlistenProgress = await onImportProgress(async (_, payload) => {
        if (payload.source !== source) return;

        if (typeof onProgress === 'function') {
          onProgress({
            done: payload.done,
            total: payload.total,
            current: payload.current,
          });
        }

        if (payload.note) {
          pendingNotes.push(payload.note);
        }
      });

      const unlistenComplete = await onImportComplete(async (_, payload) => {
        if (payload.source !== source) return;

        unlistenProgress();
        unlistenComplete();

        await processWithConcurrency(
          pendingNotes,
          async (note) => {
            try {
              await processRustImportNote(note, state, appDirectory);
            } catch (error) {
              state.errors.push({
                title: note.title || 'Untitled',
                reason: error?.message || String(error),
              });
            }
          },
          4
        );

        await flushImportedNotes();

        resolve({
          imported: state.imported,
          folders: state.folderIds.size,
          errors: [...(payload.errors || []), ...state.errors],
        });
      });
    })();
  });
}

export function htmlToTiptap(html, noteId, _appDirectory, options = {}) {
  const resources = options.resources || [];
  const resourceMap =
    resources.length > 0
      ? new Map(resources.map((r) => [r.hash, r]))
      : resources;

  const doc =
    html instanceof Document
      ? html
      : sanitizeImportedHtml(html, { allowRelative: true });
  const content = flattenNodes(
    Array.from(doc.body.childNodes || [])
      .map((node) => convertHtmlNodeToTiptap(node, noteId, resourceMap))
      .filter(Boolean)
  );

  return {
    type: 'doc',
    content,
  };
}

// ─── Bulk platform importers ─────────────────────────────────────────────────

export async function importObsidian(
  vaultPath,
  noteStore,
  folderStore,
  appDirectory,
  onProgress
) {
  const resolvedAppDirectory = await ensureAppDirectory(appDirectory);
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
      const { meta, body } = parseFrontmatter(markdown);
      const fallbackTitle = stripExtension(path.basename(filePath));
      const title = meta.title || fallbackTitle || 'Untitled';
      const assetDir = path.join(path.dirname(filePath), title);

      await importMarkdownFile({
        filePath,
        sourceRoot: vaultPath,
        noteStore,
        folderStore,
        appDirectory: resolvedAppDirectory,
        createdFolderIds,
        assetDirs: (await pathExists(assetDir)) ? [assetDir] : [],
        onProgress,
        done: done + 1,
        total: files.length,
        rawMarkdown: markdown,
        parsedMeta: { meta, body },
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

  await flushImportedNotes();
  return { imported, folders: createdFolderIds.size, errors };
}

export async function importNotion(
  exportPath,
  noteStore,
  folderStore,
  appDirectory,
  onProgress
) {
  const resolvedAppDirectory = await ensureAppDirectory(appDirectory);
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
          appDirectory: resolvedAppDirectory,
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
            path.join(resolvedAppDirectory, 'assets', id)
          );
        }

        const content = await htmlToTiptap(html, id, resolvedAppDirectory);
        addImportedNote(noteStore, {
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

  await flushImportedNotes();
  return { imported, folders: createdFolderIds.size, errors };
}

export async function importBear(
  exportPath,
  noteStore,
  _folderStore,
  appDirectory,
  onProgress
) {
  const resolvedAppDirectory = await ensureAppDirectory(appDirectory);
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
        ? await prepareMarkdownStaging(id, resolvedAppDirectory, [assetDir])
        : exportPath;
      const { content } = await convertMarkdownToTiptap(body, id, stagingRoot);

      addImportedNote(noteStore, {
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

  await flushImportedNotes();
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

      addImportedNote(noteStore, {
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

  await flushImportedNotes();
  return { imported, folders: 0, errors };
}

export async function importGenericMarkdown(
  folderPath,
  noteStore,
  folderStore,
  appDirectory,
  onProgress
) {
  const resolvedAppDirectory = await ensureAppDirectory(appDirectory);
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
        appDirectory: resolvedAppDirectory,
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

  await flushImportedNotes();
  return { imported, folders: createdFolderIds.size, errors };
}
