import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { CloudTransport } from '@/utils/sync/transports/cloud.js';
import { SyncEngine } from '@/utils/sync/engine.js';
import { getWorkspaceDoc, destroyWorkspaceDoc, META_DOC_ID } from '@/lib/yjs/meta-doc';

const mockNoteStore = { data: {}, _rebuildIndex: vi.fn() };
const mockFolderStore = { data: {}, deletedIds: {}, _rebuildIndex: vi.fn() };
const mockLabelStore = { data: [], colors: {} };

vi.mock('@/store/note', () => ({ useNoteStore: () => mockNoteStore }));
vi.mock('@/store/folder', () => ({ useFolderStore: () => mockFolderStore }));
vi.mock('@/store/label', () => ({ useLabelStore: () => mockLabelStore }));

vi.mock('@/store/workspace.ts', () => ({
  useWorkspaceStore: vi.fn(() => ({ activeId: 'workspace-race', workspaces: [] })),
}));

vi.mock('@/utils/sync/remote-yjs.js', () => ({
  pushUpdates: vi.fn(() => ({ accepted: 0, duplicate: 0 })),
  pullUpdates: vi.fn(),
  getRemoteState: vi.fn(() => ({
    status: 'initialized',
    documents: [
      { noteId: META_DOC_ID, checkpointTs: 0, checkpointSequence: 0 },
      { noteId: 'note-race', checkpointTs: 0, checkpointSequence: 0 },
    ],
  })),
}));

// Identity stand-in for the sync-crypto envelope: cloud.js hands decrypt*
// already-atob'd plaintext JSON strings whose `update` is a plain byte array.
vi.mock('@/utils/sync/crypto.js', () => ({
  encryptJSON: vi.fn(),
  encryptBatch: vi.fn(),
  decryptJSON: vi.fn(async (raw) => JSON.parse(raw)),
  decryptBatch: vi.fn(async (raws) => raws.map((raw) => JSON.parse(raw))),
}));

function encodeEnvelope(payload) {
  return b64(new TextEncoder().encode(JSON.stringify(payload)));
}

vi.mock('@/utils/sync/sync-yjs.js', () => ({
  parseSyncFilename: vi.fn((key) => {
    if (!key.endsWith('.yjs.json')) return null;
    const [docId, device, ts, seq] = key.slice(0, -'.yjs.json'.length).split('~~');
    if (!docId || !device) return null;
    return { docId, isSnapshot: false, device, ts: Number(ts), sequence: Number(seq ?? 0) };
  }),
}));

vi.mock('@/utils/sync/state-vector.js', () => ({
  loadServerCheckpoint: vi.fn(() => null),
  saveServerCheckpoint: vi.fn(),
  getCurrentStateVector: vi.fn(async () => ({})),
  saveStateVector: vi.fn(),
}));

vi.mock('@/composable/useNoteYjs.js', () => ({
  applyRemote: vi.fn(),
}));

vi.mock('@/utils/sync/path.js', () => ({
  getSyncPath: vi.fn(async () => '/tmp/sync-race'),
}));

vi.mock('@/utils/sync/sync-assets.js', () => ({
  syncAssets: vi.fn(async () => {}),
}));

vi.mock('@/lib/native/yjs.js', () => ({
  appendUpdate: vi.fn(async () => {}),
  appendBatch: vi.fn(async () => {}),
  compactUpdates: vi.fn(async () => {}),
  getStateVector: vi.fn(async () => ({})),
  getSnapshot: vi.fn(async () => null),
  getUpdates: vi.fn(async () => []),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  backend: { isTouchRuntime: vi.fn(() => true) },
  path: { join: (...args) => args.join('/') },
  addCloseHandler: vi.fn(),
}));

vi.mock('@/lib/native/app', () => ({
  getAppDirectory: vi.fn(async () => '/tmp/app'),
  notify: vi.fn(async () => true),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(async () => {}),
}));

vi.mock('@/lib/settings', async (importOriginal) => ({
  ...(await importOriginal()),
  getSettingSync: vi.fn((key) =>
    key === 'onboardingCompleted' ? true : key === 'syncTransport' ? 'remote' : undefined
  ),
}));

vi.mock('@/utils/crypto/encryption.js', () => ({
  isEncryptionEnabled: vi.fn(() => false),
}));

vi.mock('@/lib/native/security.js', () => ({
  reconcileSyncKeyParams: vi.fn(async () => {}),
  syncKeyReady: vi.fn(async () => true),
}));

vi.mock('@/utils/sync/vault-key-params.js', () => ({
  fetchCloudKeyParams: vi.fn(async () => null),
}));

vi.mock('@/utils/crypto/safeStorageBlob.js', () => ({
  loadSecureBlob: vi.fn(async () => null),
}));

vi.mock('@/utils/sync/readiness.js', () => ({
  getSyncReadiness: vi.fn(async () => ({
    isAuth: true, plan: 'team', transport: 'remote', wantsCloud: true,
    syncAllowed: true, keyReady: true, workspaceId: 'workspace-race',
  })),
}));

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));

function buildTitledMetaUpdate(noteId, title) {
  // Lower clientID than the local workspace doc (pinned to 100 in beforeEach):
  // a concurrent local placeholder write therefore wins Y.Map last-writer-wins
  // ties deterministically, which is exactly the shadowing bug under test.
  const src = new Y.Doc();
  src.clientID = 50;
  src.transact(() => {
    const entry = new Y.Map();
    entry.set('id', noteId);
    entry.set('title', title);
    entry.set('folderId', '');
    entry.set('labels', []);
    src.getMap('notes').set(noteId, entry);
  });
  const bytes = Y.encodeStateAsUpdate(src);
  src.destroy();
  return bytes;
}

