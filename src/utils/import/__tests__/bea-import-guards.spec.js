import { describe, expect, it, vi } from 'vitest';

// BEA.js pulls the app graph (stores, yjs meta store, native bridges); the
// guards under test are pure, so mock every heavy boundary.
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
// sanitizeFilename is exercised by its own module; here it just needs to be
// the real shape so the BEA key-sanitization behavior is realistic.
vi.mock('@/utils/import/helpers.js', () => ({
  sanitizeFilename: (name) =>
    String(name || '')
      .replace(/[/\\:*?"<>|]/g, '-')
      .trim() || 'Untitled',
}));

import {
  decodeImportedAsset,
  rewriteImportedAssetRefs,
  safeImportedNoteId,
} from '@/utils/share/BEA.js';

describe('safeImportedNoteId (SC-4-01)', () => {
  it.each([
    'abc123XYZ-_',
    'V1StGXR8_Z5jdHi6B-myT',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  ])('accepts nanoid-shaped id %s', (id) => {
    expect(safeImportedNoteId(id)).toBe(id);
  });

  it.each([
    '../../settings.json',
    '..\\windows',
    'a/b',
    'a\\b',
    'a b',
    '.',
    '..',
    'id%00',
    '__proto__',
    'constructor',
    'prototype',
    '',
    null,
    undefined,
  ])('rejects unsafe id %j', (id) => {
    expect(safeImportedNoteId(id)).toBe('');
  });

  it('rejects ids beyond 64 chars', () => {
    expect(safeImportedNoteId('a'.repeat(65))).toBe('');
  });
});

describe('decodeImportedAsset caps (SC-4-10)', () => {
  it('decodes bounded base64 payloads', () => {
    const data = decodeImportedAsset('AAAA');
    expect(data).toBeInstanceOf(Uint8Array);
    expect(Array.from(data)).toEqual([0, 0, 0]);
  });

  it.each(['', '   ', null, undefined, 42])(
    'rejects empty/invalid input %j',
    (input) => {
      expect(decodeImportedAsset(input)).toBeNull();
    }
  );

  it('rejects payloads above the base64 size cap instead of decoding', () => {
    const tooBig = 'A'.repeat(64 * 1024 * 1024 + 1);
    expect(decodeImportedAsset(tooBig)).toBeNull();
  });

  it('rejects malformed base64 without throwing', () => {
    expect(decodeImportedAsset('!!!!')).toBeNull();
  });
});

describe('rewriteImportedAssetRefs (SC-4-01)', () => {
  const doc = (src) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'x',
            marks: [{ type: 'image', attrs: { src } }],
          },
        ],
      },
    ],
  });

  it('re-points assets:// and file-assets:// refs at the real note id', () => {
    const content = doc('assets://old-id/pic.png');
    rewriteImportedAssetRefs(content, 'old-id', 'new-id');
    expect(content.content[0].content[0].marks[0].attrs.src).toBe(
      'assets://new-id/pic.png'
    );

    const content2 = doc('file-assets://old-id/file.pdf');
    rewriteImportedAssetRefs(content2, 'old-id', 'new-id');
    expect(content2.content[0].content[0].marks[0].attrs.src).toBe(
      'file-assets://new-id/file.pdf'
    );
  });

  it('leaves unrelated srcs untouched', () => {
    const content = doc('https://example.com/pic.png');
    rewriteImportedAssetRefs(content, 'old-id', 'new-id');
    expect(content.content[0].content[0].marks[0].attrs.src).toBe(
      'https://example.com/pic.png'
    );
  });

  it('is a no-op without a from id or when ids match', () => {
    const content = doc('assets://old-id/pic.png');
    expect(rewriteImportedAssetRefs(content, '', 'new-id')).toBe(content);
    expect(rewriteImportedAssetRefs(content, 'old-id', 'old-id')).toBe(content);
  });
});
