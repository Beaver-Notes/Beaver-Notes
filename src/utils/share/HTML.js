import { useStorage } from '@/composable/storage';
import { useDialog } from '@/composable/dialog';
import { useI18nStore } from '@/store/i18n';
import { getProcessedHTML } from './html-helper';
import { path } from '@/lib/tauri-bridge';
import {
  writeTextExportFile,
  chooseRootExportDir,
  ensureExportFolder,
  copyNoteAssetDirectories,
} from './export-staging';

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
  const finalHtml = await getProcessedHTML(noteId, editor);

  const rootDir = await chooseRootExportDir(
    share.selectExportFolderTitle || 'Select export folder'
  );
  if (!rootDir) return;

  const folderName = noteTitle.replace(/[/\\?%*:|"<>]/g, '-') || 'ExportedNote';
  const folderPath = path.join(rootDir, folderName);

  await ensureExportFolder(folderPath);
  await writeTextExportFile(
    path.join(folderPath, `${noteTitle}.html`),
    finalHtml
  );

  const storage = useStorage();
  const dataDir = await storage.get('dataDir', '', 'settings');

  const noteAssetsSource = path.join(dataDir, 'notes-assets', noteId);
  const fileAssetsSource = path.join(dataDir, 'file-assets', noteId);

  await copyNoteAssetDirectories(dataDir, noteId, folderPath);

  showDialogAlert(
    interpolate(
      share.exportedHtmlToFolder || 'Exported HTML to folder: {path}',
      {
        path: folderPath,
      }
    )
  );
}
