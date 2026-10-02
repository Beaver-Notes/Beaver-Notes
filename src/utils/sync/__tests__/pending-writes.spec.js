import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../rust-shim.js', () => ({
  isRustSyncActive: vi.fn(),
  kickRustDirty: vi.fn(),
  kickRustSync: vi.fn(),
}));

import { isRustSyncActive, kickRustDirty, kickRustSync } from '../rust-shim.js';

describe('queueSyncWrite dirty-kick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dirty-kicks rust when sync is active', async () => {
    const { queueSyncWrite } = await import('../pending-writes.js');
    isRustSyncActive.mockReturnValue(true);

    queueSyncWrite('note-1');

    expect(kickRustDirty).toHaveBeenCalledTimes(1);
    expect(kickRustSync).not.toHaveBeenCalled();
  });

  it('plain-kicks rust when sync is inactive', async () => {
    const { queueSyncWrite } = await import('../pending-writes.js');
    isRustSyncActive.mockReturnValue(false);

    queueSyncWrite('note-1');

    expect(kickRustSync).toHaveBeenCalledTimes(1);
    expect(kickRustDirty).not.toHaveBeenCalled();
  });
});
