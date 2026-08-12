import { backend, path } from '@/lib/tauri-bridge';
import { ensureDir, writeFile, removePath } from '@/lib/native/fs';
import { shareFileViaNative } from '@/lib/native/share';

/** Stage a file for native share in a stable temp dir. */
export async function getTempSharePath(fileName) {
  const tempDir = await backend.invoke('helper:get-path', 'temp');
  const shareDir = path.join(tempDir, 'beaver-notes-share');
  await ensureDir(shareDir);
  return path.join(shareDir, fileName);
}

/**
 * Share `content` with the OS share sheet (mobile) or the Web Share API
 * (desktop). Returns whether the share was offered; callers fall back to a
 * file export when it was not.
 */
export async function shareFile(fileName, content, mimeType) {
  if (backend.isMobileRuntime()) {
    const tempPath = await getTempSharePath(fileName);
    try {
      const data =
        typeof content === 'string'
          ? new TextEncoder().encode(content)
          : content;
      await writeFile(tempPath, Array.from(data));
      const shared = await shareFileViaNative(tempPath, mimeType);
      try {
        await removePath(tempPath);
      } catch {}
      return shared;
    } catch {
      try {
        await removePath(tempPath);
      } catch {}
      return false;
    }
  }

  const blob = new Blob([content], { type: mimeType });
  const file = new File([blob], fileName, { type: mimeType });
  if (
    typeof navigator !== 'undefined' &&
    navigator.share &&
    navigator.canShare?.({ files: [file] })
  ) {
    await navigator.share({ files: [file] });
    return true;
  }
  return false;
}

/** Try the share sheet first, and fall back to a file export when denied. */
export async function tryShareOrExport(shareFn, exportFn) {
  if (!(await shareFn())) {
    await exportFn();
  }
}
