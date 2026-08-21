import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invokeCommand } from '../commands.ts';

describe('invokeCommand payload normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps fs:remove as { path } so fs_remove can deserialize it', async () => {
    await invokeCommand('fs:remove', '/tmp/commits/note.yjs.json');
    expect(invoke).toHaveBeenCalledWith(
      'fs_remove',
      expect.objectContaining({ path: '/tmp/commits/note.yjs.json' })
    );
  });

  it('maps vault-join commands to their snake_case Rust names', async () => {
    await invokeCommand('encryption:adoptKeyParams', { passphrase: 'pw' });
    expect(invoke).toHaveBeenCalledWith(
      'encryption_adopt_key_params',
      expect.objectContaining({ passphrase: 'pw' })
    );

    await invokeCommand('encryption:adoptKeyParams', {
      passphrase: 'pw',
      keyParams: '{"version":3}',
    });
    expect(invoke).toHaveBeenCalledWith(
      'encryption_adopt_key_params',
      expect.objectContaining({ passphrase: 'pw', keyParams: '{"version":3}' })
    );

    await invokeCommand('encryption:hasRemoteKeyParams');
    expect(invoke).toHaveBeenCalledWith('encryption_has_remote_key_params', {});
  });

  it('sends encryption:encryptNotePayload bytes as plain_bytes, not plain_json', async () => {
    const bytes = [104, 101, 108, 108, 111];
    await invokeCommand('encryption:encryptNotePayload', bytes);
    expect(invoke).toHaveBeenCalledWith(
      'encryption_encrypt_note_payload',
      expect.objectContaining({ plain_bytes: bytes })
    );
    const args = invoke.mock.calls.find(
      (call) => call[0] === 'encryption_encrypt_note_payload'
    )[1];
    expect(Array.isArray(args.plain_bytes)).toBe(true);
    expect(Object.keys(args)).not.toContain('plain_json');
  });

  it('forwards yjs:getStateVector to yjs_get_state_vector with the note id', async () => {
    await invokeCommand('yjs:getStateVector', { noteId: 'note-1' });
    expect(invoke).toHaveBeenCalledWith(
      'yjs_get_state_vector',
      expect.objectContaining({ noteId: 'note-1' })
    );
  });

  it('encodes yjs:append binary updates to base64 exactly once', async () => {
    const raw = new Uint8Array([1, 2, 3, 255]);
    await invokeCommand('yjs:append', {
      noteId: 'n1',
      update: raw,
      device: 'dev-1',
    });
    const args = invoke.mock.calls.find((c) => c[0] === 'yjs_append')[1];
    expect(args.update).toBe(btoa(String.fromCharCode(...raw)));
    expect(args.noteId).toBe('n1');
  });

  it('never double-encodes a base64 string passed to yjs:append', async () => {
    const b64 = btoa(String.fromCharCode(1, 2, 3, 255));
    await invokeCommand('yjs:append', { noteId: 'n1', update: b64 });
    const args = invoke.mock.calls.find((c) => c[0] === 'yjs_append')[1];
    expect(args.update).toBe(b64);
  });

  it('never double-encodes base64 strings in yjs:appendBatch updates', async () => {
    const b64a = btoa(String.fromCharCode(1));
    const b64b = btoa(String.fromCharCode(2, 3));
    await invokeCommand('yjs:appendBatch', {
      noteIds: ['n1', 'n2'],
      updates: [b64a, b64b],
      devices: ['d1', 'd2'],
    });
    const args = invoke.mock.calls.find((c) => c[0] === 'yjs_append_batch')[1];
    expect(args.updates).toEqual([b64a, b64b]);
    // A raw Uint8Array entry still gets encoded exactly once.
    const raw = new Uint8Array([9, 9]);
    await invokeCommand('yjs:appendBatch', {
      noteIds: ['n3'],
      updates: [raw],
      devices: ['d3'],
    });
    const argsRaw = invoke.mock.calls.find(
      (c) => c[0] === 'yjs_append_batch' && c[1].noteIds[0] === 'n3'
    )[1];
    expect(argsRaw.updates).toEqual([btoa(String.fromCharCode(...raw))]);
  });

  it('never double-encodes a base64 snapshot passed to yjs:compact', async () => {
    const b64 = btoa(String.fromCharCode(7, 8, 9));
    await invokeCommand('yjs:compact', { noteId: 'meta', snapshot: b64 });
    const args = invoke.mock.calls.find((c) => c[0] === 'yjs_compact')[1];
    expect(args.snapshot).toBe(b64);
  });

  it('normalizes workspace:registerCloud to snake_case Rust args', async () => {
    await invokeCommand('workspace:registerCloud', {
      id: 'w1',
      name: 'Design',
      orgId: 'org-1',
      ownerId: 'u1',
      workspaceType: 'shared',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(invoke).toHaveBeenCalledWith(
      'workspace_register_cloud',
      expect.objectContaining({
        id: 'w1',
        name: 'Design',
        org_id: 'org-1',
        owner_id: 'u1',
        workspace_type: 'shared',
        created_at: '2026-01-01T00:00:00Z',
      })
    );
  });
});
