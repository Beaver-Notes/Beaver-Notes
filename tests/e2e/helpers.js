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

export async function navigateToLabels() {
  await navigateToSettings();
  const labelsLink = await $('a[href="#/settings/labels"]');
  await labelsLink.click();
  await browser.waitUntil(async () => {
    const url = await browser.getUrl();
    return url.includes('labels');
  });
  await browser.pause(300);
}

export async function navigateToSecurity() {
  await navigateToSettings();
  const securityLink = await $('a[href="#/settings/security"]');
  await securityLink.click();
  await browser.waitUntil(async () => {
    const url = await browser.getUrl();
    return url.includes('security');
  });
  await browser.pause(300);
}

export async function navigateToAppearance() {
  await navigateToSettings();
  const appearanceLink = await $('a[href="#/settings/appearance"]');
  await appearanceLink.click();
  await browser.waitUntil(async () => {
    const url = await browser.getUrl();
    return url.includes('appearance');
  });
  await browser.pause(300);
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

export async function createNoteWithTitle(title) {
  await createNote();
  await browser.execute((text) => {
    const el = document.querySelector('[data-testid="note-title-input"]');
    if (el) {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, title);
  await browser.pause(500);
}

export async function typeInEditor(text) {
  await browser.execute(() => {
    const el = document.querySelector('.ProseMirror');
    if (el) el.focus();
  });
  await browser.pause(200);
  await browser.execute((t) => {
    document.execCommand('insertText', false, t);
  }, text);
  await browser.pause(300);
}

export async function getEditorText() {
  return browser.execute(() => document.querySelector('.ProseMirror')?.textContent || '');
}

export async function getEditorHTML() {
  return browser.execute(() => document.querySelector('.ProseMirror')?.innerHTML || '');
}

export async function getTitleText() {
  return browser.execute(() => document.querySelector('[data-testid="note-title-input"]')?.value || '');
}

export async function selectAllInTitle() {
  await browser.execute(() => {
    const el = document.querySelector('[data-testid="note-title-input"]');
    if (el) {
      el.focus();
      el.select();
    }
  });
  await browser.pause(100);
}

export async function replaceTitleText(newTitle) {
  await browser.execute((text) => {
    const el = document.querySelector('[data-testid="note-title-input"]');
    if (el) {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, newTitle);
  await browser.pause(500);
}

export async function pressShortcut(keys) {
  await browser.keys(keys);
}

export async function waitForNoteCount(expectedCount, timeout = 5000) {
  await browser.waitUntil(async () => {
    const cards = await $$('[data-testid="note-card"]');
    return cards.length === expectedCount;
  }, { timeout, timeoutMsg: `Expected ${expectedCount} note cards` });
}

export async function deleteAllNotes() {
  await navigateToNotes();
  await browser.pause(500);

  const cards = await $$('[data-testid="note-card"]');
  for (let i = 0; i < cards.length; i++) {
    const card = (await $$('[data-testid="note-card"]'))[0];
    if (!card) break;
    await card.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('#/note/');
    });
    await deleteCurrentNote();
    await browser.pause(300);
  }
}

export async function waitForSaved() {
  await browser.pause(800);
}
