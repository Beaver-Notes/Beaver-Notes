import { describe, expect, it, vi, beforeEach } from 'vitest';
import { kickSyncDir, resolveAssetPath } from '../scoped-storage.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('tauri-plugin-scoped-storage-api', () => ({
  exists: vi.fn(),
  getFolderInfo: vi.fn(),
  mkdir: vi.fn(),
  pickFolder: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  removeDir: vi.fn(),
  removeFile: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
}));

async function mockedInvoke() {
  return (await import('@tauri-apps/api/core')).invoke;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveAssetPath', () => {
  it('resolves assets:// and file-assets:// to an absolute path', async () => {
    (await mockedInvoke()).mockResolvedValue('/app/dir');
    expect(await resolveAssetPath('assets://note1/paper.pdf')).toBe(
      '/app/dir/assets/note1/paper.pdf',
    );
    expect(await resolveAssetPath('file-assets://note1/a%20b.pdf')).toBe(
      '/app/dir/assets/note1/a b.pdf',
    );
  });

  it('returns null for non-asset sources', async () => {
    expect(await resolveAssetPath('https://example.com/x.pdf')).toBeNull();
    expect(await resolveAssetPath('')).toBeNull();
    expect(await resolveAssetPath(null)).toBeNull();
  });
});

describe('kickSyncDir', () => {
  it('no-ops on plain paths without touching the bridge', async () => {
    const invoke = await mockedInvoke();
    kickSyncDir('/Users/me/sync');
    await flush();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('fires one warm_folder kick and never polls status', async () => {
    const invoke = await mockedInvoke();
    invoke.mockResolvedValue({ warmed: 2 });

    expect(kickSyncDir('scoped:folder1/commits')).toBeUndefined();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      'plugin:scoped-storage|warm_folder',
      { req: { folderId: 'folder1', path: 'commits' } }
    );
  });

  it('never throws when the bridge is missing (desktop, old plugin)', async () => {
    const invoke = await mockedInvoke();
    invoke.mockRejectedValue(new Error('no such command'));
    expect(() => kickSyncDir('scoped:folder1')).not.toThrow();
    await flush();
  });
});