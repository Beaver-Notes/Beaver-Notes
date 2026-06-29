import { useI18nStore } from '@/store/i18n';
import {
  buildWebExportDocument,
  sanitizeFileName,
  copyNoteAssetDirectories,
} from './exportBulk';
import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { chooseExportDirectory, writeExportFile } from '@/lib/native/exports';

function getShareTranslations() {
  try {
    return useI18nStore().messages?.share || {};
  } catch {
    return {};
  }
}

export async function exportHTML(noteId, noteTitle, editor) {
  const share = getShareTranslations();
  const { canceled, filePaths = [] } = await chooseExportDirectory(
    share.selectExportFolderTitle || 'Select export folder'
  );
  if (canceled || !filePaths.length) return;
  const html = await buildWebExportDocument(editor, {
    mode: 'folder',
    title: noteTitle,
    noteId,
  });
  const outputDir = filePaths[0];
  const fileName = sanitizeFileName(noteTitle);
  await writeExportFile(path.join(outputDir, `${fileName}.html`), html);
  await copyNoteAssetDirectories(await getAppDirectory(), noteId, outputDir);
}
