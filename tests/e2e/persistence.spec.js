import { browser, expect } from '@wdio/globals';
import { navigateToNotes, createNote, createNoteWithTitle, typeInEditor, getTitleText, getEditorText, waitForSaved, deleteCurrentNote } from './helpers.js';

describe('Data Persistence', () => {
  const uniqueId = Date.now();

  it('should persist note title after navigating away and back', async () => {
    const title = `Persist Title ${uniqueId}`;
    await navigateToNotes();
    await createNoteWithTitle(title);

    await navigateToNotes();
    await browser.waitUntil(async () => {
      const cards = await $$('[data-testid="note-card"]');
      return cards.length > 0;
    });

    const cards = await $$('[data-testid="note-card"]');
    await cards[0].click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('#/note/');
    });
    await browser.pause(500);

    const savedTitle = await getTitleText();
    expect(savedTitle).toContain('Persist Title');
  });

  it('should persist note body after navigating away and back', async () => {
    const bodyText = `Persist body content ${uniqueId}`;
    await typeInEditor(bodyText);
    await waitForSaved();

    await navigateToNotes();
    const cards = await $$('[data-testid="note-card"]');
    await cards[0].click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('#/note/');
    });
    await browser.pause(500);

    const savedBody = await getEditorText();
    expect(savedBody).toContain('Persist body content');
  });

  it('should persist multiple notes', async () => {
    await navigateToNotes();
    await createNoteWithTitle(`Multi Note 1 ${uniqueId}`);
    await navigateToNotes();
    await createNoteWithTitle(`Multi Note 2 ${uniqueId}`);
    await navigateToNotes();
    await createNoteWithTitle(`Multi Note 3 ${uniqueId}`);
    await navigateToNotes();

    await browser.waitUntil(async () => {
      const cards = await $$('[data-testid="note-card"]');
      return cards.length >= 3;
    });

    const cards = await $$('[data-testid="note-card"]');
    expect(cards.length).toBeGreaterThanOrEqual(3);
  });

  it('should persist note after settings navigation', async () => {
    const title = `Settings Persist ${uniqueId}`;
    await createNoteWithTitle(title);
    await waitForSaved();

    const settingsLink = await $('a[href="#/settings"]');
    await settingsLink.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('#/settings');
    });
    await browser.pause(500);

    await navigateToNotes();
    const cards = await $$('[data-testid="note-card"]');
    const titles = [];
    for (const card of cards) {
      const text = await card.getText();
      titles.push(text);
    }
    expect(titles.some(t => t.includes('Settings Persist'))).toBe(true);
  });

  it('should persist folder after app operations', async () => {
    await browser.keys(['Control', 'Shift', 'f']);
    await browser.pause(500);

    const modal = await $('.modal-ui__content');
    if (await modal.isExisting()) {
      const input = await $('input[type="text"], input[placeholder*="older"], input[placeholder*="name"]');
      if (await input.isExisting()) {
        await input.click();
        await input.setValue(`Persist Folder ${uniqueId}`);
        const createBtn = await $('button=Create, button=Add, button[type="submit"]');
        if (await createBtn.isExisting()) {
          await createBtn.click();
        }
      }
    }

    await browser.pause(1000);

    const folderCard = await $('.folder-card');
    expect(await folderCard.isExisting()).toBe(true);

    const notesBtn = await $('[data-testid="nav-notes-button"]');
    await notesBtn.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.endsWith('#/') || url.endsWith('#');
    });

    const folderAfter = await $('.folder-card');
    expect(await folderAfter.isExisting()).toBe(true);
  });

  after(async () => {
    try {
      await navigateToNotes();
      const cards = await $$('[data-testid="note-card"]');
      for (const card of cards) {
        const text = await card.getText();
        if (text.includes(String(uniqueId))) {
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
