import { v4 as uuidv4 } from 'uuid';
import { path } from '@/lib/tauri-bridge';
import { readFile } from '@/lib/native/fs';
import { useNoteStore } from '@/store/note';
import { convertMarkdownToTiptap } from '@/utils/markdown';
import { htmlToTiptap } from './bulkImport';
import { parseFrontmatter, addImportedNote, parseDateValue } from './helpers';

export async function extractImportTitle(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  try {
    const raw = await readFile(filePath);

    switch (ext) {
      case '.md':
      case '.mdx': {
        const { meta } = parseFrontmatter(raw);
        const baseName = fileName.replace(/\.(md|mdx)$/i, '');
        return meta.title || baseName || 'Untitled';
      }
      case '.html': {
        const titleMatch = raw.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) return titleMatch[1].trim();
        return fileName.replace(/\.html$/i, '') || 'Untitled';
      }
      case '.txt': {
        const firstLine = raw.split('\n')[0]?.trim();
        return firstLine || fileName.replace(/\.txt$/i, '') || 'Untitled';
      }
      default:
        return fileName || 'Untitled';
    }
  } catch {
    return fileName || 'Untitled';
  }
}

export async function importSingleMarkdown(filePath, folderId = null) {
  const noteStore = useNoteStore();
  const raw = await readFile(filePath);
  const { meta, body } = parseFrontmatter(raw);
  const id = uuidv4();
  const fileName = path.basename(filePath);
  const title =
    meta.title || fileName.replace(/\.(md|mdx)$/i, '') || 'Untitled';

  const { content } = await convertMarkdownToTiptap(
    body,
    id,
    path.dirname(filePath)
  );

  await addImportedNote(noteStore, {
    id,
    title,
    content,
    labels: meta.labels || [],
    folderId,
    createdAt: parseDateValue(meta.created),
    updatedAt: parseDateValue(meta.updated),
  });

  return id;
}

export async function importSingleText(filePath, folderId = null) {
  const noteStore = useNoteStore();
  const raw = await readFile(filePath);
  const id = uuidv4();
  const fileName = path.basename(filePath).replace(/\.txt$/i, '') || 'Untitled';

  const content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: raw }],
      },
    ],
  };

  await addImportedNote(noteStore, {
    id,
    title: fileName,
    content,
    labels: [],
    folderId,
  });

  return id;
}

export async function importSingleHTML(filePath, folderId = null) {
  const noteStore = useNoteStore();
  const raw = await readFile(filePath);
  const id = uuidv4();
  const fileName =
    path.basename(filePath).replace(/\.html$/i, '') || 'Untitled';

  const titleMatch = raw.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : fileName;

  const content = await htmlToTiptap(raw, id, '');

  await addImportedNote(noteStore, {
    id,
    title,
    content,
    labels: [],
    folderId,
  });

  return id;
}

const EXTENSION_MAP = {
  md: importSingleMarkdown,
  mdx: importSingleMarkdown,
  txt: importSingleText,
  html: importSingleHTML,
};

export const SUPPORTED_EXTENSIONS = Object.keys(EXTENSION_MAP);

export async function importSingleFile(filePath, folderId = null) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const importer = EXTENSION_MAP[ext];
  if (!importer) {
    throw new Error(`Unsupported file format: .${ext}`);
  }
  return importer(filePath, folderId);
}
