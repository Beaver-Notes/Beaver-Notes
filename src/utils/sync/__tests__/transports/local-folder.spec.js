import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LocalFolderTransport } from '../../transports/local-folder.js';

vi.mock('../../sync-yjs.js', () => ({
  listRemoteYjsUpdates: vi.fn(),
  compactWorkspaceYjs: vi.fn(),
}));

vi.mock('../../path.js', () => ({
  getSyncPath: vi.fn(),
}));

vi.mock('../../sync-repository.js', () => ({
  ensureCommitsDir: vi.fn(() => '/mock/commits'),
  getSyncDeviceId: vi.fn(() => 'mock-device'),
}));

vi.mock('@/lib/native/fs', () => ({
  readDir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  path: { join: (...args) => args.join('/') },
}));

vi.mock('../../transports/seed.js', () => ({
  writeInitialSnapshots: vi.fn(),
}));

vi.mock('../../constants.js', () => ({
  YJS_UPDATE_EXT: '.yjs.json',
  SYNC_ROOT_DIR: 'sync',
  STORAGE_KEY: { SYNC_CURSORS: 'syncCursors' },
}));

describe('LocalFolderTransport', () => {
  let transport;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new LocalFolderTransport({
      passphraseProvider: vi.fn(() => null),
    });
  });

  describe('pull', () => {
    it('returns empty results when no syncPath', async () => {
      const { getSyncPath } = await import('../../path.js');
      getSyncPath.mockResolvedValue(null);
      const result = await transport.pull({});
      expect(result).toEqual({ updates: [], cursorsDelta: {} });
    });

    it('returns updates from listRemoteYjsUpdates', async () => {
      const { getSyncPath } = await import('../../path.js');
      getSyncPath.mockResolvedValue('/mock/sync');
      const { listRemoteYjsUpdates } = await import('../../sync-yjs.js');
      listRemoteYjsUpdates.mockResolvedValue([
        { device: 'other-device', ts: 100, seq: 0, noteId: 'note-a', update: new Uint8Array([1, 2, 3]) },
      ]);

      const { ensureCommitsDir } = await import('../../sync-repository.js');
      ensureCommitsDir.mockResolvedValue('/mock/commits');

      const result = await transport.pull({});
      expect(result.updates).toHaveLength(1);
      expect(result.updates[0].noteId).toBe('note-a');
      expect(result.updates[0].device).toBe('other-device');
      expect(result.updates[0].update).toBeInstanceOf(Uint8Array);
    });

    it('returns empty on listRemoteYjsUpdates reject', async () => {
      const { getSyncPath } = await import('../../path.js');
      getSyncPath.mockResolvedValue('/mock/sync');
      const { listRemoteYjsUpdates } = await import('../../sync-yjs.js');
      listRemoteYjsUpdates.mockRejectedValue(new Error('fail'));

      const result = await transport.pull({});
      expect(result).toEqual({ updates: [], cursorsDelta: {} });
    });
  });

  describe('push', () => {
    it('returns no-op (folder writes happen outside engine cycle)', async () => {
      const result = await transport.push({});
      expect(result).toEqual({ updates: [], cursorsDelta: {}, pushed: 0 });
    });
  });

  describe('seedOnce', () => {
    it('calls writeInitialSnapshots when commits dir empty (no marker)', async () => {
      const { getSyncPath } = await import('../../path.js');
      getSyncPath.mockResolvedValue('/mock/sync');
      const { readDir, writeFile } = await import('@/lib/native/fs');
      readDir.mockResolvedValue([]);
      writeFile.mockResolvedValue(true);

      const { writeInitialSnapshots } = await import('../../transports/seed.js');

      await transport.seedOnce();

      expect(writeInitialSnapshots).toHaveBeenCalledWith('/mock/commits');
    });

    it('no-op when ._seeded marker exists', async () => {
      const { getSyncPath } = await import('../../path.js');
      getSyncPath.mockResolvedValue('/mock/sync');
      const { readDir } = await import('@/lib/native/fs');
      readDir.mockResolvedValue(['._seeded']);
      const { writeInitialSnapshots } = await import('../../transports/seed.js');

      await transport.seedOnce();

      expect(writeInitialSnapshots).not.toHaveBeenCalled();
    });

    it('swallows errors (best-effort)', async () => {
      const { getSyncPath } = await import('../../path.js');
      getSyncPath.mockResolvedValue('/mock/sync');
      const { readDir } = await import('@/lib/native/fs');
      readDir.mockRejectedValue(new Error('fs error'));

      await expect(transport.seedOnce()).resolves.not.toThrow();
    });
  });

  describe('compact', () => {
    it('calls compactWorkspaceYjs', async () => {
      const { getSyncPath } = await import('../../path.js');
      getSyncPath.mockResolvedValue('/mock/sync');
      const { compactWorkspaceYjs } = await import('../../sync-yjs.js');

      await transport.compact();

      expect(compactWorkspaceYjs).toHaveBeenCalled();
    });

    it('swallows errors (best-effort)', async () => {
      const { getSyncPath } = await import('../../path.js');
      getSyncPath.mockResolvedValue('/mock/sync');
      const { compactWorkspaceYjs } = await import('../../sync-yjs.js');
      compactWorkspaceYjs.mockRejectedValue(new Error('compact fail'));

      await expect(transport.compact()).resolves.not.toThrow();
    });
  });
});
