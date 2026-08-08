import { describe, expect, it, vi } from 'vitest';
import { queueSyncWrite, setSyncTrigger } from '../pending-writes.js';

describe('pending sync writes', () => {
  it('triggers a sync cycle when a write is queued', () => {
    const trigger = vi.fn();
    setSyncTrigger(trigger);

    queueSyncWrite('/sync/commits', 'note-1', new Uint8Array([1]));

    expect(trigger).toHaveBeenCalledTimes(1);
  });
});
