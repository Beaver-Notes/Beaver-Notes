import { browser, expect } from '@wdio/globals';

describe('Settings', () => {
  it('should navigate to Settings', async () => {
    const settingsLink = await $('a[href="#/settings"]');
    await settingsLink.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('#/settings');
    });
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

  it('should navigate to Shortcuts settings', async () => {
    const shortcutsLink = await $('a[href="#/settings/shortcuts"]');
    await shortcutsLink.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('shortcuts');
    });
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

  it('should navigate back to home', async () => {
    const notesBtn = await $('[data-testid="nav-notes-button"]');
    await notesBtn.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.endsWith('#/') || url.endsWith('#');
    });
  });
});
