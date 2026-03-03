import { useStorage } from '@/composable/storage';
import { useDialog } from '@/composable/dialog';
import { useI18nStore } from '@/store/i18n';
import { getProcessedHTML } from './html-helper';
const { ipcRenderer, path } = window.electron;

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

  const { canceled, filePaths } = await ipcRenderer.callMain('dialog:open', {
    title: share.selectExportFolderTitle || 'Select export folder',
    properties: ['openDirectory'],
  });

  if (canceled || !filePaths.length) return;

  const folderName = noteTitle.replace(/[/\\?%*:|"<>]/g, '-') || 'ExportedNote';
  const folderPath = path.join(filePaths[0], folderName);

  await ipcRenderer.callMain('fs:ensureDir', folderPath);

  await ipcRenderer.callMain('fs:writeFile', {
    path: path.join(folderPath, `${noteTitle}.html`),
    data: finalHtml,
  });

  const storage = useStorage();
  const dataDir = await storage.get('dataDir', '', 'settings');

  const noteAssetsSource = path.join(dataDir, 'notes-assets', noteId);
  const fileAssetsSource = path.join(dataDir, 'file-assets', noteId);

  const notesAssetsDest = path.join(folderPath, 'assets');
  const fileAssetsDest = path.join(folderPath, 'file-assets');

  await ipcRenderer.callMain('fs:ensureDir', notesAssetsDest);
  await ipcRenderer.callMain('fs:ensureDir', fileAssetsDest);

  try {
    await ipcRenderer.callMain('fs:copy', {
      path: noteAssetsSource,
      dest: notesAssetsDest,
    });
  } catch (err) {
    console.warn('Note assets copy failed:', err.message);
  }

  try {
    await ipcRenderer.callMain('fs:copy', {
      path: fileAssetsSource,
      dest: fileAssetsDest,
    });
  } catch (err) {
    console.warn('File assets copy failed:', err.message);
  }

  showDialogAlert(
    interpolate(
      share.exportedHtmlToFolder || 'Exported HTML to folder: {path}',
      {
        path: folderPath,
      }
    )
  );
}
