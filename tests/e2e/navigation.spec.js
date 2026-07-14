import { browser, expect } from '@wdio/globals';
import { navigateToSettings, navigateToNotes, navigateToArchive, createNote, deleteCurrentNote } from './helpers.js';

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

  it('should deep-link to a specific note', async () => {
    await navigateToNotes();
    await createNote();
    const currentUrl = await browser.getUrl();
    const noteIdMatch = currentUrl.match(/#\/note\/(.+)/);
    expect(noteIdMatch).toBeTruthy();

    await navigateToNotes();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.endsWith('#/') || url.endsWith('#');
    });

    if (noteIdMatch) {
      await browser.url(currentUrl);
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes('#/note/');
      });
      await browser.pause(500);

      const titleInput = await $('[data-testid="note-title-input"]');
      expect(await titleInput.isExisting()).toBe(true);
    }
  });

  it('should round-trip between Notes and Archive', async () => {
    await navigateToNotes();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.endsWith('#/') || url.endsWith('#');
    });

    await navigateToArchive();
    const urlArchive = await browser.getUrl();
    expect(urlArchive).toContain('archived=true');

    await navigateToNotes();
    const urlNotes = await browser.getUrl();
    expect(urlNotes).not.toContain('archived=true');
  });

  it('should round-trip between Settings and Notes', async () => {
    await navigateToSettings();
    await navigateToNotes();
    const url = await browser.getUrl();
    expect(url).not.toContain('settings');
  });

  after(async () => {
    try {
      await navigateToNotes();
      const cards = await $$('[data-testid="note-card"]');
      for (const card of cards) {
        const text = await card.getText();
        if (text.includes('E2E') || text.includes('Test')) {
          await card.click();
          await browser.waitUntil(async () => {
            const url = await browser.getUrl();
            return url.includes('#/note/');
          });
          await deleteCurrentNote();
          await browser.pause(300);
        }
      }
    } catch {
      // best-effort cleanup
    }
  });
});
