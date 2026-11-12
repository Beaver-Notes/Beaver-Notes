import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureNoteKeyMock = vi.hoisted(() => vi.fn(async () => 'ab'.repeat(32)));

vi.mock('@/composable/useNoteSharing', () => ({
  useNoteSharing: () => ({ ensureNoteKey: ensureNoteKeyMock }),
}));

vi.mock('@/lib/native/activity', () => ({
  appendActivity: vi.fn(async () => {}),
  listActivity: vi.fn(async () => []),
  clearActivity: vi.fn(async () => {}),
}));

vi.mock('@/lib/api/activity', () => ({
  listActivity: vi.fn(async () => []),
  createActivity: vi.fn(async () => ({ activity: {} })),
}));

vi.mock('@/lib/tiptap/exts/version-preview', () => ({
  revertReviewChange: vi.fn(() => true),
}));

import { createActivityLog } from '@/composable/useActivityLog';
import {
  listActivity as listShared,
  createActivity as createShared,
} from '@/lib/api/activity';
import { listActivity as listLocal } from '@/lib/native/activity';
import { useCollaboratorStore } from '@/store/collaborator';
import { encryptComment, decryptComment } from '@/utils/crypto/comment-crypto';
import { importCollabKey } from '@/utils/crypto/collab';

const KEY_HEX = 'ab'.repeat(32);
const NOTE = 'n1';

// A log with the network debounce collapsed so the test can await the upload
// without racing a wall clock.
function makeLog() {
  return createActivityLog({ uploadDebounceMs: 0, retryMs: 0 });
}

function entry(overrides = {}) {
  return {
    id: 'e1',
    noteId: NOTE,
    actorId: 'me',
    actorLabel: 'Me',
    kind: 'insert',
    summary: 'budget is 5k',
    at: 1000,
    anchorHint: 'budget is 5k',
    ...overrides,
  };
}

