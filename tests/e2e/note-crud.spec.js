import { browser, expect } from '@wdio/globals';
import { navigateToNotes, deleteCurrentNote, createNote } from './helpers.js';

describe('Note CRUD', () => {
  const noteTitle = 'E2E Test Note ' + Date.now();
  const updatedTitle = 'Updated E2E Note ' + Date.now();

  it('should create a new note', async () => {
    await navigateToNotes();
    await createNote();

    const titleInput = await $('[data-testid="note-title-input"]');
    await expect(titleInput).toBeExisting();
  });

  it('should set the note title', async () => {
    await browser.execute(() => {
      const el = document.querySelector('[data-testid="note-title-input"]');
      if (el) { el.focus(); }
    });
    await browser.pause(200);
    await browser.execute((text) => {
      document.execCommand('insertText', false, text);
    }, noteTitle);
    await browser.pause(500);

    const text = await browser.execute(() => document.querySelector('[data-testid="note-title-input"]')?.textContent || '');
    expect(text).toContain('E2E Test Note');
  });

  it('should type in the note body', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) { el.focus(); }
    });
    await browser.pause(200);
    await browser.execute(() => {
      document.execCommand('insertText', false, 'This is the body of the E2E test note.');
    });
    await browser.pause(500);

    const text = await browser.execute(() => document.querySelector('.ProseMirror')?.textContent || '');
    expect(text).toContain('E2E test note');
  });

  it('should navigate back to home and see the note card', async () => {
    const notesBtn = await $('[data-testid="nav-notes-button"]');
    await notesBtn.click();

    await browser.waitUntil(async () => {
      const cards = await $$('[data-testid="note-card"]');
      return cards.length > 0;
    });

    const cards = await $$('[data-testid="note-card"]');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('should open the created note from the card', async () => {
    const firstCard = await $$('[data-testid="note-card"]');
    await firstCard[0].click();

    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('#/note/');
    });
    await browser.pause(500);

    const titleInput = await $('[data-testid="note-title-input"]');
    await expect(titleInput).toBeExisting();
  });

  it('should edit the note title', async () => {
    await browser.execute(() => {
      const el = document.querySelector('[data-testid="note-title-input"]');
      if (el) {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
    await browser.pause(200);
    await browser.execute((text) => {
      document.execCommand('insertText', false, text);
    }, updatedTitle);
    await browser.pause(500);

    const text = await browser.execute(() => document.querySelector('[data-testid="note-title-input"]')?.textContent || '');
    expect(text).toContain('Updated E2E Note');
  });

  it('should delete the note via the actions menu', async () => {
    await deleteCurrentNote();
  });
});
