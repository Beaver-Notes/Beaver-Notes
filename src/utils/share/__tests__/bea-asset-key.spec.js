import { describe, expect, it, vi } from 'vitest';

// Same heavy-boundary mocks as bea-import-guards.spec.js: the guards under
// test are pure.
vi.mock('@/store/note', () => ({ useNoteStore: () => ({ data: {} }) }));
vi.mock('@/store/label', () => ({ useLabelStore: () => ({ data: [] }) }));
vi.mock('@/store/i18n', () => ({ useI18nStore: () => ({ messages: {} }) }));
vi.mock('@/lib/yjs/meta-store.js', () => ({
  readNoteContents: vi.fn(async () => ({})),
}));
vi.mock('@/lib/tauri-bridge', () => ({
  path: { join: (...parts) => parts.join('/') },
  backend: { invoke: vi.fn() },
}));
vi.mock('@/lib/native/app', () => ({ getAppDirectory: vi.fn(async () => '/app') }));
vi.mock('@/lib/native/fs', () => ({
  readDir: vi.fn(async () => []),
  stat: vi.fn(),
}));
vi.mock('@/lib/native/exports', () => ({
  chooseExportDirectory: vi.fn(),
  ensureExportDir: vi.fn(),
  readExportData: vi.fn(),
  readImportJson: vi.fn(),
  writeExportJson: vi.fn(),
  writeExportFile: vi.fn(),
}));
vi.mock('@/lib/tauri/errors', () => ({ errorMessage: (e) => String(e) }));
vi.mock('@/utils/import/helpers.js', () => ({
  sanitizeFilename: (name) =>
    String(name || '')
      .replace(/[/\\:*?"<>|]/g, '-')
      .trim() || 'Untitled',
}));

import { isInsideDir, isSafeAssetKey } from '@/utils/share/BEA.js';

describe('isSafeAssetKey (SC-4-01)', () => {
  it.each([
    'pic.png',
    'Screenshot 2026-01-01.png',
    'scan (1).pdf',
    'a-b_c.d',
    '...dots...',
    'photo.HEIC',
  ])('accepts legit filename %j', (key) => {
    expect(isSafeAssetKey(key)).toBe(true);
  });

  it.each([
    '../../settings.json',
    '..\\..\\x.png',
    '..',
    '.',
    'a/../../b.png',
    'notes/../../other/x.png',
    '/abs/path.png',
    '\\abs\\x.png',
    'C:\\Windows\\x.png',
    'C:/x.png',
    '\\\\server\\share\\x.png',
    'a//b.png',
    'a/b/',
    '',
    '   ',
    null,
    undefined,
    42,
    `a/${'x'.repeat(300)}.png`,
    'nul\x00.png',
    'a\x7fb.png',
    'a\tb.png',
    'a\nb.png',
  ])('rejects hostile key %j', (key) => {
    expect(isSafeAssetKey(key)).toBe(false);
  });
});

describe('isInsideDir (SC-4-01 prefix enforcement)', () => {
  it('accepts targets inside the note asset dir', () => {
    expect(isInsideDir('/app/assets/n1/pic.png', '/app/assets/n1')).toBe(true);
    expect(isInsideDir('/app/assets/n1/pic.png', '/app/assets/n1/')).toBe(
      true
    );
  });

  // NOTE: '..' segments never reach this check — isSafeAssetKey rejects them
  // and path.join (buildPath) lexically resolves any remainder. This is a
  // string-prefix backstop on the already-joined target.
  it.each([
    '/app/assets/n1evil/x.png',
    '/app/assets/n1',
    '/etc/passwd',
  ])('rejects escape target %s', (target) => {
    expect(isInsideDir(target, '/app/assets/n1')).toBe(false);
  });
});