async function runEngineCycle({ envelopes }) {
  const { pullUpdates } = await import('@/utils/sync/remote-yjs.js');
  const { applyRemote } = await import('@/composable/useNoteYjs.js');

  // Route pulled meta-doc bytes into the REAL shared workspace doc, exactly
  // like production's applyRemote does for registered docs.
  applyRemote.mockImplementation((noteId, update) => {
    if (noteId === META_DOC_ID) {
      const doc = getWorkspaceDoc();
      doc.transact(() => Y.applyUpdate(doc, update), 'sync');
      return true;
    }
    return false;
  });

  pullUpdates.mockResolvedValue({
    notes: {
      [META_DOC_ID]: {
        updates: envelopes.filter((e) => e.key.startsWith(`${META_DOC_ID}~~`)),
        nextCheckpoint: { 'remote-device': { ts: 100, sequence: 1 } },
        hasMore: false,
      },
      'note-race': {
        updates: envelopes.filter((e) => e.key.startsWith('note-race~~')),
        nextCheckpoint: {},
        hasMore: false,
      },
    },
  });

  const cloud = new CloudTransport();
  cloud.setReadiness({ isAuth: true, plan: 'starter', syncAllowed: true });
  cloud.syncAssets = vi.fn(async () => {});
  cloud.seedOnce = vi.fn(async () => {});
  cloud.compact = vi.fn(async () => {});
  cloud.push = vi.fn(async () => ({ updates: [], pushed: 0 }));

  const engine = new SyncEngine({
    transports: { cloud },
    storage: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
    getActiveTransports: () => ['cloud'],
  });
  await engine.enqueueSync(true);
}

describe('pulled meta titles are not shadowed by placeholders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    destroyWorkspaceDoc();
    // Deterministic LWW tie-breaking for locally injected placeholders.
    getWorkspaceDoc().clientID = 100;
  });

  it('applies titled meta entries before reconciling unknown-note placeholders', async () => {
    const titled = buildTitledMetaUpdate('note-race', 'From A');
    const envelopes = [
      {
        key: `${META_DOC_ID}~~remote-device~~100~~1.yjs.json`,
        data: encodeEnvelope({
          device: 'remote-device',
          ts: 100,
          sequence: 1,
          noteId: META_DOC_ID,
          update: Array.from(titled),
        }),
      },
      {
        key: 'note-race~~remote-device~~101~~1.yjs.json',
        data: encodeEnvelope({
          device: 'remote-device',
          ts: 101,
          sequence: 1,
          noteId: 'note-race',
          update: [1, 2, 3],
        }),
      },
    ];

    await runEngineCycle({ envelopes });

    const yNotes = getWorkspaceDoc().getMap('notes');
    expect(yNotes.get('note-race')?.get('title')).toBe('From A');
    expect(yNotes.has(META_DOC_ID)).toBe(false);
  });
});

describe('remote meta updates refresh the note store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    destroyWorkspaceDoc();
    getWorkspaceDoc().clientID = 100;
    mockNoteStore.data = {};
  });

  it('writes titled entries to the Pinia note store after pulling meta', async () => {
    const titled = buildTitledMetaUpdate('note-store-test', 'Synced Title');
    const envelopes = [
      {
        key: `${META_DOC_ID}~~remote-device~~200~~1.yjs.json`,
        data: encodeEnvelope({
          device: 'remote-device',
          ts: 200,
          sequence: 1,
          noteId: META_DOC_ID,
          update: Array.from(titled),
        }),
      },
    ];

    await runEngineCycle({ envelopes });

    expect(mockNoteStore.data['note-store-test']).toBeDefined();
    expect(mockNoteStore.data['note-store-test'].title).toBe('Synced Title');
  });
});

describe('server checkpoint is not poisoned by an undecodable page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    destroyWorkspaceDoc();
  });

  it('does not save the nextCheckpoint when decryption of the page fails', async () => {
    const { pullUpdates } = await import('@/utils/sync/remote-yjs.js');
    const { decryptBatch, decryptJSON } = await import('@/utils/sync/crypto.js');
    const { saveServerCheckpoint } = await import('@/utils/sync/state-vector.js');

    pullUpdates.mockResolvedValue({
      notes: {
        [META_DOC_ID]: {
          updates: [
            {
              key: `${META_DOC_ID}~~remote-device~~100~~1.yjs.json`,
              data: encodeEnvelope({
                device: 'remote-device',
                ts: 100,
                sequence: 1,
                noteId: META_DOC_ID,
                update: [1, 2, 3],
              }),
            },
          ],
          nextCheckpoint: { 'remote-device': { ts: 100, sequence: 1 } },
          hasMore: false,
        },
      },
    });
    // Simulate a page that cannot be decoded at all (key locked / wrong key).
    decryptBatch.mockResolvedValueOnce([null]);
    decryptJSON.mockRejectedValueOnce(
      Object.assign(new Error('decrypt failed'), { code: 'DECRYPT_FAILED' })
    );

    const cloud = new CloudTransport();
    cloud.setReadiness({ isAuth: true, plan: 'starter', syncAllowed: true });
    cloud.syncAssets = vi.fn(async () => {});
    cloud.seedOnce = vi.fn(async () => {});
    cloud.compact = vi.fn(async () => {});
    cloud.push = vi.fn(async () => ({ updates: [], pushed: 0 }));

    const engine = new SyncEngine({
      transports: { cloud },
      storage: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      getActiveTransports: () => ['cloud'],
    });

    // All-null decrypt surfaces as 'unlock-required', which the engine defers
    // gracefully (cycle resolves); the page was never applied either way.
    await engine.enqueueSync(true);

    expect(saveServerCheckpoint).not.toHaveBeenCalled();
  });
});
