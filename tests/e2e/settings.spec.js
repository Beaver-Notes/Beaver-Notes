import { browser, expect } from '@wdio/globals';
import { navigateToSettings, navigateToNotes } from './helpers.js';

describe('Settings', () => {
  it('should navigate to Settings', async () => {
    await navigateToSettings();
  });

  it('should display General settings by default', async () => {
    const url = await browser.getUrl();
    expect(url).toContain('#/settings');
  });

  it('should navigate to Appearance settings', async () => {
    const appearanceLink = await $('a[href="#/settings/appearance"]');
    await appearanceLink.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('appearance');
    });
  });

  it('should show theme options in Appearance', async () => {
    await browser.pause(500);
    const hasThemeOptions = await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.filter(b => {
        const text = b.textContent.toLowerCase();
        return text.includes('light') || text.includes('dark') || text.includes('system');
      }).length >= 2;
    });
    expect(hasThemeOptions).toBe(true);
  });

  it('should navigate to Shortcuts settings', async () => {
    const shortcutsLink = await $('a[href="#/settings/shortcuts"]');
    await shortcutsLink.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('shortcuts');
    });
  });

  it('should display shortcut entries', async () => {
    await browser.pause(500);
    const hasShortcuts = await browser.execute(() => {
      const kbd = Array.from(document.querySelectorAll('kbd, [class*="shortcut"], [class*="key"]'));
      return kbd.length > 0;
    });
    expect(hasShortcuts).toBe(true);
  });

  it('should navigate to Labels settings', async () => {
    const labelsLink = await $('a[href="#/settings/labels"]');
    await labelsLink.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('labels');
    });
  });

  it('should navigate to Security settings', async () => {
    const securityLink = await $('a[href="#/settings/security"]');
    await securityLink.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('security');
    });
  });

  it('should navigate to About settings', async () => {
    const aboutLink = await $('a[href="#/settings/about"]');
    await aboutLink.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('about');
    });
  });

  it('should display version info in About', async () => {
    await browser.pause(500);
    const hasVersion = await browser.execute(() => {
      const els = Array.from(document.querySelectorAll('*'));
      return els.some(el => /\d+\.\d+\.\d+/.test(el.textContent) && el.offsetParent !== null);
    });
    expect(hasVersion).toBe(true);
  });

  it('should navigate back to home', async () => {
    await navigateToNotes();
  });
});
