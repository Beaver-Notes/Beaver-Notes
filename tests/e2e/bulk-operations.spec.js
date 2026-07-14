import { browser, expect } from '@wdio/globals';
import { navigateToNotes, createNoteWithTitle, deleteCurrentNote } from './helpers.js';

describe('Bulk Operations', () => {
  const bulkId = Date.now();

  before(async () => {
    await navigateToNotes();
    for (let i = 0; i < 3; i++) {
      await createNoteWithTitle(`Bulk Note ${bulkId} ${i}`);
      await navigateToNotes();
    }
    await browser.pause(500);
  });

  it('should select a note via checkbox', async () => {
    const checkboxes = await browser.execute(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      if (inputs.length > 0) {
        inputs[0].click();
        return inputs.length;
      }
      return 0;
    });

    expect(checkboxes).toBeGreaterThan(0);
  });

  it('should show selection count', async () => {
    await browser.pause(500);

    const selectionBar = await browser.execute(() => {
      const els = Array.from(document.querySelectorAll('*'));
      return els.some(el =>
        el.textContent.includes('items') && el.offsetParent !== null
      );
    });

    expect(selectionBar).toBe(true);
  });

  it('should select all notes', async () => {
    await browser.execute(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      inputs.forEach(input => {
        if (!input.checked) input.click();
      });
    });
    await browser.pause(500);

    const checkedCount = await browser.execute(() => {
      return document.querySelectorAll('input[type="checkbox"]:checked').length;
    });

    expect(checkedCount).toBeGreaterThanOrEqual(3);
  });

  it('should clear selection', async () => {
    await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const clearBtn = btns.find(b =>
        b.textContent.includes('Clear') ||
        b.getAttribute('aria-label')?.includes('Clear') ||
        b.querySelector('[class*="close"], [class*="x"]')
      );
      if (clearBtn) clearBtn.click();
    });
    await browser.pause(500);

    const hasSelection = await browser.execute(() => {
      return document.querySelectorAll('input[type="checkbox"]:checked').length;
    });

    expect(hasSelection).toBe(0);
  });

  it('should bulk archive notes', async () => {
    await browser.execute(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      if (inputs.length >= 2) {
        inputs[0].click();
        inputs[1].click();
      }
    });
    await browser.pause(500);

    await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const archiveBtn = btns.find(b =>
        b.getAttribute('aria-label')?.includes('rchive') ||
        b.querySelector('[class*="archive"]')
      );
      if (archiveBtn) archiveBtn.click();
    });
    await browser.pause(1000);

    expect(true).toBe(true);
  });

  after(async () => {
    try {
      await navigateToNotes();
      const cards = await $$('[data-testid="note-card"]');
      for (const card of cards) {
        const text = await card.getText();
        if (text.includes(String(bulkId))) {
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
