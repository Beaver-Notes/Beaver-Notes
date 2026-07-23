import { browser, expect } from '@wdio/globals';
import { navigateToNotes, deleteCurrentNote } from './helpers.js';

describe('Search', () => {
  const searchTerm = `searchable-${Date.now()}`;

  before(async () => {
    const addBtn = await $('[data-testid="add-note-button"]');
    await addBtn.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('#/note/');
    });

    const titleInput = await $('[data-testid="note-title-input"]');
    await titleInput.click();
    await browser.keys(`Note containing ${searchTerm}`);

    const editor = await $('[data-testid="note-body-editor"]');
    await editor.click();
    await browser.keys(`This note contains the unique search term: ${searchTerm}`);

    await navigateToNotes();
  });

  it('should find the note via search', async () => {
    const searchInput = await $('input[placeholder*="earch"], input[placeholder*="earch"]');
    if (await searchInput.isExisting()) {
      await searchInput.click();
      await searchInput.setValue(searchTerm);

      await browser.pause(1500);

      const cards = await $$('[data-testid="note-card"]');
      expect(cards.length).toBeGreaterThan(0);
    }
  });

  it('should find note by body text search', async () => {
    const searchInput = await $('input[placeholder*="earch"], input[placeholder*="earch"]');
    if (await searchInput.isExisting()) {
      await searchInput.click();
      await searchInput.setValue('unique search term');
      await browser.pause(1500);

      const cards = await $$('[data-testid="note-card"]');
      expect(cards.length).toBeGreaterThan(0);
    }
  });

  it('should be case-insensitive', async () => {
    const searchInput = await $('input[placeholder*="earch"], input[placeholder*="earch"]');
    if (await searchInput.isExisting()) {
      await searchInput.click();
      await searchInput.setValue(searchTerm.toUpperCase());
      await browser.pause(1500);

      const cards = await $$('[data-testid="note-card"]');
      expect(cards.length).toBeGreaterThan(0);
    }
  });

  it('should show no results for gibberish search', async () => {
    const searchInput = await $('input[placeholder*="earch"], input[placeholder*="earch"]');
    if (await searchInput.isExisting()) {
      await searchInput.click();
      await searchInput.setValue('zzznonexistentquery12345');
      await browser.pause(1500);

      const cards = await $$('[data-testid="note-card"]');
      const isEmpty = cards.length === 0;

      const hasEmptyIndicator = await browser.execute(() => {
        const els = Array.from(document.querySelectorAll('*'));
        return els.some(el => {
          const text = el.textContent?.toLowerCase() || '';
          return (text.includes('no results') || text.includes('no notes') ||
                  text.includes('empty') || text.includes('nothing')) &&
                 el.offsetParent !== null;
        });
      });

      expect(isEmpty || hasEmptyIndicator).toBe(true);
    }
  });

  it('should clear search and show all notes', async () => {
    const searchInput = await $('input[placeholder*="earch"], input[placeholder*="earch"]');
    if (await searchInput.isExisting()) {
      const cardsBefore = await $$('[data-testid="note-card"]');
      const countBefore = cardsBefore.length;

      await searchInput.click();
      await browser.keys(['Control', 'a']);
      await browser.keys('Backspace');
      await browser.pause(1000);

      const cardsAfter = await $$('[data-testid="note-card"]');
      expect(cardsAfter.length).toBe(countBefore);
    }
  });

  after(async () => {
    try {
      await navigateToNotes();
      await browser.pause(500);
      const cards = await $$('[data-testid="note-card"]');
      for (const card of cards) {
        const text = await card.getText();
        if (text.includes(searchTerm)) {
          await card.click();
          await browser.waitUntil(async () => {
            const url = await browser.getUrl();
            return url.includes('#/note/');
          });
          await deleteCurrentNote();
          await browser.pause(300);
          break;
        }
      }
      await navigateToNotes();
    } catch {
      // cleanup best-effort
    }
  });
});
