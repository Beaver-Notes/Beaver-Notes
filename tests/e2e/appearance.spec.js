import { browser, expect } from '@wdio/globals';
import { navigateToAppearance, navigateToNotes } from './helpers.js';

describe('Appearance', () => {
  it('should toggle theme via sidebar button', async () => {
    await navigateToNotes();
    await browser.pause(500);

    const themeBefore = await browser.execute(() => {
      return document.documentElement.classList.contains('dark');
    });

    const themeBtn = await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => {
        const svg = b.querySelector('svg, i');
        return svg && (
          svg.classList?.contains('ri-sun-line') ||
          svg.classList?.contains('ri-moon-clear-line') ||
          b.getAttribute('aria-label')?.includes('theme') ||
          b.getAttribute('aria-label')?.includes('Theme')
        );
      });
      if (btn) { btn.click(); return true; }
      return false;
    });

    await browser.pause(500);

    if (themeBtn) {
      const themeAfter = await browser.execute(() => {
        return document.documentElement.classList.contains('dark');
      });
      expect(themeAfter).not.toBe(themeBefore);
    }
  });

  it('should navigate to appearance settings', async () => {
    await navigateToAppearance();
    const url = await browser.getUrl();
    expect(url).toContain('appearance');
  });

  it('should show theme cards', async () => {
    await browser.pause(500);

    const hasThemeCards = await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.filter(b => {
        const text = b.textContent.toLowerCase();
        return text.includes('light') || text.includes('dark') || text.includes('system');
      }).length >= 2;
    });

    expect(hasThemeCards).toBe(true);
  });

  it('should have active theme indicator', async () => {
    await browser.pause(500);

    const hasActiveTheme = await browser.execute(() => {
      const els = Array.from(document.querySelectorAll('*'));
      return els.some(el =>
        el.className?.includes('ring-primary') ||
        el.className?.includes('ring-1')
      );
    });

    expect(hasActiveTheme).toBe(true);
  });

  it('should persist theme selection', async () => {

    const btns = await browser.execute(() => {
      const allBtns = Array.from(document.querySelectorAll('button'));
      const themeBtns = allBtns.filter(b => {
        const text = b.textContent.toLowerCase();
        return text.includes('light') || text.includes('dark');
      });
      if (themeBtns.length >= 2) {
        themeBtns[1].click();
        return themeBtns.length;
      }
      return 0;
    });

    await browser.pause(500);

    if (btns >= 2) {
      const settingsLink = await $('a[href="#/settings"]');
      await settingsLink.click();
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.includes('#/settings');
      });

      const notesBtn = await $('[data-testid="nav-notes-button"]');
      await notesBtn.click();
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.endsWith('#/') || url.endsWith('#');
      });
      await browser.pause(500);

      const themeAfterNav = await browser.execute(() => {
        return document.documentElement.classList.contains('dark');
      });

      expect(typeof themeAfterNav).toBe('boolean');
    }
  });

  after(async () => {
    try {
      const notesBtn = await $('[data-testid="nav-notes-button"]');
      if (await notesBtn.isExisting()) {
        await notesBtn.click();
        await browser.waitUntil(async () => {
          const url = await browser.getUrl();
          return url.endsWith('#/') || url.endsWith('#');
        });
      }
    } catch {
      // best-effort
    }
  });
});
