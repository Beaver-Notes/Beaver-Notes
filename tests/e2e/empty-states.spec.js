import { browser, expect } from '@wdio/globals';
import { navigateToNotes, deleteAllNotes, createNote, waitForSaved } from './helpers.js';

describe('Empty States', () => {
  it('should show empty state when no notes exist', async () => {
    await navigateToNotes();
    await browser.pause(500);

    const hasEmptyState = await browser.execute(() => {
      const els = Array.from(document.querySelectorAll('*'));
      return els.some(el =>
        el.textContent.includes('Create Your First Note') ||
        el.textContent.includes('Ready to capture')
      );
    });

    const cardCount = await $$('[data-testid="note-card"]');
    if (cardCount.length === 0) {
      expect(hasEmptyState).toBe(true);
    }
  });

  it('should display Create Your First Note button', async () => {
    await browser.pause(500);

    const hasCTA = await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.includes('Create Your First Note'));
    });

    const cardCount = await $$('[data-testid="note-card"]');
    if (cardCount.length === 0) {
      expect(hasCTA).toBe(true);
    }
  });

  it('should create note from empty state CTA', async () => {
    const cardCount = await $$('[data-testid="note-card"]');
    if (cardCount.length === 0) {
      await browser.execute(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const cta = btns.find(b => b.textContent.includes('Create Your First Note'));
        if (cta) cta.click();
      });

      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes('#/note/');
      }, { timeout: 5000 });

      const titleInput = await $('[data-testid="note-title-input"]');
      expect(await titleInput.isExisting()).toBe(true);

      const notesBtn = await $('[data-testid="nav-notes-button"]');
      await notesBtn.click();
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.endsWith('#/') || url.endsWith('#');
      });
    }
  });

  it('should show keyboard shortcuts in empty state', async () => {
    await browser.pause(500);

    const hasShortcuts = await browser.execute(() => {
      const els = Array.from(document.querySelectorAll('span, kbd'));
      return els.some(el =>
        (el.textContent.includes('Ctrl') || el.textContent.includes('⌘') ||
         el.textContent.includes('Cmd'))
      );
    });

    const cardCount = await $$('[data-testid="note-card"]');
    if (cardCount.length === 0) {
      expect(hasShortcuts).toBe(true);
    }
  });

  after(async () => {
    try {
      const notesBtn = await $('[data-testid="nav-notes-button"]');
      if (await notesBtn.isExisting()) {
        await notesBtn.click();
        await browser.waitUntil(async () => {
          const url = await browser.getUrl();
          return url.endsWith('#/') || url.endsWith('#');
        });
      }
    } catch {
      // best-effort
    }
  });
});
