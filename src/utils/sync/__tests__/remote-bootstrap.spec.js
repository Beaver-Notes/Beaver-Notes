import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { CloudTransport } from '../transports/cloud.js';
import { SyncEngine } from '../engine.js';

const remoteParams = '{"version":3,"saltHex":"42424242424242424242424242424242"}';
const encryptedA = JSON.stringify({
  v: 5,
  meta: { device: 'remote-device', ts: 201, seq: 1, noteId: 'remote-note-a' },
  iv: '899d735435b9b78e4aa12b6099315c29ca21952d902fd126',
  enc: 'Iaw+Pnuujg3krTMSb13BRomkyA==',
});
const encryptedB = JSON.stringify({
  v: 5,
  meta: { device: 'remote-device', ts: 202, seq: 2, noteId: 'remote-note-b' },
  iv: '1d5acfefd2fd2894703a7205db4fb5f2d8796633d083e0b8',
  enc: 'ec6gIYHDL4cZKpotuYIYQoGV',
});
const encryptedA2 = JSON.stringify({
  v: 5,
  meta: { device: 'remote-device', ts: 203, seq: 2, noteId: 'remote-note-a' },
  iv: 'ab85367ec5b629e2b4e0f0503236357a673c0a67e6b905f5',
  enc: 'Lq1ScbYUisgRvn3N8uS2vhw=',
});
const decryptFailureFixture = JSON.stringify({
  v: 5,
  meta: { device: 'remote-device', ts: 201, seq: 1, noteId: 'remote-note-a' },
  iv: '899d735435b9b78e4aa12b6099315c29ca21952d902fd126',
  enc: 'Iaw+Pnuujg3krTMSb13BRomkzA==',
});

const nativeDecryptResponses = new Map([
  [encryptedA, { aad: 'remote-note-a-201', update: 'AQID' }],
  [encryptedB, { aad: 'remote-note-b-202', update: 'BAU=' }],
  [encryptedA2, { aad: 'remote-note-a-203', update: 'Bg==' }],
]);

const fakeServer = {
  state: {
    workspaceId: 'remote-workspace',
    status: 'initialized',
    generation: 4,
    documents: [
      { noteId: 'remote-note-a', snapshotGeneration: 4, snapshotKey: 'snapshot-a' },
      { noteId: 'remote-note-b', snapshotGeneration: 4, snapshotKey: 'snapshot-b' },
    ],
    vault: { id: 'vault-1', keyParamsBlob: btoa(remoteParams) },
  },
  pullResponses: {
    'remote-note-a:null': {
      updates: [{
        noteId: 'remote-note-a',
        key: 'remote-note-a~~remote-device~~201~~1.yjs.json',
        data: btoa(encryptedA),
      }],
      nextCheckpoint: { deviceId: 'remote-device', ts: 201, sequence: 1 },
      hasMore: true,
    },
    'remote-note-b:null': {
      updates: [{
        noteId: 'remote-note-b',
        key: 'remote-note-b~~remote-device~~202~~2.yjs.json',
        data: btoa(encryptedB),
      }],
      nextCheckpoint: { deviceId: 'remote-device', ts: 202, sequence: 2 },
      hasMore: false,
    },
    'remote-note-a:remote-device/201/1': { updates: [], hasMore: false },
    'remote-note-b:remote-device/202/2': { updates: [], hasMore: false },
    'local-note:fresh-device/301/2': { updates: [], hasMore: false },
  },
  calls: [],
  pushResults: [],
  acceptedIdentities: new Set(),
};

const api = {
  async get(url) {
    fakeServer.calls.push({ method: 'GET', url });
    if (url.startsWith('/sync/state')) return fakeServer.state;
    throw new Error(`Unexpected GET ${url}`);
  },
  async getVaultKeyParams(workspaceId) {
    fakeServer.calls.push({ method: 'GET_VAULT_PARAMS', workspaceId });
    return { keyParams: fakeServer.state.vault.keyParamsBlob };
  },
  async post(url, body) {
    fakeServer.calls.push({ method: 'POST', url, body });
    if (url === '/yjs/pull-batch') {
      const notes = {};
      for (const note of body.notes) {
        const checkpoint = note.checkpoint;
        const [deviceId, cursor] = Object.entries(checkpoint || {})[0] || [];
        const key = deviceId
          ? `${note.noteId}:${deviceId}/${cursor.ts}/${cursor.sequence}`
          : `${note.noteId}:null`;
        const response = fakeServer.pullResponses[key];
        if (!response) throw new Error(`Unexpected pull checkpoint ${key}`);
        notes[note.noteId] = response;
      }
      return { notes };
    }
    if (url === '/yjs/push-batch') {
      expect(body.workspaceId).toBe('remote-workspace');
      expect(body.notes).toHaveLength(1);
      expect(body.notes[0].noteId).toBe('local-note');
      const updates = body.notes[0].updates;
      expect(updates).toHaveLength(2);
      const accepted = updates.filter((update) => {
        if (fakeServer.acceptedIdentities.has(update.key)) return false;
        fakeServer.acceptedIdentities.add(update.key);
        return true;
      }).length;
      const result = {
        accepted,
        duplicate: updates.length - accepted,
        checkpoint: { deviceId: 'fresh-device', ts: 301, sequence: 2 },
      };
      fakeServer.pushResults.push(result);
      return result;
    }
    throw new Error(`Unexpected POST ${url}`);
  },
};

