import { describe, it, expect, vi, beforeEach } from 'vitest';

// The sealing-key state machine (wsSealed / noteKeyLocked / takeover) is the
// single point where a mistake makes peers unable to decrypt (audit item 22).
// The REAL module runs here; only its edges are stubbed: the Tauri backend and
// shared-note detection.

const { invoke, isSharedNote } = vi.hoisted(() => ({
  // Default batch result: one `{ Ok: null }` per entry, matching the Rust
  // `Vec<Result<(), AppError>>` answer. Individual tests override this.
  invoke: vi.fn(async (channel, { entries } = {}) =>
    Array.isArray(entries) ? entries.map(() => ({ Ok: null })) : undefined,
  ),
  isSharedNote: vi.fn(() => false),
}));

vi.mock('@/lib/tauri-bridge', () => ({ backend: { invoke } }));
vi.mock('@/utils/sync/shared-notes.js', () => ({ isSharedNote }));

import {
  registerSharedSyncKey,
  registerWsKeyForNotes,
  setActiveWsKey,
  clearSharedSyncKeys,
} from '../shared-keys.js';

const WS_KEY = 'aa'.repeat(32);
const NOTE_KEY = 'bb'.repeat(32);

const registrations = () =>
  invoke.mock.calls.filter(([channel]) => channel === 'sync:registerSharedKey');

// The sweep's batched transport: one invoke, per-item Rust results shaped
// `{ Ok: null }` / `{ Err: { kind, message } }` like the real command answers.
const batchRegistrations = () =>
  invoke.mock.calls.filter(([channel]) => channel === 'sync:registerSharedKeys');

const batchIds = (call) => call[1].entries.map((entry) => entry.noteId);
const okItem = () => ({ Ok: null });
const errItem = (message) => ({ Err: { kind: 'Crypto', message } });

beforeEach(async () => {
  invoke.mockClear();
  isSharedNote.mockReset().mockReturnValue(false);
  // Clears the module-level registered/wsSealed/noteKeyLocked state.
  await clearSharedSyncKeys();
  setActiveWsKey(WS_KEY);
});

describe('shared-keys sealing state machine', () => {
  it('a non-takeover register on a wsSealed note is a no-op (audit c)', async () => {
    await registerSharedSyncKey('n1', WS_KEY);
    expect(registrations()).toHaveLength(1);

    // Any other key without takeover must not touch the sealed ring: peers
    // could no longer read the note's later updates.
    const ok = await registerSharedSyncKey('n1', NOTE_KEY);

    expect(ok).toBe(true);
    expect(registrations()).toHaveLength(1);
  });

  it('takeover moves a wsSealed note to noteKeyLocked and re-registers (audit b)', async () => {
    await registerSharedSyncKey('n1', WS_KEY);
    expect(registrations()).toHaveLength(1);
    invoke.mockClear();

    const ok = await registerSharedSyncKey('n1', NOTE_KEY, [], { takeover: true });

    expect(ok).toBe(true);
    expect(registrations()).toHaveLength(1);
    expect(registrations()[0][1]).toEqual({
      noteId: 'n1',
      keyHex: NOTE_KEY,
      previousKeys: [],
    });

    // The note now serves an external reader under its own key: the workspace
    // sweep must not put the workspace key back.
    invoke.mockClear();
    await registerWsKeyForNotes(['n1'], WS_KEY);
    expect(registrations()).toHaveLength(0);
    expect(batchRegistrations()).toHaveLength(0);
  });

  it('the workspace sweep skips a note-key-locked note (audit a)', async () => {
    await registerSharedSyncKey('n1', WS_KEY);
    await registerSharedSyncKey('n1', NOTE_KEY, [], { takeover: true });
    invoke.mockClear();

    await registerWsKeyForNotes(['n1', 'n2'], WS_KEY);

    expect(batchRegistrations()).toHaveLength(1);
    expect(batchRegistrations()[0][1]).toEqual({
      entries: [{ noteId: 'n2', keyHex: WS_KEY }],
    });
  });

  it('a shared note id in a meta sweep never gets the workspace key (audit d, finding 3)', async () => {
    isSharedNote.mockImplementation((id) => id === 'shared-1');

    await registerWsKeyForNotes(['shared-1', 'mine-1'], WS_KEY);

    expect(batchRegistrations()).toHaveLength(1);
    expect(batchRegistrations()[0][1]).toEqual({
      entries: [{ noteId: 'mine-1', keyHex: WS_KEY }],
    });
  });

  it('the sweep sends one batch invoke and a rejected entry does not block the rest', async () => {
    const ids = ['n1', 'n2', 'n3', 'n4', 'n5'];
    invoke.mockImplementation(async (channel, { entries }) =>
      entries.map((entry) =>
        entry.noteId === 'n3' ? errItem('transient invoke failure') : okItem(),
      ),
    );
    try {
      // n3 burns its 2 attempts (one 500 ms retry sleep between them) and
      // fails; the other four must still register, from the first batch.
      await registerWsKeyForNotes(ids, WS_KEY);
    } finally {
      invoke.mockImplementation(async () => {});
    }

    const batch = batchRegistrations();
    expect(batch).toHaveLength(2);
    expect(batchIds(batch[0])).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
    // Only the failed entry is retried, once: per-note error isolation and the
    // 2-attempt retry survived the transport change.
    expect(batchIds(batch[1])).toEqual(['n3']);
  });

  it('the batch invoke happens exactly once with the deduped id set', async () => {
    invoke.mockImplementation(async (channel, { entries }) =>
      entries.map(() => okItem()),
    );
    try {
      await registerWsKeyForNotes(['n1', 'n2', 'n1', 'n3', 'n2'], WS_KEY);
    } finally {
      invoke.mockImplementation(async () => {});
    }

    const batch = batchRegistrations();
    expect(batch).toHaveLength(1);
    expect(batchIds(batch[0])).toEqual(['n1', 'n2', 'n3']);
  });
});
