import { browser, expect } from '@wdio/globals';
import { navigateToNotes, navigateToSettings } from './helpers.js';

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

  it('should have a skip-to-content link', async () => {
    await navigateToNotes();
    await browser.pause(500);

    const skipLink = await browser.execute(() => {
      const link = document.querySelector('a[href="#app-main"]');
      if (!link) return null;
      return {
        exists: true,
        text: link.textContent.trim(),
        hasSrOnlyClass: link.classList.contains('sr-only') ||
          link.className.includes('sr-only'),
      };
    });

    expect(skipLink).not.toBeNull();
    expect(skipLink.exists).toBe(true);
    expect(skipLink.text).toBe('Skip to content');
  });

  it('should set html lang attribute', async () => {
    const lang = await browser.execute(() => {
      return document.documentElement.getAttribute('lang');
    });

    expect(lang).toBeTruthy();
    expect(typeof lang).toBe('string');
    expect(lang.length).toBeGreaterThanOrEqual(2);
  });

  it('should update document title on navigation', async () => {
    await navigateToNotes();
    await browser.pause(500);

    const homeTitle = await browser.execute(() => document.title);
    expect(homeTitle).toBeTruthy();

    await navigateToSettings();
    await browser.pause(500);

    const settingsTitle = await browser.execute(() => document.title);
    expect(settingsTitle).toBeTruthy();
    expect(settingsTitle).not.toBe(homeTitle);
  });

  it('should have live region for announcements', async () => {
    const liveRegion = await browser.execute(() => {
      const region = document.getElementById('a11y-live-region');
      if (!region) return null;
      return {
        exists: true,
        ariaLive: region.getAttribute('aria-live'),
        ariaAtomic: region.getAttribute('aria-atomic'),
        hasSrOnly: region.classList.contains('sr-only'),
      };
    });

    expect(liveRegion).not.toBeNull();
    expect(liveRegion.exists).toBe(true);
    expect(liveRegion.ariaLive).toBe('polite');
    expect(liveRegion.ariaAtomic).toBe('true');
  });

  it('should have proper landmark roles', async () => {
    await navigateToNotes();
    await browser.pause(500);

    const landmarks = await browser.execute(() => {
      const main = document.getElementById('app-main');
      const aside = document.querySelector('aside');
      const nav = document.querySelector('nav');
      return {
        hasMain: !!main,
        mainTag: main?.tagName === 'MAIN',
        hasAside: !!aside,
        hasNav: !!nav,
        navRole: nav?.getAttribute('role'),
      };
    });

    expect(landmarks.hasMain).toBe(true);
    expect(landmarks.mainTag).toBe(true);
    expect(landmarks.hasAside).toBe(true);
    expect(landmarks.hasNav).toBe(true);
  });

  it('should not have any buttons without accessible names', async () => {
    await navigateToNotes();
    await browser.pause(500);

    const unlabeledButtons = await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns
        .filter(btn => {
          const hasLabel = !!(
            btn.getAttribute('aria-label') ||
            btn.getAttribute('aria-labelledby') ||
            btn.textContent.trim()
          );
          const isVisible = btn.offsetParent !== null || btn.offsetWidth > 0;
          return isVisible && !hasLabel;
        })
        .map(btn => ({
          text: btn.textContent.trim().substring(0, 30),
          classes: btn.className.substring(0, 50),
        }));
    });

    expect(unlabeledButtons).toEqual([]);
  });
});
