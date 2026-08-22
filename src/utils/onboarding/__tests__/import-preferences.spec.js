import { describe, it, expect, vi, beforeEach } from 'vitest';

const setSetting = vi.fn(async () => {});
const getSettingSync = vi.fn(() => 'folder');
vi.mock('@/lib/settings', () => ({ setSetting, getSettingSync }));

const readLegacyPreferences = vi.fn();
vi.mock('@/lib/native/app.js', () => ({ readLegacyPreferences }));

const setSyncPath = vi.fn(async () => {});
vi.mock('@/utils/sync/path.js', () => ({ setSyncPath }));

const { importLegacyPreferences } = await import('../import-preferences.js');

describe('importLegacyPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingSync.mockReturnValue('folder');
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

  it('writes default-path through setSyncPath for folder transport', async () => {
    readLegacyPreferences.mockResolvedValue({
      'default-path': '/data/notes',
      'selected-font': 'Arimo',
    });
    const count = await importLegacyPreferences('/legacy');
    expect(setSyncPath).toHaveBeenCalledWith('/data/notes');
    expect(setSetting).not.toHaveBeenCalledWith('syncPath', '/data/notes');
    expect(count).toBe(2);
  });

  it('skips default-path for remote (cloud) transport', async () => {
    getSettingSync.mockReturnValue('remote');
    readLegacyPreferences.mockResolvedValue({
      'default-path': '/data/notes',
      'selected-font': 'Arimo',
    });
    const count = await importLegacyPreferences('/legacy');
    expect(setSyncPath).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalledWith('syncPath', expect.anything());
    expect(setSetting).toHaveBeenCalledWith('selectedFont', 'Arimo');
    expect(count).toBe(1);
  });
});
