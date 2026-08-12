import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createDebouncedLatest } from './latest.js';

describe('createDebouncedLatest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces repeated calls to the latest one', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const debounced = createDebouncedLatest(fn, 50);

    debounced('a');
    debounced('b');
    debounced('c');

    await vi.advanceTimersByTimeAsync(50);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('resolves with the result of the executed call', async () => {
    const debounced = createDebouncedLatest(async (x) => x * 2, 50);
    const promise = debounced(21);
    await vi.advanceTimersByTimeAsync(50);
    await expect(promise).resolves.toBe(42);
  });

  it('does not run the underlying fn before the delay elapses', async () => {
    const fn = vi.fn().mockResolvedValue('x');
    const debounced = createDebouncedLatest(fn, 100);
    debounced();
    await vi.advanceTimersByTimeAsync(50);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
