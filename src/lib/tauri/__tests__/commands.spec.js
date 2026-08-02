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

    await invokeCommand('encryption:hasRemoteKeyParams');
    expect(invoke).toHaveBeenCalledWith('encryption_has_remote_key_params', {});
  });
});
