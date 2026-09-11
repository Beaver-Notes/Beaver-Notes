import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

const ctx = vi.hoisted(() => ({
  deviceId: 'device-A',
  syncPath: '/shared-folder',
  files: new Map(),
  svByNote: {},
}));

vi.mock('@/lib/native/fs', () => {
  const base = (p) => String(p).split('/').pop();
  return {
    ensureDir: () => Promise.resolve(),
    writeFile: (p, data) => {
      ctx.files.set(String(p), data);
      return Promise.resolve();
    },
    readFile: (p) => {
      const v = ctx.files.get(String(p));
      if (v == null) throw new Error('not found: ' + p);
      return Promise.resolve(v);
    },
    readDir: (dir) => {
      const prefix = String(dir) + '/';
      const names = [];
      for (const k of ctx.files.keys()) {
        if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) {
          names.push(base(k));
        }
      }
      return Promise.resolve(names);
    },
    pathExists: (p) => Promise.resolve(ctx.files.has(String(p))),
    removePath: (p) => {
      ctx.files.delete(String(p));
      return Promise.resolve();
    },
  };
});

vi.mock('@/lib/tauri-bridge', () => ({
  path: { join: (...parts) => parts.join('/') },
}));

vi.mock('../../sync-repository.js', () => ({
  getSyncDeviceId: () => ctx.deviceId,
  ensureCommitsDir: async (syncPath) => `${syncPath}/BeaverNotesSync/commits`,
}));

vi.mock('../../path.js', () => ({
  getSyncPath: () => Promise.resolve(ctx.syncPath),
}));

vi.mock('../../crypto.js', () => ({
  encryptJSON: async (payload) =>
    JSON.stringify({ ...payload, update: Array.from(payload.update) }),
  decryptJSON: async (raw) => {
    const payload = JSON.parse(raw);
    return { ...payload, update: new Uint8Array(payload.update) };
  },
}));

vi.mock('../../state-vector.js', () => ({
  loadStateVector: (noteId) => ctx.svByNote[noteId] ?? null,
}));

vi.mock('@/lib/tauri/scoped-storage', () => ({
  kickSyncDir: () => {},
}));

vi.mock('../../transports/seed.js', () => ({
  writeInitialSnapshots: vi.fn(),
}));

describe('desktop-to-desktop folder sync round-trip', () => {
  beforeEach(() => {
    vi.resetModules();
    ctx.files.clear();
    ctx.svByNote = {};
  });

  async function asDevice(id, fn) {
    ctx.deviceId = id;
    vi.resetModules();
    return fn();
  }

  it("device B pulls device A's commit with intact bytes", async () => {
    const noteId = `note-${Date.now()}`;
    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'hello from device A');
    const originalBytes = Y.encodeStateAsUpdate(doc);
    doc.destroy();

    await asDevice('device-A', async () => {
      const { writeYjsUpdate } = await import('../../sync-yjs.js');
      const { encryptJSON } = await import('../../crypto.js');
      await writeYjsUpdate(
        '/shared-folder/BeaverNotesSync/commits',
        noteId,
        originalBytes,
        encryptJSON,
        null
      );
    });
    expect(ctx.files.size).toBe(1);

    const result = await asDevice('device-B', async () => {
      const { LocalFolderTransport } = await import(
        '../../transports/local-folder.js'
      );
      return new LocalFolderTransport().pull();
    });

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].noteId).toBe(noteId);
    expect(result.updates[0].device).toBe('device-A');
    expect(Array.from(result.updates[0].update)).toEqual(
      Array.from(originalBytes)
    );
    return result.updates[0];
  });

  it('device B skips its own files and already-seen sequences', async () => {
    const noteId = `note-${Date.now()}`;
    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'shared content');
    const bytes = Y.encodeStateAsUpdate(doc);
    doc.destroy();

    await asDevice('device-A', async () => {
      const { writeYjsUpdate } = await import('../../sync-yjs.js');
      const { encryptJSON } = await import('../../crypto.js');
      await writeYjsUpdate(
        '/shared-folder/BeaverNotesSync/commits',
        noteId,
        bytes,
        encryptJSON,
        null
      );
    });

    await asDevice('device-B', async () => {
      const { writeYjsUpdate } = await import('../../sync-yjs.js');
      const { encryptJSON } = await import('../../crypto.js');
      await writeYjsUpdate(
        '/shared-folder/BeaverNotesSync/commits',
        noteId,
        bytes,
        encryptJSON,
        null
      );
    });

    const pullAs = async () => {
      const { LocalFolderTransport } = await import(
        '../../transports/local-folder.js'
      );
      return new LocalFolderTransport().pull();
    };

    ctx.deviceId = 'device-B';
    vi.resetModules();
    let result = await pullAs();
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].device).toBe('device-A');

    ctx.svByNote[noteId] = { 'device-A': result.updates[0].sequence };
    vi.resetModules();
    result = await pullAs();
    expect(result.updates).toHaveLength(0);
  });

  it('withTimeout rejects a stalled read but passes a fast one through', async () => {
    const { withTimeout } = await import('../../sync-yjs.js');
    await expect(withTimeout(new Promise(() => {}), 20, 'stall')).rejects.toThrow(
      'timed out'
    );
    await expect(withTimeout(Promise.resolve('ok'), 20, 'fast')).resolves.toBe('ok');
  });
});
