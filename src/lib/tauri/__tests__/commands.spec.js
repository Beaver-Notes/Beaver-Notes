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
});
