import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tauri-bridge', () => ({
  backend: { invoke: vi.fn() },
}));

vi.mock('@/lib/yjs/shared.js', () => ({
  applyRemote: vi.fn(),
}));

vi.mock('@/lib/yjs/meta-store.js', () => ({
  writeStoresFromWorkspace: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { backend } from '@/lib/tauri-bridge';
import { writeStoresFromWorkspace } from '@/lib/yjs/meta-store.js';
import { logger } from '@/utils/logger';
import { applySyncedNotes } from '../rust-shim.js';

describe('applySyncedNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backend.invoke.mockResolvedValue([]);
    writeStoresFromWorkspace.mockResolvedValue();
  });

  it('hydrates stores for the applied note ids without synthesizing placeholders', async () => {
    await applySyncedNotes(['a', 'b']);

    expect(writeStoresFromWorkspace).toHaveBeenCalledWith(new Set(['a', 'b']), {
      labels: false,
      labelColors: false,
      folders: false,
      deleted: false,
    });
  });

  it('rebuilds folders/labels when the batch includes the workspace meta doc', async () => {
    await applySyncedNotes(['meta', 'a']);

    expect(writeStoresFromWorkspace).toHaveBeenCalledWith(new Set(['meta', 'a']), {
      labels: true,
      labelColors: true,
      folders: true,
      deleted: false,
    });
  });

  it('logs store-refresh failures and never rejects the handler', async () => {
    writeStoresFromWorkspace.mockRejectedValueOnce(new Error('boom'));

    await expect(applySyncedNotes(['a'])).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      '[sync] store refresh after rust pull failed:',
      'boom',
    );
  });
});
