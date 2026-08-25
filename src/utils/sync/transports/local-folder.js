import { Transport } from './transport.js';
import { listRemoteYjsUpdates, compactWorkspaceYjs } from '../sync-yjs.js';
import { loadStateVector } from '../state-vector.js';
import { getSyncPath } from '../path.js';
import { ensureCommitsDir } from '../sync-repository.js';
import { YJS_UPDATE_EXT } from '../constants.js';
import { readDir } from '@/lib/native/fs';
import { seedOnce as seedOnceCommits } from '../shared.js';

/** Merge per-note state vectors into { device: maxClock } for pre-decrypt filtering. */
function mergeAllStateVectors(allStateVectors) {
  const merged = {};
  for (const sv of Object.values(allStateVectors)) {
    for (const [device, clock] of Object.entries(sv)) {
      if (clock > (merged[device] ?? 0)) {
        merged[device] = clock;
      }
    }
  }
  return merged;
}

export class LocalFolderTransport extends Transport {
  constructor() {
    super();
  }

  async pull() {
    const syncPath = await getSyncPath();
    if (!syncPath) return { updates: [] };

    const commitsDir = await ensureCommitsDir(syncPath);
    const { decryptJSON } = await import('../crypto.js');

    // Gather state vectors so listRemoteYjsUpdates can pre-decrypt-filter.
    const allStateVectors = {};
    try {
      const files = await readDir(commitsDir).catch(() => []);
      const noteIds = new Set();
      for (const file of files) {
        if (!file.endsWith(YJS_UPDATE_EXT)) continue;
        const match = file.match(/^(.+?)~~/);
        if (match) noteIds.add(match[1]);
      }
      for (const noteId of noteIds) {
        const sv = loadStateVector(noteId);
        if (sv) allStateVectors[noteId] = sv;
      }
    } catch {
      // non-critical — proceed without state vectors
    }

    const remoteYjsUpdates = await listRemoteYjsUpdates(
      commitsDir,
      {},
      decryptJSON,
      mergeAllStateVectors(allStateVectors)
    ).catch(() => []);

    const updates = remoteYjsUpdates.map((u) => ({
      noteId: u.noteId,
      update: u.update,
      device: u.device,
      ts: u.ts,
      sequence: u.sequence ?? 0,
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
    await seedOnceCommits(commitsDir);
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
