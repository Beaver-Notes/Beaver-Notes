import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import { openDialog } from '@/lib/native/dialog';
import { readFile, readDir, isFile } from '@/lib/native/fs';
import { parseNotionCsv } from '@/utils/import/notionCsv';
import { parseObsidianVault } from '@/utils/import/obsidianVault';
import {
  openRowDoc,
  persistRowDocSnapshot,
} from '@/composable/useDatabaseYjs.js';

export function buildImportPayload(source, title, parsed) {
  return {
    source,
    title: title || '',
    schema: parsed.schema,
    rows: parsed.rows,
    issues: parsed.issues || [],
  };
}

const basename = (p) => p.split(/[\\/]/).pop();

// ponytail: local .md walker (~15 lines); listFilesRecursive pulls the heavy
// markdown/tiptap import graph into onboarding for nothing.
async function readVaultFiles(rootPath) {
  const root = rootPath.replace(/[\\/]+$/, '');
  const files = [];
  async function walk(dir, prefix) {
    for (const entry of await readDir(dir)) {
      const full = `${dir}/${entry}`;
      if (await isFile(full)) {
        if (/\.md$/i.test(entry)) {
          files.push({
            name: prefix ? `${prefix}/${entry}` : entry,
            content: await readFile(full),
          });
        }
      } else {
        await walk(full, prefix ? `${prefix}/${entry}` : entry);
      }
    }
  }
  await walk(root, '');
  return files;
}

// Opens the native picker for the source, reads + parses the export.
// Returns a canonical payload, or null when the user cancels.
export async function pickDatabaseSource(source) {
  if (source === 'notion') {
    const { canceled, filePaths = [] } = await openDialog({
      title: 'Select Notion CSV export',
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      useScopedStorage: true,
    });
    if (canceled || !filePaths.length) return null;
    const filePath = filePaths[0];
    return buildImportPayload(
      'notion',
      basename(filePath).replace(/\.csv$/i, ''),
      parseNotionCsv(await readFile(filePath))
    );
  }
  if (source === 'obsidian') {
    const { canceled, filePaths = [] } = await openDialog({
      title: 'Select Obsidian vault',
      properties: ['openDirectory'],
      useScopedStorage: true,
    });
    if (canceled || !filePaths.length) return null;
    const dir = filePaths[0];
    return buildImportPayload(
      'obsidian',
      basename(dir),
      parseObsidianVault(await readVaultFiles(dir))
    );
  }
  throw new Error(`Unknown database import source: ${source}`);
}

// Persists a parsed payload: schema via the Pinia store, rows via a
// short-lived Y.Doc using the same exported helpers useDatabaseYjs relies on.
export async function persistDatabaseImport(payload, dbStore) {
  // Schema writes only flush to SQLite once the workspace doc has its update
  // handler attached; loadWorkspaceDoc is idempotent and cheap when loaded.
  const { loadWorkspaceDoc } = await import('@/lib/yjs/workspace-doc.js');
  await loadWorkspaceDoc();

  const dbId = dbStore.createDatabase({ title: payload.title || 'Imported database' });
  const columns = payload.schema?.columns ?? [];
  const views = payload.schema?.views ?? [];
  dbStore.updateSchema(dbId, {
    columns,
    ...(views.length ? { views } : {}),
  });

  if (!payload.rows?.length) return dbId;

  const { doc } = await openRowDoc(dbId);
  try {
    doc.transact(() => {
      const rowsArr = doc.getArray('rows');
      for (const r of payload.rows) {
        const row = new Y.Map();
        row.set('id', r.id || nanoid(10));
        row.set('createdAt', Date.now());
        row.set('updatedAt', Date.now());
        const cells = new Y.Map();
        for (const [k, v] of Object.entries(r.cells ?? {})) cells.set(k, v);
        row.set('cells', cells);
        rowsArr.push([row]);
      }
    });
    await persistRowDocSnapshot(dbId, doc);
  } finally {
    doc.destroy();
  }
  return dbId;
}
