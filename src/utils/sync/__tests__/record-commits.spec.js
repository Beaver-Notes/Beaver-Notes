import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../commit-snapshot.js', () => ({
  captureNoteSnapshot: vi.fn(),
}));

vi.mock('@/lib/api/history.js', () => ({
  createCommit: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { captureNoteSnapshot } from '../commit-snapshot.js';
import { createCommit } from '@/lib/api/history.js';
import { logger } from '@/utils/logger';
import { recordPushedCommits } from '../record-commits.js';

const snapshot = { content: '<p>hi</p>', title: 'hi' };

describe('recordPushedCommits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureNoteSnapshot.mockResolvedValue(snapshot);
    createCommit.mockResolvedValue();
  });

  it('creates exactly one commit per pushed note', async () => {
    await recordPushedCommits(['a', 'b']);

    expect(createCommit).toHaveBeenCalledTimes(2);
    expect(createCommit).toHaveBeenCalledWith('a', snapshot);
    expect(createCommit).toHaveBeenCalledWith('b', snapshot);
  });

  it('skips notes whose snapshot is unavailable', async () => {
    captureNoteSnapshot.mockResolvedValue(null);

    await recordPushedCommits(['a']);

    expect(createCommit).not.toHaveBeenCalled();
  });

  it('dedupes note ids already in flight', async () => {
    let release;
    createCommit.mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );

    const first = recordPushedCommits(['a']);
    await vi.waitFor(() => expect(createCommit).toHaveBeenCalledTimes(1));
    const second = recordPushedCommits(['a']);
    await second;
    release();
    await first;

    expect(createCommit).toHaveBeenCalledTimes(1);
  });

  it('caps work at 30 notes per event', async () => {
    const ids = Array.from({ length: 31 }, (_, i) => `n${i}`);

    await recordPushedCommits(ids);

    expect(createCommit).toHaveBeenCalledTimes(30);
  });

  it('never runs more than 4 commits concurrently', async () => {
    let active = 0;
    let peak = 0;
    createCommit.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
    });

    await recordPushedCommits(Array.from({ length: 8 }, (_, i) => `n${i}`));

    expect(peak).toBe(4);
  });

  it('logs commit failures and does not reject', async () => {
    createCommit.mockRejectedValue(new Error('boom'));

    await expect(recordPushedCommits(['a'])).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      '[sync] failed to record history commit for a:',
      'boom',
    );
  });
});
