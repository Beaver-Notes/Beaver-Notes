import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/native/app', () => ({
  setZoomLevel: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/settings', () => ({
  getSettingSync: vi.fn(() => '1.5'),
  setSetting: vi.fn(() => Promise.resolve()),
}));

describe('zoom boot dedup', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('reports boot zoom has not been applied by default', async () => {
    const { wasZoomAppliedAtBoot } = await import('./zoom.js');
    expect(wasZoomAppliedAtBoot()).toBe(false);
  });

  it('marks and reports boot zoom applied', async () => {
    const { markZoomAppliedAtBoot, wasZoomAppliedAtBoot } = await import(
      './zoom.js'
    );
    markZoomAppliedAtBoot();
    expect(wasZoomAppliedAtBoot()).toBe(true);
  });

  it('setStoredZoomLevel marks the boot flag', async () => {
    const { setStoredZoomLevel, wasZoomAppliedAtBoot } = await import(
      './zoom.js'
    );
    await setStoredZoomLevel(1.0);
    expect(wasZoomAppliedAtBoot()).toBe(true);
  });

  // H1 (async scan 2026-11-01): callers assign the awaited result to zoom
  // state; if it were ever a Promise, the next step parseFloat()s it to NaN
  // and persists the literal "NaN".
  it('setStoredZoomLevel resolves to a parseable numeric string', async () => {
    const { setStoredZoomLevel } = await import('./zoom.js');
    const resolved = await setStoredZoomLevel(1.1);
    expect(typeof resolved).toBe('string');
    expect(parseFloat(resolved)).toBe(1.1);
  });
});
