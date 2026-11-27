// SC-1-04 / ISSUE-1: the note-key adoption gate against REAL crypto.
//
// The round-0 note-key.spec.js cases verify the reject path with mocked
// verifiers, which cannot catch the bug this round fixes (a GCM proof failure
// being swallowed as "nothing to verify against" -> adopt). Here the verifier
// is the real `verifyRecoveredNoteKey`, the envelope is a real ML-KEM wrap,
// and the durable row is a real AES-GCM v6 commit snapshot sealed with the
// TRUE note key (AAD = noteId) — exactly the production proof path.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createMlKem768 } from 'mlkem';

// Real crypto: collab (AES-GCM + AAD) and codec run for real; only the history
// transport is mocked, serving genuinely sealed rows.
const realRow = vi.hoisted(() => ({ value: null }));

vi.mock('@/lib/api/history', () => ({
  listCommits: vi.fn(async () => [{ hash: 'commit-1' }]),
  fetchCommitEnvelope: vi.fn(async () => realRow.value),
}));

// The module under test pulls in stores/API modules at import time; none of
// them may run for these pure-crypto paths. note-key.js and collab stay REAL.
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ profile: { id: 'user-1' }, serverUrl: 'https://api.test' }),
}));
vi.mock('@/store/collaborator', () => ({ useCollaboratorStore: () => ({}) }));
vi.mock('@/store/workspace', () => ({ useWorkspaceStore: () => ({ activeId: null }) }));
vi.mock('@/lib/api/collaboration', () => ({}));
vi.mock('@/lib/api/workspaces', () => ({}));
vi.mock('@/lib/settings', () => ({ getSettingSync: () => false }));
vi.mock('@/utils/crypto/identity', () => ({
  loadOrCreateIdentity: async () => ({ privateKeyHex: 'sk', publicKeyHex: 'pk' }),
}));
vi.mock('@/lib/storage', () => ({ useStorage: () => ({ get: async () => false }) }));
vi.mock('@/utils/sync/shared-keys', () => ({
  registerSharedSyncKey: vi.fn(),
  expectSharedSyncNote: vi.fn(),
  getActiveWsKey: () => null,
}));
vi.mock('@/utils/sync/shared-notes', () => ({
  resolveNoteWorkspaceId: () => null,
  isSharedNote: () => false,
}));
vi.mock('@/lib/yjs/meta-doc', () => ({ getWorkspaceDoc: () => null }));

const NOTE_ID = 'note-verify';
const TRUE_KEY = 'ab'.repeat(32);
const WRONG_KEY = 'cd'.repeat(32);

const { verifyRecoveredNoteKey } = await import('@/composable/useNoteSharing');
const { recoverNoteKeyFromEnvelopes, getCachedNoteKey, clearUnwrappedKeyCache, wrapNoteKeyForRecipient } =
  await import('@/utils/crypto/note-key');
const { importCollabKey, encryptUpdate } = await import('@/utils/crypto/collab');
const { bufToBase64 } = await import('@/utils/crypto/codec');

async function hex(buf) {
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

// A real v6 commit snapshot sealed with the given note key, as createCommit
// produces it (AES-GCM, AAD = noteId, { v: 6, noteId, data: b64 }).
async function sealRealRow(keyHex) {
  const key = await importCollabKey(keyHex);
  const plaintext = new TextEncoder().encode(JSON.stringify({ title: 'durable row' }));
  const sealed = await encryptUpdate(key, plaintext, NOTE_ID);
  return { v: 6, k: 'note', noteId: NOTE_ID, data: bufToBase64(sealed) };
}

async function makeKeypair() {
  const k = await createMlKem768();
  const [pk, sk] = k.generateKeyPair();
  return { pkHex: await hex(pk), skHex: await hex(sk) };
}

beforeEach(async () => {
  vi.clearAllMocks();
  clearUnwrappedKeyCache(NOTE_ID);
  realRow.value = await sealRealRow(TRUE_KEY);
});

describe('verifyRecoveredNoteKey against a real v6 row', () => {
  test('the true key proves genuine; a wrong key is PROVEN WRONG (not null)', async () => {
    expect(await verifyRecoveredNoteKey(TRUE_KEY, NOTE_ID)).toBe(true);
    expect(await verifyRecoveredNoteKey(WRONG_KEY, NOTE_ID)).toBe(false);
  });

  test('a forged envelope (attacker-chosen key) is rejected end to end', async () => {
    const victim = await makeKeypair();
    const forged = await wrapNoteKeyForRecipient(victim.pkHex, WRONG_KEY);
    // Spy mirrors the production wiring (note-key calls verify(candidate, noteId)).
    const verify = vi.fn((cand, noteId) => verifyRecoveredNoteKey(cand, noteId));

    const recovered = await recoverNoteKeyFromEnvelopes(
      [{ deviceId: 'd1', wrappedKey: forged }],
      { privateKeyHex: victim.skHex },
      NOTE_ID,
      console,
      verify,
    );

    // The verifier must actually have run with the CANDIDATE key and returned
    // false — a null (or a swapped-arg call) would silently adopt.
    expect(verify.mock.calls[0]).toEqual([WRONG_KEY, NOTE_ID]);
    expect(verify.mock.results[0].type).toBe('return');
    expect(await verify.mock.results[0].value).toBe(false);
    expect(recovered).toBeNull();
    expect(getCachedNoteKey(NOTE_ID)).toBeNull();
  });

  test('a forged envelope is skipped and a genuine one is adopted', async () => {
    const victim = await makeKeypair();
    const envelopes = [
      { deviceId: 'd1', wrappedKey: await wrapNoteKeyForRecipient(victim.pkHex, WRONG_KEY) },
      { deviceId: 'd1', wrappedKey: await wrapNoteKeyForRecipient(victim.pkHex, TRUE_KEY) },
    ];
    const verify = vi.fn((cand, noteId) => verifyRecoveredNoteKey(cand, noteId));

    const recovered = await recoverNoteKeyFromEnvelopes(
      envelopes,
      { privateKeyHex: victim.skHex },
      NOTE_ID,
      console,
      verify,
    );

    expect(recovered).toBe(TRUE_KEY);
    expect(getCachedNoteKey(NOTE_ID)).toBe(TRUE_KEY);
    expect(await verify.mock.results[0].value).toBe(false);
    expect(await verify.mock.results[1].value).toBe(true);
  });

  test('a row sealed under a previous generation does not falsely pass a wrong key', async () => {
    // Both probative rows sealed under OTHER keys: no row proves WRONG_KEY.
    realRow.value = await sealRealRow('ef'.repeat(32));
    expect(await verifyRecoveredNoteKey(WRONG_KEY, NOTE_ID)).toBe(false);
  });

  test('history without v6 rows stays non-probative (null, adoption unchanged)', async () => {
    realRow.value = { v: 5, iv: 'x', enc: 'y' };
    expect(await verifyRecoveredNoteKey(WRONG_KEY, NOTE_ID)).toBeNull();
    expect(await verifyRecoveredNoteKey(TRUE_KEY, NOTE_ID)).toBeNull();
  });
});
