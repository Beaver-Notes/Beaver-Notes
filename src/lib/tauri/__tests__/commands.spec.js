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

  it('encodes yjs:append update as base64 instead of a number array', async () => {
    const update = new Uint8Array([1, 2, 3, 4, 5]);
    await invokeCommand('yjs:append', { noteId: 'n1', update, device: 'd1' });
    expect(invoke).toHaveBeenCalledWith('yjs_append', {
      note_id: 'n1',
      noteId: 'n1',
      update: btoa(String.fromCharCode(1, 2, 3, 4, 5)),
      device: 'd1',
    });
  });

  it('encodes fs:writeFile data as base64', async () => {
    const data = new Uint8Array([9, 8, 7]);
    await invokeCommand('fs:writeFile', { path: '/tmp/a.bin', data });
    expect(invoke).toHaveBeenCalledWith(
      'fs_write_file',
      expect.objectContaining({
        data: btoa(String.fromCharCode(9, 8, 7)),
      })
    );
  });
});
