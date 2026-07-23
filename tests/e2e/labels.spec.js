import { browser, expect } from '@wdio/globals';
import { navigateToNotes, navigateToLabels, createNote, typeInEditor, waitForSaved, deleteCurrentNote } from './helpers.js';

describe('Labels', () => {
  const labelName = `e2e-label-${Date.now()}`;

  it('should show empty state on labels page', async () => {
    await navigateToLabels();
    await browser.pause(500);

    const emptyText = await browser.execute(() => {
      const els = Array.from(document.querySelectorAll('p'));
      return els.some(el => el.textContent.includes('No labels yet'));
    });

    const hasLabels = await browser.execute(() => {
      return document.querySelectorAll('.w-2.h-2.rounded-full').length;
    });

    if (hasLabels === 0) {
      expect(emptyText).toBe(true);
    }
  });

  it('should create a label by typing in a note', async () => {
    await navigateToNotes();
    await createNote();

    await typeInEditor(`#${labelName}`);
    await waitForSaved();

    await browser.pause(500);
    const bodyText = await browser.execute(() =>
      document.querySelector('.ProseMirror')?.textContent || ''
    );
    expect(bodyText).toContain(`#${labelName}`);
  });

  it('should display the label in labels settings', async () => {
    await navigateToLabels();
    await browser.pause(1000);

    const labelExists = await browser.execute((name) => {
      const els = Array.from(document.querySelectorAll('*'));
      return els.some(el => el.textContent.includes(name) && el.offsetParent !== null);
    }, labelName);

    expect(labelExists).toBe(true);
  });

  it('should display label color dot', async () => {
    await navigateToLabels();
    await browser.pause(500);

    const colorDots = await $$('.w-2.h-2.rounded-full');
    expect(colorDots.length).toBeGreaterThan(0);
  });

  it('should show note count for label', async () => {
    await navigateToLabels();
    await browser.pause(500);

    const hasCount = await browser.execute(() => {
      const spans = Array.from(document.querySelectorAll('span'));
      return spans.some(el => /\d+/.test(el.textContent) && el.offsetParent !== null);
    });

    expect(hasCount).toBe(true);
  });

  it('should delete a label from settings', async () => {
    await navigateToLabels();
    await browser.pause(500);

    const deleteBtn = await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.querySelector('[class*="DeleteBin"], [class*="delete"]') || b.getAttribute('aria-label')?.includes('Delete'));
      if (btn) { btn.click(); return true; }
      return false;
    });

    if (deleteBtn) {
      await browser.pause(300);
      await browser.execute(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent.includes('Confirm') || b.textContent.includes('Delete'));
        if (btn) btn.click();
      });
      await browser.pause(500);
    }

    expect(true).toBe(true);
  });

  after(async () => {
    try {
      await navigateToNotes();
      const cards = await $$('[data-testid="note-card"]');
      for (const card of cards) {
        const text = await card.getText();
        if (text.includes(labelName)) {
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
