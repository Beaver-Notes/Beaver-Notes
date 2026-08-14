import { describe, it, expect, afterEach } from 'vitest';

function mockUA(ua, width = 800) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

afterEach(() => {
  delete navigator.userAgent;
  delete window.innerWidth;
});

describe('runtime form factors', () => {
  it('treats an iPad UA as touch (mobile) but not desktop', async () => {
    mockUA('Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1');
    const runtime = await import('../runtime.js');
    expect(runtime.isTouchRuntime()).toBe(true);
    expect(runtime.isDesktopRuntime()).toBe(false);
  });

  it('treats an Android phone as touch and never as macOS', async () => {
    mockUA('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36');
    const runtime = await import('../runtime.js');
    expect(runtime.isTouchRuntime()).toBe(true);
    expect(runtime.isDesktopRuntime()).toBe(false);
    expect(runtime.isMacOSRuntime()).toBe(false);
  });

  it('treats macOS as desktop and macOS', async () => {
    mockUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    const runtime = await import('../runtime.js');
    expect(runtime.isTouchRuntime()).toBe(false);
    expect(runtime.isDesktopRuntime()).toBe(true);
    expect(runtime.isMacOSRuntime()).toBe(true);
  });
});
