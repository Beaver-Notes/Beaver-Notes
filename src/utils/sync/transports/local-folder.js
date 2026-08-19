import { Transport } from './transport.js';
import { listRemoteYjsUpdates, compactWorkspaceYjs } from '../sync-yjs.js';
import { writeInitialSnapshots } from './seed.js';
import { loadStateVector } from '../state-vector.js';
import { getSyncPath } from '../path.js';
import { ensureCommitsDir } from '../sync-repository.js';
import { YJS_UPDATE_EXT } from '../constants.js';
import { readDir, writeFile } from '@/lib/native/fs';
import { path } from '@/lib/tauri-bridge';

function isUpdateKnown(noteId, device, seq) {
  const sv = loadStateVector(noteId);
  if (!sv) return false;
  const clientClock = sv[device];
  if (clientClock == null) return false;
  return (seq ?? 0) <= clientClock;
}

export class LocalFolderTransport extends Transport {
  constructor({ passphraseProvider }) {
    super();
    this.passphraseProvider = passphraseProvider;
  }

  async pull() {
    const syncPath = await getSyncPath();
    if (!syncPath) return { updates: [] };

    const commitsDir = await ensureCommitsDir(syncPath);
    const { decryptJSON } = await import('../crypto.js');

    const remoteYjsUpdates = await listRemoteYjsUpdates(
      commitsDir,
      {},
      decryptJSON
    ).catch(() => []);

    const filteredUpdates = [];
    for (const u of remoteYjsUpdates) {
      if (isUpdateKnown(u.noteId, u.device, u.seq)) continue;
      filteredUpdates.push(u);
    }

    const updates = filteredUpdates.map((u) => ({
      noteId: u.noteId,
      update: u.update,
      device: u.device,
      ts: u.ts,
      seq: u.seq ?? 0,
    }));

    return { updates };
  }

  async push() {
    return { updates: [], pushed: 0 };
  }

  async seedOnce() {
    const syncPath = await getSyncPath();
    if (!syncPath) return;
    const commitsDir = await ensureCommitsDir(syncPath);

    try {
      const files = await readDir(commitsDir).catch(() => []);
      if (files.some((f) => f === '._seeded')) return;

      const wroteMarker = await writeFile(
        path.join(commitsDir, '._seeded'),
        ''
      ).then(() => true, () => false);
      if (!wroteMarker) return;

      const hasYjsFiles = files.some((f) => f.endsWith(YJS_UPDATE_EXT));
      if (!hasYjsFiles) {
        await writeInitialSnapshots(commitsDir);
      }
    } catch {
      // best-effort
    }
  }

  async compact() {
    const syncPath = await getSyncPath();
    if (!syncPath) return;
    const commitsDir = await ensureCommitsDir(syncPath);
    const { decryptJSON, encryptJSON } = await import('../crypto.js');
    try {
      await compactWorkspaceYjs(commitsDir, decryptJSON, encryptJSON);
    } catch {
      // best-effort
    }
  }
}
