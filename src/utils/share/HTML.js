import { useI18nStore } from '@/store/i18n';
import { buildWebExportDocument } from './export-html';
import { path } from '@/lib/tauri-bridge';
import { writeTextExportFile, chooseRootExportDir } from './export-staging';

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

  const rootDir = await chooseRootExportDir(
    share.selectExportFolderTitle || 'Select export folder'
  );
  if (!rootDir) return;

  const fileName = (noteTitle || 'ExportedNote').replace(/[/\\?%*:|"<>]/g, '-');
  const filePath = path.join(rootDir, `${fileName}.html`);

  await writeTextExportFile(filePath, html);
}
