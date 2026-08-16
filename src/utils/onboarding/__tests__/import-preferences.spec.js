import { describe, it, expect, vi, beforeEach } from 'vitest';

const setSetting = vi.fn(async () => {});
vi.mock('@/lib/settings', () => ({ setSetting }));

const readLegacyPreferences = vi.fn();
vi.mock('@/lib/native/app.js', () => ({ readLegacyPreferences }));

const { importLegacyPreferences } = await import('../import-preferences.js');

describe('importLegacyPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readLegacyPreferences.mockResolvedValue({
      'selected-font': 'Arimo',
      'color-scheme': 'light',
      'theme': 'dark',
      'zoomLevel': '1.25',
      'unknown-key': 'ignored',
    });
  });

  it('writes only whitelisted preference keys', async () => {
    const count = await importLegacyPreferences('/legacy');
    expect(setSetting).toHaveBeenCalledWith('selectedFont', 'Arimo');
    expect(setSetting).toHaveBeenCalledWith('colorScheme', 'light');
    expect(setSetting).toHaveBeenCalledWith('theme', 'dark');
    expect(setSetting).toHaveBeenCalledWith('zoomLevel', '1.25');
    expect(setSetting).not.toHaveBeenCalledWith('unknown-key', 'ignored');
    expect(count).toBe(4);
  });

  it('returns 0 and swallows errors when the read fails', async () => {
    readLegacyPreferences.mockRejectedValue(new Error('nope'));
    const count = await importLegacyPreferences('/legacy');
    expect(count).toBe(0);
  });
});
