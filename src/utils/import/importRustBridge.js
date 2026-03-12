import { v4 as uuidv4 } from 'uuid';
import { ipcRenderer, path } from '@/lib/tauri-bridge';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { useStorage } from '@/composable/storage';
import { buildFolderIdFromPath } from './importUtils';

const storage = useStorage('settings');

function applyMarkToNode(node, mark) {
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

function flattenNodes(nodes) {
  return (nodes || []).flatMap((node) => (Array.isArray(node) ? node : [node]));
}

function extractTextContent(node) {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  return Array.from(node.childNodes || [])
    .map((child) => extractTextContent(child))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveRelativeAssetValue(value, noteId, resources = []) {
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

function resolveRelativeFileValue(value, noteId, resources = []) {
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

async function convertHtmlNodeToTiptap(node, noteId, resources = []) {
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
    (
      await Promise.all(
        Array.from(node.childNodes || []).map((child) =>
          convertHtmlNodeToTiptap(child, noteId, resources)
        )
      )
    ).filter(Boolean)
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
    case 'IMG':
      return {
        type: 'image',
        attrs: {
          src: resolveRelativeAssetValue(
            node.getAttribute('src'),
            noteId,
            resources
          ),
          alt: node.getAttribute('alt') || '',
        },
      };
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
      return {
        type: 'iframe',
        attrs: {
          src: node.getAttribute('src'),
          frameborder: node.getAttribute('frameborder') || 0,
          allowfullscreen: node.hasAttribute('allowfullscreen'),
        },
      };
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

async function processRustImportNote(note, state) {
  const noteStore = useNoteStore();
  const folderStore = useFolderStore();
  const dataDir = await storage.get('dataDir', '');
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

  const noteAssetDir = path.join(dataDir, 'notes-assets', id);
  await ipcRenderer.callMain('fs:ensureDir', noteAssetDir);

  for (const resource of note.resources || []) {
    try {
      await ipcRenderer.callMain('fs:writeFile', {
        path: path.join(noteAssetDir, resource.filename || resource.hash),
        data: base64ToUint8Array(resource.data || ''),
      });
    } catch (error) {
      console.warn('Resource write failed:', error);
    }
  }

  const content = await htmlToTiptap(note.content || '', id, dataDir, {
    resources: note.resources || [],
  });

  await noteStore.add({
    id,
    title: note.title || 'Untitled',
    content,
    labels: note.labels || [],
    folderId,
    createdAt: note.createdAt || Date.now(),
    updatedAt: note.updatedAt || Date.now(),
    isBookmarked: false,
    isArchived: false,
  });

  state.imported += 1;
}

export function startRustImport(source, onProgress) {
  return new Promise(async (resolve) => {
    const state = {
      imported: 0,
      folderIds: new Set(),
      errors: [],
    };
    let completionErrors = [];
    let processing = Promise.resolve();

    const unlistenProgress = await ipcRenderer.on(
      'import-progress',
      async (_, payload) => {
        if (payload.source !== source) return;

        if (typeof onProgress === 'function') {
          onProgress({
            done: payload.done,
            total: payload.total,
            current: payload.current,
          });
        }

        if (payload.note) {
          processing = processing.then(async () => {
            try {
              await processRustImportNote(payload.note, state);
            } catch (error) {
              state.errors.push({
                title: payload.note.title || 'Untitled',
                reason: error?.message || String(error),
              });
            }
          });
        }
      }
    );

    const unlistenComplete = await ipcRenderer.on(
      'import-complete',
      async (_, payload) => {
        if (payload.source !== source) return;

        completionErrors = [...(payload.errors || [])];
        unlistenProgress();
        unlistenComplete();
        await processing;

        resolve({
          imported: state.imported,
          folders: state.folderIds.size,
          errors: [...completionErrors, ...state.errors],
        });
      }
    );
  });
}

export function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function htmlToTiptap(html, noteId, _dataDir, options = {}) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html || '', 'text/html');
  const content = flattenNodes(
    (
      await Promise.all(
        Array.from(doc.body.childNodes || []).map((node) =>
          convertHtmlNodeToTiptap(node, noteId, options.resources || [])
        )
      )
    ).filter(Boolean)
  );

  return {
    type: 'doc',
    content,
  };
}
