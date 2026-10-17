import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tauri-bridge', () => ({
  backend: { invoke: vi.fn(), listenPayload: vi.fn(() => Promise.resolve()) },
  path: { join: (...parts) => parts.join('/') },
}));

vi.mock('../path.js', () => ({ getSyncPath: vi.fn() }));

vi.mock('@/lib/settings', () => ({ getSettingSync: vi.fn(() => 'folder') }));

vi.mock('@/lib/native/fs', () => ({
  readJson: vi.fn(),
  writeJson: vi.fn(() => Promise.resolve()),
}));

const accountState = vi.hoisted(() => ({
  activeAccountId: 'acct-a',
  serverUrl: '',
  token: '',
  isPaidPlan: false,
}));

vi.mock('@/store/account', () => ({
  useAccountStore: vi.fn(() => accountState),
}));

vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: vi.fn(() => ({ activeId: 'ws-1' })),
}));

vi.mock('@/utils/device/device-model', () => ({
  getDeviceModel: vi.fn(() => 'Test Mac'),
}));

vi.mock('@/store/sync-progress', async () => {
  const actual = await vi.importActual('@/store/sync-progress');
  return {
    ...actual,
    useSyncProgressStore: vi.fn(() => ({ lastAction: null })),
  };
});

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
import { readJson, writeJson } from '@/lib/native/fs';
import { getSyncPath } from '../path.js';
import { applySyncedNotes, startRustSync } from '../rust-shim.js';

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

// The folder format carries no workspace identity, so a folder belongs to one
// account. Handing Rust another account's folder would ingest their notes.
describe('folder ownership', () => {
  const FOLDER = '/Volumes/Shared/Notes';
  const MARKER = `${FOLDER}/BeaverNotesSync/owner.json`;

  beforeEach(() => {
    vi.clearAllMocks();
    accountState.isPaidPlan = false;
    backend.invoke.mockResolvedValue(undefined);
    getSyncPath.mockResolvedValue(FOLDER);
    readJson.mockRejectedValue(new Error('missing'));
    writeJson.mockResolvedValue();
  });

  function startedFolderId() {
    return backend.invoke.mock.calls.find(([c]) => c === 'sync:start')?.[1]
      ?.folder_id;
  }

  it('claims a folder that has no owner marker', async () => {
    await startRustSync();

    expect(writeJson).toHaveBeenCalledWith(
      MARKER,
      expect.objectContaining({ accountId: 'acct-a' }),
    );
    expect(startedFolderId()).toBe(FOLDER);
  });

  it('keeps a folder already claimed by the active account', async () => {
    readJson.mockResolvedValue({ accountId: 'acct-a' });

    await startRustSync();

    expect(writeJson).not.toHaveBeenCalled();
    expect(startedFolderId()).toBe(FOLDER);
  });

  it('never hands Rust a folder claimed by another account', async () => {
    readJson.mockResolvedValue({ accountId: 'acct-b' });

    await startRustSync();

    expect(startedFolderId()).toBe('');
    expect(writeJson).not.toHaveBeenCalled();
  });

  it('takes over an anonymous folder when an account signs in', async () => {
    readJson.mockResolvedValue({ accountId: 'anonymous' });

    await startRustSync();

    expect(writeJson).toHaveBeenCalledWith(
      MARKER,
      expect.objectContaining({ accountId: 'acct-a' }),
    );
    expect(startedFolderId()).toBe(FOLDER);
  });

  it('ignores a folder on a paid account and syncs to the cloud', async () => {
    accountState.isPaidPlan = true;

    await startRustSync();

    const config = backend.invoke.mock.calls.find(
      ([c]) => c === 'sync:start',
    )?.[1];
    expect(config.folder_id).toBe('');
    expect(config.transport).toBe('remote');
  });
});
