import { useDialog } from '@/composable/dialog';
import { useI18nStore } from '@/store/i18n';
import { buildExportDocument } from './export-html';
import { path } from '@/lib/tauri-bridge';
import { writeTextExportFile, chooseRootExportDir } from './export-staging';

function getShareTranslations() {
  try {
    return useI18nStore().messages?.share || {};
  } catch {
    return {};
  }
}

function interpolate(template, params = {}) {
  let out = template;
  for (const [key, value] of Object.entries(params)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}

function showDialogAlert(body) {
  const i18n = useI18nStore();
  const dialog = useDialog();
  dialog.alert({
    title: i18n.messages?.settings?.alertTitle || 'Alert',
    body,
    okText: i18n.messages?.dialog?.close || 'Close',
  });
}

export async function exportHTML(noteId, noteTitle, editor) {
  const share = getShareTranslations();

  const html = await buildExportDocument(editor, {
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

  showDialogAlert(
    interpolate(share.exportedHtmlToFolder || 'Exported HTML to: {path}', {
      path: filePath,
    })
  );
}
