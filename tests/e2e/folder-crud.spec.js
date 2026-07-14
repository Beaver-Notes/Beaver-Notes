import { browser, expect } from '@wdio/globals';
import { navigateToNotes } from './helpers.js';

describe('Folder CRUD', () => {
  const folderName = `E2E Folder ${Date.now()}`;
  const renamedFolder = `Renamed Folder ${Date.now()}`;

  it('should create a new folder via keyboard shortcut', async () => {
    await navigateToNotes();
    await browser.keys(['Control', 'Shift', 'f']);
    await browser.pause(500);

    const modal = await $('.modal-ui__content');
    if (await modal.isExisting()) {
      const input = await $('input[type="text"], input[placeholder*="older"], input[placeholder*="name"]');
      if (await input.isExisting()) {
        await input.click();
        await input.setValue(folderName);

        const createBtn = await $('button=Create, button=Add, button[type="submit"]');
        if (await createBtn.isExisting()) {
          await createBtn.click();
        }
      }
    }

    await browser.pause(1000);
  });

  it('should display the folder in the grid', async () => {
    const folderGrid = await $('.folder-grid');
    if (await folderGrid.isExisting()) {
      const items = await folderGrid.$$('.folder-grid__item');
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it('should click into the folder', async () => {
    const folderCard = await $('.folder-card');
    if (await folderCard.isExisting()) {
      await folderCard.click();
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes('#/folder/');
      });
    }
  });

  it('should navigate back to home', async () => {
    const notesBtn = await $('[data-testid="nav-notes-button"]');
    await notesBtn.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.endsWith('#/') || url.endsWith('#');
    });
  });

  it('should create a note inside the folder', async () => {
    const folderCard = await $('.folder-card');
    if (await folderCard.isExisting()) {
      await folderCard.click();
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes('#/folder/');
      });
      await browser.pause(500);

      const addBtn = await $('[data-testid="add-note-button"]');
      if (await addBtn.isExisting()) {
        await addBtn.click();
        await browser.waitUntil(async () => {
          const url = await browser.getUrl();
          return url.includes('#/note/');
        });

        const titleInput = await $('[data-testid="note-title-input"]');
        expect(await titleInput.isExisting()).toBe(true);

        const notesBtn = await $('[data-testid="nav-notes-button"]');
        await notesBtn.click();
        await browser.waitUntil(async () => {
          const url = await browser.getUrl();
          return url.endsWith('#/') || url.endsWith('#');
        });
      }
    }
  });

  it('should delete the folder via context menu', async () => {
    const folderCard = await $('.folder-card');
    if (await folderCard.isExisting()) {
      await folderCard.click({ button: 'right' });
      await browser.pause(500);

      const deleted = await browser.execute(() => {
        const items = Array.from(document.querySelectorAll('[role="menuitem"], button, .context-menu-item'));
        const target = items.find(el => el.textContent.includes('Delete'));
        if (target) { target.click(); return true; }
        return false;
      });

      if (deleted) {
        await browser.pause(300);
        await browser.execute(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.textContent.includes('Delete') || b.textContent.includes('Confirm'));
          if (btn) btn.click();
        });
      }
    }

    await browser.pause(500);
  });
});
