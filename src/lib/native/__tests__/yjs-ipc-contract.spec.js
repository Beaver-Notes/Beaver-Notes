import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@/lib/tauri-bridge', () => ({
  backend: { invoke },
  path: { join: (...parts) => parts.join('/') },
}));

import {
  appendUpdate,
  appendBatch,
  compactUpdates,
  getUpdates,
} from '@/lib/native/yjs.js';

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));

// The Rust side of these commands declares `update`/`snapshot` as base64
// STRINGS (commit f97c8f63). Tauri serializes a nested Uint8Array as a JSON
// number array, which serde rejects — so raw bytes must never cross the
// boundary unconverted.
describe('native yjs IPC binary contract', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it('appendUpdate sends the update as a base64 string', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251]);
    await appendUpdate('note-1', bytes, 'dev-1');
    expect(invoke).toHaveBeenCalledWith('yjs:append', {
      noteId: 'note-1',
      update: toB64(bytes),
      device: 'dev-1',
    });
  });

  it('appendUpdate passes an already-base64 string through untouched', async () => {
    await appendUpdate('note-1', 'AQID', 'dev-1');
    expect(invoke).toHaveBeenCalledWith('yjs:append', {
      noteId: 'note-1',
      update: 'AQID',
      device: 'dev-1',
    });
  });

  it('appendBatch sends every update as a base64 string', async () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2, 3]);
    await appendBatch(['n1', 'n2'], [a, b], ['d1', 'd2']);
    expect(invoke).toHaveBeenCalledWith('yjs:appendBatch', {
      noteIds: ['n1', 'n2'],
      updates: [toB64(a), toB64(b)],
      devices: ['d1', 'd2'],
    });
  });

  it('appendBatch tolerates mixed string and byte-array inputs', async () => {
    const b = new Uint8Array([2, 3]);
    await appendBatch(['n1', 'n2'], ['AQI=', b], ['d1', 'd2']);
    expect(invoke).toHaveBeenCalledWith('yjs:appendBatch', {
      noteIds: ['n1', 'n2'],
      updates: ['AQI=', toB64(b)],
      devices: ['d1', 'd2'],
    });
  });

  it('compactUpdates sends the snapshot as a base64 string', async () => {
    const snap = new Uint8Array([9, 8, 7]);
    await compactUpdates('note-1', snap);
    expect(invoke).toHaveBeenCalledWith('yjs:compact', {
      noteId: 'note-1',
      snapshot: toB64(snap),
    });
  });

  it('read commands pass arguments through without conversion', async () => {
    invoke.mockResolvedValue([]);
    await getUpdates('note-1');
    expect(invoke).toHaveBeenCalledWith('yjs:getUpdates', 'note-1');
  });
});
