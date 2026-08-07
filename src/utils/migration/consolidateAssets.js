/**
 * One-time migration: merge `notes-assets/` and `file-assets/` into a single
 * `assets/` directory. Handles both top-level legacy dirs and nested copies
 * that the Rust bootstrap migration may have created inside `assets/`.
 */

import { backend, path } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';

const LEGACY_DIR_NAMES = ['notes-assets', 'file-assets'];
const ASSETS_DIR = 'assets';
const LEGACY_URL_RE = /file-assets:\/\//g;
const REPLACEMENT_URL = 'assets://';

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function readDirSafe(dirPath) {
  try {
    const entries = await backend.invoke('fs:readDir', dirPath);
    return entries || [];
  } catch {
    return [];
  }
}

async function pathExists(p) {
  try {
    await backend.invoke('fs:stat', p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy all note-ID subdirectories from `srcDir` into `destDir`, merging.
 * Files that already exist at the destination are skipped.
 */
async function mergeDirInto(srcDir, destDir) {
  const noteIds = await readDirSafe(srcDir);
  if (noteIds.length === 0) return 0;

  let count = 0;
  for (const entry of noteIds) {
    const srcEntry = path.join(srcDir, entry);
    const destEntry = path.join(destDir, entry);

    // If it's a file (not a noteId dir), just copy it
    try {
      const stat = await backend.invoke('fs:stat', srcEntry);
      if (!stat?.isDirectory) {
        if (!(await pathExists(destEntry))) {
          const base64 = await backend.invoke('fs:readData', srcEntry);
          await backend.invoke('fs:writeFile', {
            data: base64ToUint8Array(base64),
            path: destEntry,
          });
          count++;
        }
        continue;
      }
    } catch {
      continue;
    }

    // It's a directory — merge its files into destEntry
    await backend.invoke('fs:ensureDir', destEntry);
    const files = await readDirSafe(srcEntry);
    for (const fileName of files) {
      const src = path.join(srcEntry, fileName);
      const dest = path.join(destEntry, fileName);
      if (await pathExists(dest)) continue;
      try {
        const base64 = await backend.invoke('fs:readData', src);
        await backend.invoke('fs:writeFile', {
          data: base64ToUint8Array(base64),
          path: dest,
        });
        count++;
      } catch (e) {
        console.warn(`[consolidate-assets] Failed to copy ${src}:`, e?.message);
      }
    }
  }
  return count;
}

async function removeDirSafe(dirPath) {
  try {
    await backend.invoke('fs:removePath', dirPath);
  } catch {
    // best-effort
  }
}

/**
 * Rewrite `file-assets://` URLs to `assets://` in Yjs note content.
 */
async function rewriteAssetUrls() {
  const { getUpdates, compactUpdates } = await import('@/lib/native/yjs.js');
  const { useStorage } = await import('@/composable/storage');
  const storage = useStorage();

  const notes = await storage.get('notes', {});
  const noteIds = Object.keys(notes);
  if (noteIds.length === 0) return 0;

  const Y = await import('yjs');
  let rewritten = 0;

  for (const noteId of noteIds) {
    try {
      const updates = await getUpdates(noteId);
      if (!updates || updates.byteLength === 0) continue;

      const doc = new Y.Doc();
      Y.applyUpdate(doc, updates);

      let changed = false;
      const visit = (item) => {
        if (!item) return;
        if (item.content) {
          for (const content of item.content.getContent()) {
            if (typeof content === 'string' && content.includes('file-assets://')) {
              const replaced = content.replace(LEGACY_URL_RE, REPLACEMENT_URL);
              if (replaced !== content) changed = true;
            }
            if (content && typeof content === 'object') visitObject(content);
          }
        }
        if (item.left) visit(item.left);
        if (item.right) visit(item.right);
      };

      const visitObject = (obj) => {
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value === 'string' && value.includes('file-assets://')) {
            obj[key] = value.replace(LEGACY_URL_RE, REPLACEMENT_URL);
            changed = true;
          }
          if (Array.isArray(value)) {
            for (const item of value) {
              if (item && typeof item === 'object') visitObject(item);
            }
          }
        }
      };

      const fragment = doc.getXmlFragment('content');
      visit(fragment);

      if (changed) {
        const snapshot = Y.encodeStateAsUpdate(doc);
        await compactUpdates(noteId, snapshot);
        rewritten++;
      }

      doc.destroy();
    } catch (e) {
      console.warn(
        `[consolidate-assets] Failed to rewrite URLs for note ${noteId}:`,
        e?.message,
      );
    }
  }

  return rewritten;
}

/**
 * Collect every directory that looks like a legacy asset store:
 *  - Top-level:  <appDir>/notes-assets/  and  <appDir>/file-assets/
 *  - Nested:     <appDir>/assets/notes-assets/  and  <appDir>/assets/file-assets/
 *
 * Returns only dirs that actually exist and contain at least one entry.
 */
async function collectLegacySources(appDir) {
  const assetsDir = path.join(appDir, ASSETS_DIR);
  const sources = [];

  for (const name of LEGACY_DIR_NAMES) {
    const topLevel = path.join(appDir, name);
    if ((await readDirSafe(topLevel)).length > 0) sources.push(topLevel);

    const nested = path.join(assetsDir, name);
    if ((await readDirSafe(nested)).length > 0) sources.push(nested);
  }

  return sources;
}

/**
 * Main entry point. Finds all legacy asset dirs (top-level and nested) and
 * merges their contents into `assets/`, then rewrites Yjs URLs.
 */
export async function consolidateAssets() {
  const appDir = await getAppDirectory();
  if (!appDir) return;

  const assetsDir = path.join(appDir, ASSETS_DIR);
  await backend.invoke('fs:ensureDir', assetsDir);

  const sources = await collectLegacySources(appDir);
  if (sources.length === 0) return;

  console.warn(
    `[consolidate-assets] Found ${sources.length} legacy source(s), merging into assets/…`,
  );

  // Merge all sources into assets/
  for (const src of sources) {
    const name = path.basename(src);
    const count = await mergeDirInto(src, assetsDir);
    console.warn(`[consolidate-assets] ${name} → assets/: ${count} files copied`);
  }

  // Rewrite file-assets:// → assets:// in Yjs content
  const rewritten = await rewriteAssetUrls();
  console.warn(`[consolidate-assets] Rewrote URLs in ${rewritten} notes`);

  // Clean up all legacy source dirs
  for (const src of sources) {
    await removeDirSafe(src);
    console.warn(`[consolidate-assets] Removed ${src}`);
  }
}
