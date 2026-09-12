import { Transport } from './transport.js';
import { listRemoteYjsUpdates, compactWorkspaceYjs, parseSyncFilename } from '../sync-yjs.js';
import { loadStateVector } from '../state-vector.js';
import { getSyncPath } from '../path.js';
import { ensureCommitsDir } from '../sync-repository.js';
import { YJS_UPDATE_EXT } from '../constants.js';
import { readDir } from '@/lib/native/fs';
import { seedOnce as seedOnceCommits } from '../shared.js';
import { kickSyncDir } from '@/lib/tauri/scoped-storage';

export class LocalFolderTransport extends Transport {
  constructor() {
    super();
  }

  async pull() {
    const syncPath = await getSyncPath();
    if (!syncPath) return { updates: [] };
    const commitsDir = await ensureCommitsDir(syncPath);
    kickSyncDir(commitsDir);
    const { decryptJSON } = await import('../crypto.js');
    const vectorsByNote = new Map();
    try {
      const files = await readDir(commitsDir).catch(() => []);
      const noteIds = new Set();
      for (const file of files) {
        if (!file.endsWith(YJS_UPDATE_EXT)) continue;
        const parsed = parseSyncFilename(file);
        if (parsed?.docId) noteIds.add(parsed.docId);
      }
      for (const noteId of noteIds) {
        const sv = loadStateVector(noteId);
        if (sv) vectorsByNote.set(noteId, sv);
      }
    } catch {}
    const remoteYjsUpdates = await listRemoteYjsUpdates(
      commitsDir,
      Object.fromEntries(vectorsByNote),
      decryptJSON,
      null
    ).catch((e) => {
      if (e?.code === 'DECRYPT_FAILED') throw e;
      return [];
    });
    const updates = [];
    for (const u of remoteYjsUpdates) {
      const sv = vectorsByNote.get(u.noteId);
      const maxClock = sv?.[u.device];
      if (maxClock != null && (u.sequence ?? 0) <= maxClock) continue;
      updates.push({
        noteId: u.noteId,
        update: u.update,
        device: u.device,
        ts: u.ts,
        sequence: u.sequence ?? 0,
      });
    }
    return { updates };
  }

  async push() {
    return { updates: [], pushed: 0 };
  }

  async seedOnce() {
    const syncPath = await getSyncPath();
    if (!syncPath) return;
    const commitsDir = await ensureCommitsDir(syncPath);
    await seedOnceCommits(commitsDir);
  }

  async compact() {
    const syncPath = await getSyncPath();
    if (!syncPath) return;
    const commitsDir = await ensureCommitsDir(syncPath);
    const { decryptJSON, encryptJSON } = await import('../crypto.js');
    try {
      await compactWorkspaceYjs(commitsDir, decryptJSON, encryptJSON);
    } catch {}
  }
}