vi.mock('@/lib/api/client.js', () => ({ getApiClient: vi.fn(() => api) }));
vi.mock('@/composable/useAccountStorage', () => ({
  loadSessionToken: vi.fn(async () => 'test-token'),
}));
vi.mock('../sync-repository.js', () => ({
  getSyncDeviceId: vi.fn(() => 'fresh-device'),
  getCommitsDir: vi.fn(async () => '/commits'),
}));
vi.mock('@/composable/settings', () => ({ getSettingSync: vi.fn(() => 'remote') }));
vi.mock('@/store/account', () => ({ useAccountStore: vi.fn(() => ({ isAuthenticated: true, subscription: { plan: 'pro' }, serverUrl: 'https://sync.test' })) }));
vi.mock('@/lib/api/types', () => ({ SYNC_TRANSPORT: { REMOTE: 'remote', BOTH: 'both', FOLDER: 'folder' }, canUseCloudSync: vi.fn(() => true) }));
vi.mock('@/lib/native/fs', () => ({
  ensureDir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readData: vi.fn(async () => null),
  pathExists: vi.fn(async () => false),
  readDir: vi.fn(async () => ['local-note~~fresh-device~~301~~1.yjs.json', 'local-note~~fresh-device~~301~~2.yjs.json']),
  readFile: vi.fn(async () => 'local-encrypted-envelope'),
}));
vi.mock('../crypto.js', async () => {
  const actual = await vi.importActual('../crypto.js');
  return { ...actual };
});
vi.mock('@/lib/native/security.js', async () => {
  const actual = await vi.importActual('@/lib/native/security.js');
  return { ...actual, reconcileSyncKeyParams: vi.fn() };
});
vi.mock('../sync-yjs.js', async () => await vi.importActual('../sync-yjs.js'));
vi.mock('../path.js', () => ({ getSyncPath: vi.fn(async () => '/sync') }));
vi.mock('../sync-assets.js', () => ({ syncAssets: vi.fn(async () => {}) }));
vi.mock('@/composable/useNoteYjs.js', () => ({ applyRemote: vi.fn() }));
vi.mock('@/lib/native/yjs.js', () => ({ appendUpdate: vi.fn(async () => {}) }));
vi.mock('@/lib/native/app', () => ({ getAppDirectory: vi.fn(async () => '/app') }));
vi.mock('@/lib/tauri-bridge', () => ({
  backend: {
    invoke: vi.fn(async (channel, payload) => {
      if (channel === 'sync:decryptPayload') {
        const fixture = nativeDecryptResponses.get(payload.enc);
        if (!fixture || fixture.aad !== payload.aad) throw new Error('DECRYPT_FAILED');
        return { meta: JSON.parse(payload.enc).meta, update: fixture.update };
      }
      if (channel === 'encryption:reconcileKeyParams') {
        if (payload.passphrase === 'wrong-passphrase') throw new Error('DECRYPT_FAILED');
        return undefined;
      }
      if (channel === 'sync:keyReady') return true;
      throw new Error(`Unexpected backend command ${channel}`);
    }),
  },
  path: { join: (...parts) => parts.join('/') },
}));
vi.mock('@/composable/meta-yjs-doc.js', () => ({ getWorkspaceDoc: vi.fn(() => new Y.Doc()) }));
vi.mock('@/utils/yjs-helpers.js', () => ({ yMapToObj: vi.fn(() => ({})) }));
vi.mock('@/composable/useWorkspaceYjs', () => ({ syncDeletedAssets: vi.fn() }));
vi.mock('@/utils/crypto/safeStorageBlob.js', () => ({ loadSecureBlob: vi.fn(async () => 'correct-passphrase') }));
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }));
vi.mock('@/store/workspace.ts', () => ({ useWorkspaceStore: vi.fn(() => ({ activeId: 'remote-workspace' })) }));

