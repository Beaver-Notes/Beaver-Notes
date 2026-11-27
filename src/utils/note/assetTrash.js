import { nanoid } from 'nanoid';
import { path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';
import { copyPath, ensureDir, pathExists, removePath } from '@/lib/native/fs';

const TRASH_DIR = '.undo-trash';

export async function stashNoteAssets(noteId) {
  if (!noteId) return null;
  try {
    const appDirectory = await getAppDirectory();
    if (!appDirectory) return null;
    const assetDir = path.join(appDirectory, 'assets', noteId);
    if (!(await pathExists(assetDir))) return null;
    const trashDir = path.join(
      appDirectory,
      'assets',
      TRASH_DIR,
      `${noteId}-${Date.now()}-${nanoid(6)}`
    );
    await ensureDir(path.join(appDirectory, 'assets', TRASH_DIR));
    await copyPath(assetDir, trashDir);
    await removePath(assetDir);
    return trashDir;
  } catch (error) {
    console.warn('[undo] failed to stash note assets:', noteId, error);
    return null;
  }
}

export async function restoreNoteAssets(noteId, trashDir) {
  if (!noteId || !trashDir) return false;
  try {
    if (!(await pathExists(trashDir))) return false;
    const appDirectory = await getAppDirectory();
    if (!appDirectory) return false;
    const assetDir = path.join(appDirectory, 'assets', noteId);
    await ensureDir(path.join(appDirectory, 'assets'));
    // If something already exists at destination, keep it; do not overwrite.
    if (await pathExists(assetDir)) {
      await removePath(trashDir);
      return false;
    }
    await copyPath(trashDir, assetDir);
    await removePath(trashDir);
    return true;
  } catch (error) {
    console.warn('[undo] failed to restore note assets:', noteId, error);
    return false;
  }
}

export async function discardStashedAssets(trashDir) {
  if (!trashDir) return;
  try {
    if (await pathExists(trashDir)) await removePath(trashDir);
  } catch (error) {
    console.warn('[undo] failed to discard stashed assets:', trashDir, error);
  }
}
