import { browser, expect } from '@wdio/globals';

describe('Keyboard Shortcuts', () => {
  it('should create a new note with Ctrl+N', async () => {
    await browser.keys(['Control', 'n']);
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('#/note/');
    });

    const titleInput = await $('[data-testid="note-title-input"]');
    await expect(titleInput).toBeExisting();
  });

  it('should go back to home with Escape or back navigation', async () => {
    const notesBtn = await $('[data-testid="nav-notes-button"]');
    await notesBtn.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.endsWith('#/') || url.endsWith('#');
    });
  });

  it('should open command prompt with Ctrl+K or Cmd+K', async () => {
    await browser.keys(['Control', 'k']);
    await browser.pause(500);

    const prompt = await $('app-command-prompt, [class*="command-prompt"], [class*="command-palette"]');
    const hasPrompt = await prompt.isExisting().catch(() => false);

    expect(hasPrompt).toBe(true);

    if (hasPrompt) {
      await browser.keys(['Escape']);
    }
  });

  it('should open new folder dialog with Ctrl+Shift+F', async () => {
    await browser.keys(['Control', 'Shift', 'f']);
    await browser.pause(500);

    const modal = await $('.modal-ui__content');
    const hasModal = await modal.isExisting().catch(() => false);

    expect(hasModal).toBe(true);

    if (hasModal) {
      await browser.keys(['Escape']);
    }
  });
});
