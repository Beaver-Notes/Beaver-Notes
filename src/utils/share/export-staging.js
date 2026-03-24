import dayjs from '@/lib/dayjs';
import { path } from '@/lib/tauri-bridge';
import {
  chooseExportDirectory,
  copyExportPath,
  ensureExportDir,
  writeExportFile,
} from '@/lib/native/exports';

export async function chooseRootExportDir(title) {
  const { canceled, filePaths = [] } = await chooseExportDirectory(title);
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
}

export async function createDatedExportRoot(rootDir, prefix) {
  const outputRoot = path.join(
    rootDir,
    `${prefix} ${dayjs().format('YYYY-MM-DD')}`
  );
  await ensureExportDir(outputRoot);
  return outputRoot;
}

export async function writeTextExportFile(filePath, data) {
  await writeExportFile(filePath, data);
}

export async function ensureExportFolder(targetPath) {
  await ensureExportDir(targetPath);
}

export async function copyExportAssetDir(sourcePath, destPath) {
  try {
    await ensureExportDir(destPath);
    await copyExportPath(sourcePath, destPath);
  } catch (error) {
    console.warn('Asset copy failed:', error);
  }
}

export async function copyNoteAssetDirectories(dataDir, noteId, outputDir) {
  if (!dataDir) return;

  await copyExportAssetDir(
    path.join(dataDir, 'notes-assets', noteId),
    path.join(outputDir, 'assets', noteId)
  );
  await copyExportAssetDir(
    path.join(dataDir, 'file-assets', noteId),
    path.join(outputDir, 'file-assets', noteId)
  );
}
