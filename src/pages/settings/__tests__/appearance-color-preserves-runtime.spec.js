import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: { appearance: {} } }),
}));
vi.mock('@/composable/theme', () => ({
  useTheme: () => ({ currentTheme: { value: 'light' }, setTheme: vi.fn(), loadTheme: vi.fn() }),
}));
vi.mock('@/lib/settings', () => ({
  DEFAULT_UI_FONT_STACK: 'sans-serif',
  getSettingSync: () => null,
  setSetting: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({ useStorage: () => ({ get: vi.fn() }) }));
vi.mock('@/store/app', () => ({ useAppStore: () => ({ setting: {} }) }));
vi.mock('@/utils/ui/zoom', () => ({
  formatZoomLevel: (v) => v,
  getStoredZoomLevel: () => 1,
  setStoredZoomLevel: vi.fn(),
}));
vi.mock('@/lib/native/app', () => ({ getSystemFonts: vi.fn().mockResolvedValue([]), setMenuVisibility: vi.fn() }));
vi.mock('@/lib/native/app-icon', () => ({ isSupported: vi.fn().mockResolvedValue({ value: false }) }));

import Appearance from '../Appearance.vue';

describe('Appearance.setColor', () => {
  it('preserves runtime-* classes when changing accent color', async () => {
    document.documentElement.classList.add('runtime-mobile', 'custom-scrollbar');
    const wrapper = mount(Appearance);
    wrapper.vm.setColor('blue');
    expect(document.documentElement.classList.contains('runtime-mobile')).toBe(true);
    expect(document.documentElement.classList.contains('custom-scrollbar')).toBe(true);
    expect(document.documentElement.classList.contains('blue')).toBe(true);
    document.documentElement.classList.remove('runtime-mobile', 'custom-scrollbar', 'blue');
  });
});
