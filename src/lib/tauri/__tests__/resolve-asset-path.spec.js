import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveAssetPath } from '../scoped-storage.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

async function mockedInvoke() {
  return (await import('@tauri-apps/api/core')).invoke;
}

describe('resolveAssetPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