async function waitFor(assertion, timeout = 500) {
  const start = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (err) {
      if (Date.now() - start > timeout) throw err;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

async function encrypted(entryData) {
  const key = await importCollabKey(KEY_HEX);
  return encryptComment(key, JSON.stringify(entryData), NOTE);
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  ensureNoteKeyMock.mockResolvedValue(KEY_HEX);
});

describe('shared activity sync', () => {
  it('encrypts a shared note entry before upload (no plaintext in the request)', async () => {
    const log = makeLog();
    log.noteId.value = NOTE;

    log.record({ entry: entry() });
    await waitFor(() => expect(createShared).toHaveBeenCalledTimes(1));

    const [noteId, body] = createShared.mock.calls[0];
    expect(noteId).toBe(NOTE);
    expect(body.id).toBe('e1');
    expect(body.kind).toBeUndefined();
    expect(body.contentEncrypted).toBeTruthy();
    expect(body.contentIv).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain('budget is 5k');

    const key = await importCollabKey(KEY_HEX);
    const payload = JSON.parse(await decryptComment(key, body, NOTE));
    expect(payload.kind).toBe('insert');
    expect(payload.summary).toBe('budget is 5k');
    expect(payload.actorId).toBe('me');
  });

  it('falls back to the server kind column for a legacy entry with no payload kind', async () => {
    const peer = await encrypted({
      actorId: 'peer-1',
      actorLabel: 'Alice',
      summary: 'old edit',
      at: 1500,
      anchorHint: 'old edit',
    });
    listShared.mockResolvedValueOnce([
      {
        id: 'legacy-entry',
        noteId: NOTE,
        authorId: 'peer-1',
        kind: 'delete',
        contentEncrypted: peer.contentEncrypted,
        contentIv: peer.contentIv,
        createdAt: new Date(1500).toISOString(),
      },
    ]);

    const log = makeLog();
    await log.load(NOTE);

    expect(log.entries.value.find((e) => e.id === 'legacy-entry').kind).toBe('delete');
  });

  it('uploads a typing burst as a single batch', async () => {
    const log = makeLog();
    log.noteId.value = NOTE;

    log.record({ entry: entry({ id: 'e1' }) });
    log.record({ entry: entry({ id: 'e2' }) });
    await waitFor(() => expect(createShared).toHaveBeenCalledTimes(2));

    const ids = createShared.mock.calls.map(([, body]) => body.id).sort();
    expect(ids).toEqual(['e1', 'e2']);
  });

  it('a second member decrypts shared entries and sees the merged timeline with a display name', async () => {
    const peer = await encrypted({
      actorId: 'peer-1',
      actorLabel: 'peer-1',
      kind: 'insert',
      summary: 'remote edit',
      at: 2000,
      anchorHint: 'remote edit',
    });
    listShared.mockResolvedValueOnce([
      {
        id: 'peer-entry',
        noteId: NOTE,
        authorId: 'peer-1',
        kind: 'insert',
        contentEncrypted: peer.contentEncrypted,
        contentIv: peer.contentIv,
        createdAt: new Date(2000).toISOString(),
      },
    ]);
    useCollaboratorStore().setCollaborators(NOTE, [
      { userId: 'peer-1', username: 'Alice', email: 'alice@example.com' },
    ]);

    const log = makeLog();
    await log.load(NOTE);

    const merged = log.entries.value.find((e) => e.id === 'peer-entry');
    expect(merged).toBeTruthy();
    expect(merged.summary).toBe('remote edit');
    expect(merged.actorLabel).toBe('Alice');
    expect(merged.actorLabel).not.toBe('peer-1');
  });

  it('dedupes by entry id and keeps newest first, preserving the local copy', async () => {
    listLocal.mockResolvedValueOnce([entry({ id: 'e1', at: 1000, summary: 'local copy' })]);
    const peerE1 = await encrypted({
      actorId: 'peer-1',
      actorLabel: 'Alice',
      kind: 'insert',
      summary: 'server copy',
      at: 1000,
      anchorHint: 'server copy',
    });
    const peerE2 = await encrypted({
      actorId: 'peer-1',
      actorLabel: 'Alice',
      kind: 'insert',
      summary: 'second',
      at: 2000,
      anchorHint: 'second',
    });
    listShared.mockResolvedValueOnce([
      { id: 'e1', noteId: NOTE, authorId: 'peer-1', kind: 'insert', contentEncrypted: peerE1.contentEncrypted, contentIv: peerE1.contentIv, createdAt: new Date(1000).toISOString() },
      { id: 'e2', noteId: NOTE, authorId: 'peer-1', kind: 'insert', contentEncrypted: peerE2.contentEncrypted, contentIv: peerE2.contentIv, createdAt: new Date(2000).toISOString() },
    ]);

    const log = makeLog();
    await log.load(NOTE);

    expect(log.entries.value.filter((e) => e.id === 'e1')).toHaveLength(1);
    expect(log.entries.value.map((e) => e.id)).toEqual(['e2', 'e1']);
    expect(log.entries.value.find((e) => e.id === 'e1').summary).toBe('local copy');
  });

  it('a local-only note never calls the shared activity API', async () => {
    ensureNoteKeyMock.mockResolvedValue(null);
    listLocal.mockResolvedValueOnce([entry({ id: 'local-1' })]);

    const log = makeLog();
    log.noteId.value = 'personal';
    log.record({ entry: entry({ id: 'local-2', noteId: 'personal' }) });
    await waitFor(() => expect(ensureNoteKeyMock).toHaveBeenCalled());

    await log.load('personal');

    expect(createShared).not.toHaveBeenCalled();
    expect(listShared).not.toHaveBeenCalled();
    expect(listLocal).toHaveBeenCalled();
  });

  it('keeps the local entry and retries when a shared upload fails', async () => {
    createShared
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ activity: {} });
    const log = makeLog();
    log.noteId.value = NOTE;

    expect(() => log.record({ entry: entry() })).not.toThrow();
    await waitFor(() => expect(createShared).toHaveBeenCalledTimes(2));
    expect(log.entries.value.map((e) => e.id)).toContain('e1');
  });
});
