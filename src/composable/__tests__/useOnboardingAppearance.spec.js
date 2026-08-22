import { describe, it, expect, vi } from 'vitest';
import { reactive, ref } from 'vue';

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({
    translations: ref({
      appearance: { light: 'Light', dark: 'Dark', system: 'System' },
    }),
  }),
}));

vi.mock('@/utils/onboarding/index.js', () => ({
  applyOnboardingFreshPreferences: vi.fn(() => Promise.resolve()),
  ONBOARDING_FONTS: [{ value: 'Inter', label: 'Inter' }],
  ONBOARDING_LANGUAGES: [{ value: 'en', label: 'English' }],
  ONBOARDING_THEMES: [{ name: 'light' }, { name: 'dark' }],
}));

import {
  useOnboardingAppearance,
} from '../useOnboardingAppearance.js';
import { applyOnboardingFreshPreferences } from '@/utils/onboarding/index.js';

function setup() {
  const fresh = reactive({
    theme: 'system',
    accentColor: 'blue',
    selectedFont: 'Inter',
    language: 'en',
    soundsEnabled: true,
    spotlightEnabled: false,
    zoomLevel: 1.0,
  });
  const state = reactive({ error: '', savingPreferences: false });
  const theme = {
    isDark: vi.fn(() => false),
    setTheme: vi.fn(),
    loadTheme: vi.fn(),
    currentTheme: ref('system'),
  };
  const goToStep = vi.fn();
  const appearance = useOnboardingAppearance({ fresh, state, theme, goToStep });
  return { fresh, state, theme, goToStep, appearance };
}

describe('useOnboardingAppearance', () => {
  it('selectTheme applies the choice and mirrors it to the theme system', () => {
    const { fresh, theme, appearance } = setup();
    appearance.selectTheme('dark');
    expect(fresh.theme).toBe('dark');
    expect(theme.setTheme).toHaveBeenCalledWith('dark', false);
  });

  it('selectTheme with system toggles the system flag', () => {
    const { theme, appearance } = setup();
    appearance.selectTheme('system');
    expect(theme.setTheme).toHaveBeenCalledWith('system', true);
  });

  it('selectAccentColor updates the accent and applies the class to the root', () => {
    document.documentElement.classList.add('red');
    const { fresh, appearance } = setup();
    appearance.selectAccentColor('green');
    expect(fresh.accentColor).toBe('green');
    expect(document.documentElement.classList.contains('red')).toBe(false);
    expect(document.documentElement.classList.contains('green')).toBe(true);
    document.documentElement.classList.remove('green');
  });

  it('isDark derives from the chosen theme', () => {
    const { fresh, appearance } = setup();
    fresh.theme = 'dark';
    expect(appearance.isDark.value).toBe(true);
  });

  it('applyFreshAndGo persists preferences then moves to the target step', async () => {
    const { state, goToStep, appearance } = setup();
    await appearance.prepareFreshWorkspace();
    expect(applyOnboardingFreshPreferences).toHaveBeenCalled();
    expect(goToStep).toHaveBeenCalledWith('finish');
    expect(state.savingPreferences).toBe(false);
  });

  it('useDefaultPreferences targets the first wizard card step', async () => {
    const { goToStep, appearance } = setup();
    await appearance.useDefaultPreferences();
    expect(applyOnboardingFreshPreferences).toHaveBeenCalled();
    expect(goToStep).toHaveBeenCalledWith('account');
  });

  it('applyFreshAndGo surfaces errors and still clears the saving flag', async () => {
    applyOnboardingFreshPreferences.mockRejectedValueOnce(
      new Error('boom')
    );
    const { state, goToStep, appearance } = setup();
    await appearance.useDefaultPreferences();
    expect(state.error).toBe('boom');
    expect(goToStep).not.toHaveBeenCalled();
    expect(state.savingPreferences).toBe(false);
  });
});
