import { useI18nStore } from '@/store/i18n';
import { useNoteStore } from '@/store/note';
import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { openDialog } from '@/lib/native/dialog';
import { copyPath, ensureDir, writeFile } from '@/lib/native/fs';
import { tiptapToMarkdown, buildFrontmatter } from '@/utils/markdown';
import { sanitizeFileName } from './exportBulk';
import { ensureKeyReadyForWrite } from '@/utils/crypto/encryption.js';

function getShareTranslations() {
  try {
    return useI18nStore().messages?.share || {};
  } catch {
    return {};
  }
}

export async function exportMD(noteId, noteTitle, editor) {
  const share = getShareTranslations();
  const noteStore = useNoteStore();
  const note = noteStore.data[noteId];
  const tiptapJson = editor.getJSON();
  const markdownBody = tiptapToMarkdown(tiptapJson, { noteId });
  const frontmatter = note ? buildFrontmatter(note, '') : '';
  const markdown = frontmatter
    ? `${frontmatter}\n${markdownBody}`
    : markdownBody;
  const { canceled, filePaths } = await openDialog({
    title: share.exportDataDialogTitle || 'Export note',
    properties: ['openDirectory'],
    useScopedStorage: true,
  });
  if (canceled) return;
  await ensureKeyReadyForWrite();
  const appDirectory = await getAppDirectory();
  const safeName = sanitizeFileName(noteTitle);
  const folderPath = path.join(filePaths[0], safeName);
  await ensureDir(folderPath);
  await writeFile(path.join(folderPath, `${safeName}.md`), markdown);
  const assetsSource = path.join(appDirectory, 'assets', noteId);
  const assetsDest = path.join(folderPath, 'assets');
  await ensureDir(assetsDest);
  try {
    await copyPath(assetsSource, assetsDest);
  } catch (error) {
    // The markdown still exports; the images just won't be embedded.
    console.warn('[md export] failed to copy assets for', noteId, error);
  }
}
