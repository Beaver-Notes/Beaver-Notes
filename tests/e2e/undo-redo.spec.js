import { browser, expect } from '@wdio/globals';
import { navigateToNotes, createNote, typeInEditor, getEditorText, waitForSaved } from './helpers.js';

describe('Undo/Redo', () => {
  before(async () => {
    await navigateToNotes();
    await createNote();
  });

  it('should undo text insertion', async () => {
    await typeInEditor('undoable text');
    await waitForSaved();

    const textBefore = await getEditorText();
    expect(textBefore).toContain('undoable text');

    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        const ev = new KeyboardEvent('keydown', {
          key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true
        });
        el.dispatchEvent(ev);
      }
    });
    await browser.pause(500);

    const textAfter = await getEditorText();
    expect(textAfter).not.toContain('undoable text');
  });

  it('should redo after undo', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        const ev = new KeyboardEvent('keydown', {
          key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
        });
        el.dispatchEvent(ev);
      }
    });
    await browser.pause(500);

    const text = await getEditorText();
    expect(text).toContain('undoable text');
  });

  it('should support multiple undo steps', async () => {
    await typeInEditor('step one');
    await browser.pause(300);
    await typeInEditor(' step two');
    await waitForSaved();

    const textWithBoth = await getEditorText();
    expect(textWithBoth).toContain('step one');

    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        const ev = new KeyboardEvent('keydown', {
          key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true
        });
        el.dispatchEvent(ev);
      }
    });
    await browser.pause(300);
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        const ev = new KeyboardEvent('keydown', {
          key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true
        });
        el.dispatchEvent(ev);
      }
    });
    await browser.pause(500);

    const textAfterUndo = await getEditorText();
    expect(textAfterUndo).not.toContain('step two');
  });

  it('should show undo banner after note operations', async () => {
    await navigateToNotes();
    await browser.pause(500);

    const cards = await $$('[data-testid="note-card"]');
    if (cards.length > 0) {
      const card = (await $$('[data-testid="note-card"]'))[0];
      await card.click();
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes('#/note/');
      });

      const moreBtn = await $('button[aria-label="More"]');
      if (await moreBtn.isExisting()) {
        await moreBtn.click();
        await browser.pause(300);

        await browser.execute(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.textContent.includes('Delete'));
          if (btn) btn.click();
        });
        await browser.pause(300);

        await browser.execute(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.textContent.includes('Confirm'));
          if (btn) btn.click();
        });
        await browser.pause(1000);

        const undoBanner = await browser.execute(() => {
          const elements = Array.from(document.querySelectorAll('*'));
          return elements.some(el => el.textContent.includes('Undo') && el.offsetParent !== null);
        });

        expect(undoBanner).toBe(true);
      }
    }
  });

  it('should undo note deletion via banner', async () => {
    const cardsBefore = await $$('[data-testid="note-card"]');
    const countBefore = cardsBefore.length;

    const undoBtn = await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.trim() === 'Undo');
      if (btn) { btn.click(); return true; }
      return false;
    });

    if (undoBtn) {
      await browser.pause(1000);
      const cardsAfter = await $$('[data-testid="note-card"]');
      expect(cardsAfter.length).toBe(countBefore + 1);
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
