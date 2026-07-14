import { browser, expect } from '@wdio/globals';
import { navigateToNotes } from './helpers.js';

describe('Accessibility', () => {
  it('should have no duplicate IDs on home page', async () => {
    await navigateToNotes();
    await browser.pause(500);

    const duplicateIds = await browser.execute(() => {
      const elements = Array.from(document.querySelectorAll('[id]'));
      const ids = elements.map(el => el.id).filter(Boolean);
      const seen = new Set();
      const duplicates = [];
      for (const id of ids) {
        if (seen.has(id)) duplicates.push(id);
        seen.add(id);
      }
      return duplicates;
    });

    expect(duplicateIds).toEqual([]);
  });

  it('should have aria-labels on icon buttons', async () => {
    await browser.pause(500);

    const sidebarButtons = await browser.execute(() => {
      const aside = document.querySelector('aside');
      if (!aside) return [];
      const btns = Array.from(aside.querySelectorAll('button, a'));
      return btns.map(b => ({
        tag: b.tagName,
        hasLabel: !!(b.getAttribute('aria-label') || b.textContent.trim()),
        text: b.textContent.trim().substring(0, 30)
      }));
    });

    const accessibleButtons = sidebarButtons.filter(b => b.hasLabel);
    expect(accessibleButtons.length).toBeGreaterThan(0);
  });

  it('should support keyboard navigation in sidebar', async () => {
    await browser.pause(500);

    const hasFocusableSidebar = await browser.execute(() => {
      const aside = document.querySelector('aside');
      if (!aside) return false;
      const focusable = aside.querySelectorAll('button, a, [tabindex]');
      return focusable.length > 0;
    });

    expect(hasFocusableSidebar).toBe(true);
  });

  it('should have focusable editor', async () => {
    await browser.execute(() => {
      const addBtn = document.querySelector('[data-testid="add-note-button"]');
      if (addBtn) addBtn.click();
    });
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('#/note/');
    });
    await browser.pause(500);

    const editorFocusable = await browser.execute(() => {
      const editor = document.querySelector('.ProseMirror');
      if (!editor) return false;
      return editor.getAttribute('contenteditable') === 'true' ||
             editor.tabIndex >= 0;
    });

    expect(editorFocusable).toBe(true);

    const notesBtn = await $('[data-testid="nav-notes-button"]');
    await notesBtn.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.endsWith('#/') || url.endsWith('#');
    });
  });

  it('should have proper heading hierarchy', async () => {
    await navigateToNotes();
    await browser.pause(500);

    const headings = await browser.execute(() => {
      const hs = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
      return hs.map(h => ({
        level: parseInt(h.tagName[1]),
        text: h.textContent.trim().substring(0, 30),
        visible: h.offsetParent !== null
      }));
    });

    const visibleHeadings = headings.filter(h => h.visible);
    expect(visibleHeadings.length).toBeGreaterThan(0);

    if (visibleHeadings.length > 0) {
      expect(visibleHeadings[0].level).toBe(1);
    }
  });
});
