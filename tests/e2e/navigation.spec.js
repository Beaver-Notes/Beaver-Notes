import { browser, expect } from '@wdio/globals';

describe('Navigation', () => {
  it('should navigate to Settings page', async () => {
    const settingsLink = await $('a[href="#/settings"]');
    await settingsLink.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('#/settings');
    });
    const url = await browser.getUrl();
    expect(url).toContain('#/settings');
  });

  it('should display settings navigation items', async () => {
    const listItems = await $('div.w-64').$$('a');
    expect(listItems.length).toBeGreaterThan(0);
  });

  it('should navigate back to Notes via sidebar', async () => {
    const notesBtn = await $('[data-testid="nav-notes-button"]');
    await notesBtn.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.endsWith('#/') || url.endsWith('#');
    });
    const heading = await $('h1.text-4xl');
    await expect(heading).toBeExisting();
  });

  it('should navigate to Archive', async () => {
    const archiveBtn = await $('[data-testid="nav-archive-button"]');
    await archiveBtn.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('archived=true');
    });
  });

  it('should navigate back to Notes from Archive', async () => {
    const notesBtn = await $('[data-testid="nav-notes-button"]');
    await notesBtn.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return !url.includes('archived=true');
    });
  });
});
