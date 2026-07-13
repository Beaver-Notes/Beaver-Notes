import { browser, expect } from '@wdio/globals';

describe('App Launch', () => {
  it('should launch the app and show the main window', async () => {
    const title = await browser.getTitle();
    expect(title).toContain('Beaver');
  });

  it('should display the main content area', async () => {
    const main = await $('[data-testid="app-main"]');
    await expect(main).toBeExisting();
  });

  it('should show the sidebar on desktop', async () => {
    const sidebar = await $('aside');
    await expect(sidebar).toBeExisting();
  });

  it('should display the add note button', async () => {
    const addBtn = await $('[data-testid="add-note-button"]');
    await expect(addBtn).toBeExisting();
  });

  it('should navigate to the home page or a note by default', async () => {
    const url = await browser.getUrl();
    expect(url).toMatch(/#\/($|note\/)/);
  });
});
