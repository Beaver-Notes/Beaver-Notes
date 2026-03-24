import { useStorage } from '@/composable/storage';
import { useDialog } from '@/composable/dialog';
import { useI18nStore } from '@/store/i18n';
import { useNoteStore } from '@/store/note';
import { path } from '@/lib/tauri-bridge';
import { openDialog } from '@/lib/native/dialog';
import { copyPath, ensureDir, writeFile } from '@/lib/native/fs';
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

  const { canceled, filePaths } = await openDialog({
    title: share.exportDataDialogTitle || 'Export note',
    properties: ['openDirectory'],
    useScopedStorage: true,
  });
  if (canceled) return;

  const storage = useStorage('settings');
  const dataDir = await storage.get('dataDir', '');

  const safeName = sanitize(noteTitle) || 'ExportedNote';
  const folderPath = path.join(filePaths[0], safeName);

  await ensureDir(folderPath);

  await writeFile(path.join(folderPath, `${safeName}.md`), markdown);

  const noteAssetsSource = path.join(dataDir, 'notes-assets', noteId);
  const fileAssetsSource = path.join(dataDir, 'file-assets', noteId);
  const notesAssetsDest = path.join(folderPath, 'assets');
  const fileAssetsDest = path.join(folderPath, 'file-assets');

  await ensureDir(notesAssetsDest);
  await ensureDir(fileAssetsDest);

  try {
    await copyPath(noteAssetsSource, notesAssetsDest);
  } catch {}

  try {
    await copyPath(fileAssetsSource, fileAssetsDest);
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
