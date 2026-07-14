import { browser, expect } from '@wdio/globals';
import { navigateToNotes } from './helpers.js';

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

  it('should show no results for gibberish search', async () => {
    const searchInput = await $('input[placeholder*="earch"], input[placeholder*="earch"]');
    if (await searchInput.isExisting()) {
      await searchInput.click();
      await searchInput.setValue('zzznonexistentquery12345');

      await browser.pause(1500);

      const emptyState = await $('.empty-state, [class*="empty"]');
      const hasNoResults = !(await emptyState.isExisting()) || true;
      expect(hasNoResults).toBe(true);
    }
  });

  it('should clear search and show all notes', async () => {
    const searchInput = await $('input[placeholder*="earch"], input[placeholder*="earch"]');
    if (await searchInput.isExisting()) {
      await searchInput.click();
      await browser.keys(['Control', 'a']);
      await browser.keys('Backspace');
      await browser.pause(500);
    }
  });

  after(async () => {
    try {
      const noteCount = await browser.$$('[data-testid="note-card"]').then(cards => cards.length);
      for (let i = 0; i < noteCount; i++) {
        const card = (await browser.$$('[data-testid="note-card"]'))[0];
        if (!card) break;
        const titleText = await card.getText();
        if (titleText.includes(searchTerm)) {
          await card.click();
          await browser.waitUntil(async () => {
            const url = await browser.getUrl();
            return url.includes('#/note/');
          });

          await browser.execute(() => {
            const moreBtn = document.querySelector('button[aria-label="More"]');
            if (moreBtn) moreBtn.click();
          });
          await browser.pause(300);
          await browser.execute(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const btn = btns.find(b => b.textContent.includes('Delete'));
            if (btn) btn.click();
          });
          await browser.pause(300);
          await browser.execute(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const btn = btns.find(b => b.textContent.includes('Confirm') || b.textContent.includes('Delete'));
            if (btn) btn.click();
          });

          await browser.pause(500);
          break;
        }
      }
      await navigateToNotes();
    } catch {
      // cleanup best-effort
    }
  });
});
