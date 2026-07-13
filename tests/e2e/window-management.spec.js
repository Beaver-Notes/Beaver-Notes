import { browser, expect } from '@wdio/globals';

describe('Window Management', () => {
  it('should get the current window handle', async () => {
    const handle = await browser.getWindowHandle();
    expect(handle).toBeDefined();
    expect(typeof handle).toBe('string');
  });

  it('should get the window rect', async () => {
    const rect = await browser.getWindowRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.x).toBeDefined();
    expect(rect.y).toBeDefined();
  });

  it('should resize the window', async () => {
    await browser.setWindowRect(100, 100, 1200, 900);
    await browser.pause(300);

    const rect = await browser.getWindowRect();
    expect(rect.width).toBe(1200);
    expect(rect.height).toBe(900);
  });

  it('should restore the window to original size', async () => {
    await browser.setWindowRect(100, 100, 1000, 800);
    await browser.pause(300);

    const rect = await browser.getWindowRect();
    expect(rect.width).toBe(1000);
    expect(rect.height).toBe(800);
  });

  it('should get all window handles', async () => {
    const handles = await browser.getWindowHandles();
    expect(handles.length).toBeGreaterThanOrEqual(1);
  });
});
