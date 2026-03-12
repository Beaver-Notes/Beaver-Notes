import { useStorage } from '@/composable/storage';
import { useDialog } from '@/composable/dialog';
import { useI18nStore } from '@/store/i18n';
import { useNoteStore } from '@/store/note';
import { ipcRenderer, path } from '@/lib/tauri-bridge';
import { tiptapToMarkdown, buildFrontmatter } from './ExportBulk';

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

  const { canceled, filePaths } = await ipcRenderer.callMain('dialog:open', {
    title: share.exportDataDialogTitle || 'Export note',
    properties: ['openDirectory'],
  });
  if (canceled) return;

  const storage = useStorage('settings');
  const dataDir = await storage.get('dataDir', '');

  const safeName = sanitize(noteTitle) || 'ExportedNote';
  const folderPath = path.join(filePaths[0], safeName);

  await ipcRenderer.callMain('fs:ensureDir', folderPath);

  await ipcRenderer.callMain('fs:writeFile', {
    path: path.join(folderPath, `${safeName}.md`),
    data: markdown,
  });

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
  } catch {}

  try {
    await ipcRenderer.callMain('fs:copy', {
      path: fileAssetsSource,
      dest: fileAssetsDest,
    });
  } catch {}

  showDialogAlert(
    interpolate(
      share.exportedNoteAndAssetsTo || 'Exported note and assets to "{path}"',
      { path: folderPath }
    )
  );
}

function sanitize(name) {
  return (name || '').replace(/[/\\?%*:|"<>]/g, '-').trim();
}
