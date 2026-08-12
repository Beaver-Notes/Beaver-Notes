import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const storageGet = vi.fn();
const storageSet = vi.fn();

vi.mock('@/lib/tauri-bridge', () => ({
  backend: {
    invoke: vi.fn((channel, payload) => {
      if (channel === 'storage:get') return storageGet(payload);
      if (channel === 'storage:set') return storageSet(payload?.key, payload?.value);
      return null;
    }),
  },
}));

import { getSetting, getSettingSync } from '@/lib/settings.js';

describe('getSetting localStorage fast path', () => {
  beforeEach(() => {
    storageGet.mockReset();
    storageSet.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns the mirrored value from localStorage without an IPC read', async () => {
    localStorage.setItem('theme', 'dark');
    const value = await getSetting('theme');

    expect(value).toBe('dark');
    expect(storageGet).not.toHaveBeenCalled();
  });

  it('falls back to storage when the value is not mirrored', async () => {
    storageGet.mockResolvedValue('light');
    const value = await getSetting('theme');

    expect(value).toBe('light');
    expect(storageGet).toHaveBeenCalled();
  });

  it('writes the default back when storage has no value', async () => {
    storageGet.mockResolvedValue(null);
    const value = await getSetting('theme');

    expect(value).toBe('system');
    expect(storageSet).toHaveBeenCalledWith('theme', 'system');
  });

  it('parses mirrored boolean values', async () => {
    localStorage.setItem('collapsibleHeading', 'false');
    const value = await getSetting('collapsibleHeading');
    expect(value).toBe(false);
  });

  it('still returns correct values via getSettingSync', () => {
    expect(getSettingSync('theme')).toBe('system');
    localStorage.setItem('theme', 'dark');
    expect(getSettingSync('theme')).toBe('dark');
  });
});
