import { useI18nStore } from '@/store/i18n';
import { buildWebExportDocument, sanitizeFileName } from './exportBulk';
import { path } from '@/lib/tauri-bridge';
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
  const html = await buildWebExportDocument(editor, {
    mode: 'self-contained',
    title: noteTitle,
    noteId,
  });
  const { canceled, filePaths = [] } = await chooseExportDirectory(
    share.selectExportFolderTitle || 'Select export folder'
  );
  if (canceled || !filePaths.length) return;
  const fileName = sanitizeFileName(noteTitle);
  await writeExportFile(path.join(filePaths[0], `${fileName}.html`), html);
}
