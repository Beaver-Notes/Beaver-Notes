import { describe, it, expect } from 'vitest';
import { ALL_PLATFORMS, isPlatformVisible } from '@/utils/onboarding/platforms';

const visiblePlatforms = (isMacOS, isTouch) =>
  ALL_PLATFORMS.filter((p) => isPlatformVisible(p, { isMacOS, isTouch }));

describe('onboarding platform gating', () => {
  it('hides Apple Notes on a non-macOS touch device (e.g. iPad)', () => {
    const visible = visiblePlatforms(false, true);
    expect(visible.some((p) => p.id === 'apple-notes')).toBe(false);
  });

  it('shows Apple Notes on macOS desktop', () => {
    const visible = visiblePlatforms(true, false);
    expect(visible.some((p) => p.id === 'apple-notes')).toBe(true);
  });

  it('keeps desktop-only platforms hidden on touch devices even on macOS', () => {
    const visible = visiblePlatforms(true, true);
    expect(visible.some((p) => p.desktopOnly)).toBe(false);
  });
});
