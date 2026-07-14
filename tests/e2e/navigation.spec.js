import { browser, expect } from '@wdio/globals';
import { navigateToSettings, navigateToNotes, navigateToArchive } from './helpers.js';

describe('Navigation', () => {
  it('should navigate to Settings page', async () => {
    await navigateToSettings();
    const url = await browser.getUrl();
    expect(url).toContain('#/settings');
  });

  it('should display settings navigation items', async () => {
    const listItems = await $('div.w-64').$$('a');
    expect(listItems.length).toBeGreaterThan(0);
  });

  it('should navigate back to Notes via sidebar', async () => {
    await navigateToNotes();
    const heading = await $('h1.text-4xl');
    await expect(heading).toBeExisting();
  });

  it('should navigate to Archive', async () => {
    await navigateToArchive();
  });

  it('should navigate back to Notes from Archive', async () => {
    await navigateToNotes();
    const url = await browser.getUrl();
    expect(url).not.toContain('archived=true');
  });
});
