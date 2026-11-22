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

  it('should display label color dot', async () => {
    await navigateToLabels();
    await browser.pause(500);

    const colorDots = await $$('.w-2.h-2.rounded-full');
    expect(colorDots.length).toBeGreaterThan(0);
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