describe('remote bootstrap integration contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeServer.calls = [];
    fakeServer.pushResults = [];
    fakeServer.acceptedIdentities.clear();
    fakeServer.pullResponses['remote-note-a:remote-device/201/1'] = {
      updates: [{
        noteId: 'remote-note-a',
        key: 'remote-note-a~~remote-device~~203~~2.yjs.json',
        data: btoa(encryptedA2),
      }],
      nextCheckpoint: { deviceId: 'remote-device', ts: 203, sequence: 2 },
      hasMore: false,
    };
    fakeServer.pullResponses['remote-note-a:remote-device/203/2'] = { updates: [], hasMore: false };
  });

  it('retrieves key params, pulls encrypted documents, pushes acknowledgements, and persists outcomes', async () => {
    const applied = [];
    const storage = {
      cursors: {},
      get: vi.fn(async () => storage.cursors),
      set: vi.fn(async (_key, value) => { storage.cursors = structuredClone(value); }),
    };
    const { applyRemote } = await import('@/composable/useNoteYjs.js');
    const { appendUpdate } = await import('@/lib/native/yjs.js');
    const { syncAssets } = await import('../sync-assets.js');
    const { writeFile } = await import('@/lib/native/fs');
    const { reconcileSyncKeyParams } = await import('@/lib/native/security.js');
    applyRemote.mockImplementation((noteId, update) => applied.push([noteId, Array.from(update)]));

    const cloud = new CloudTransport({
      passphraseProvider: () => 'correct-passphrase',
      getTransportSetting: () => 'remote',
      getAccountState: () => ({ isAuth: true, plan: 'pro' }),
    });
    cloud.syncAssets = vi.fn(async () => {});
    const engine = new SyncEngine({ transports: { cloud }, storage, getActiveTransports: () => ['cloud'] });

    await engine.enqueueSync(true);
    const replay = await cloud.push({}, { force: true });

    expect(writeFile).toHaveBeenCalledWith('/sync/BeaverNotesSync/keyParams.json', remoteParams);
    expect(reconcileSyncKeyParams).toHaveBeenCalledWith('correct-passphrase');
    expect(applied).toEqual([
      ['remote-note-a', [1, 2, 3]],
      ['remote-note-b', [4, 5]],
      ['remote-note-a', [6]],
    ]);
    expect(appendUpdate).toHaveBeenCalledTimes(3);
    expect(syncAssets).toHaveBeenCalled();
    expect(fakeServer.pushResults).toEqual([
      expect.objectContaining({ accepted: 2, duplicate: 0 }),
      expect.objectContaining({ accepted: 0, duplicate: 2 }),
    ]);
    expect(replay).toMatchObject({
      pushed: 2,
      cursorsDelta: {
        'remote-workspace': {
          'local-note': { 'fresh-device': { ts: 301, sequence: 2 } },
        },
      },
    });
    expect(storage.cursors).toEqual({
      'remote-workspace': {
        'remote-note-a': { 'remote-device': { ts: 203, sequence: 2 } },
        'remote-note-b': { 'remote-device': { ts: 202, sequence: 2 } },
        'local-note': { 'fresh-device': { ts: 301, sequence: 2 } },
      },
    });

    const pulls = fakeServer.calls.filter((call) => call.method === 'POST' && call.url === '/yjs/pull-batch');
    expect(pulls.map((call) => call.body.notes.map((note) => ({ noteId: note.noteId, checkpoint: note.checkpoint })))).toEqual([
      [
        { noteId: 'remote-note-a', checkpoint: {} },
        { noteId: 'remote-note-b', checkpoint: {} },
      ],
      [
        { noteId: 'remote-note-a', checkpoint: { 'remote-device': { ts: 203, sequence: 2 } } },
        { noteId: 'remote-note-b', checkpoint: { 'remote-device': { ts: 202, sequence: 2 } } },
      ],
    ]);
    const pushes = fakeServer.calls.filter((call) => call.method === 'POST' && call.url === '/yjs/push-batch');
    expect(pushes.length).toBeGreaterThanOrEqual(2);
    expect(pushes[0].body).toMatchObject({ workspaceId: 'remote-workspace', notes: [{ noteId: 'local-note' }] });
    expect(pushes[0].body.notes[0].updates).toHaveLength(2);
    expect(pushes[0].body.notes[0].updates[0]).toEqual(expect.objectContaining({
      key: 'local-note~~fresh-device~~301~~1.yjs.json',
      data: btoa('local-encrypted-envelope'),
    }));
    expect(pushes[1].body.notes[0].updates).toHaveLength(2);
  });

  it('blocks application and cursor advancement when decryption fails', async () => {
    const { applyRemote } = await import('@/composable/useNoteYjs.js');
    const { loadSecureBlob } = await import('@/utils/crypto/safeStorageBlob.js');
    const storage = { cursors: {}, get: vi.fn(async () => storage.cursors), set: vi.fn(async (_key, value) => { storage.cursors = value; }) };
    loadSecureBlob.mockResolvedValue('wrong-passphrase');
    fakeServer.pullResponses['remote-note-a:null'].updates[0].data = btoa(decryptFailureFixture);
    const cloud = new CloudTransport({ passphraseProvider: () => 'wrong-passphrase', getTransportSetting: () => 'remote', getAccountState: () => ({ isAuth: true, plan: 'pro' }) });
    const engine = new SyncEngine({ transports: { cloud }, storage, getActiveTransports: () => ['cloud'] });

    await engine.enqueueSync(true);
    expect(applyRemote).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
  });
});
