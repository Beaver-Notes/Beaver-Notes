import { browser } from '@wdio/globals';

export async function navigateToNotes() {
  const notesBtn = await $('[data-testid="nav-notes-button"]');
  if (await notesBtn.isExisting()) {
    await notesBtn.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.endsWith('#/') || url.endsWith('#');
    });
  }
}

export async function navigateToSettings() {
  const settingsLink = await $('a[href="#/settings"]');
  await settingsLink.click();
  await browser.waitUntil(async () => {
    const url = await browser.getUrl();
    return url.includes('#/settings');
  });
}

export async function navigateToArchive() {
  const archiveBtn = await $('[data-testid="nav-archive-button"]');
  await archiveBtn.click();
  await browser.waitUntil(async () => {
    const url = await browser.getUrl();
    return url.includes('archived=true');
  });
}

export async function deleteCurrentNote() {
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

    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.endsWith('#/') || url.endsWith('#');
    });
  }
}

export async function createNote() {
  const addBtn = await $('[data-testid="add-note-button"]');
  await addBtn.click();

  await browser.waitUntil(async () => {
    const url = await browser.getUrl();
    return url.includes('#/note/');
  });
  await browser.pause(500);
}
