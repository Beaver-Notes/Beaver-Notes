import { browser, expect } from '@wdio/globals';
import { navigateToSettings, navigateToNotes } from './helpers.js';

describe('Import/Export', () => {
  it('should navigate to Settings for import', async () => {
    await navigateToSettings();
    const url = await browser.getUrl();
    expect(url).toContain('#/settings');
  });

  it('should display import section', async () => {
    await browser.pause(500);

    const hasImport = await browser.execute(() => {
      const els = Array.from(document.querySelectorAll('*'));
      return els.some(el =>
        el.textContent.includes('Import') && el.offsetParent !== null
      );
    });

    expect(hasImport).toBe(true);
  });

  it('should display import source options', async () => {
    await browser.pause(500);

    const importSources = await browser.execute(() => {
      const els = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      const sources = els.filter(el => {
        const text = el.textContent.toLowerCase();
        return text.includes('obsidian') || text.includes('notion') ||
               text.includes('bear') || text.includes('markdown') ||
               text.includes('simplenote') || text.includes('evernote');
      });
      return sources.length;
    });

    expect(importSources).toBeGreaterThan(0);
  });

  it('should display export section', async () => {
    await browser.pause(500);

    const hasExport = await browser.execute(() => {
      const els = Array.from(document.querySelectorAll('*'));
      return els.some(el =>
        el.textContent.includes('Export') && el.offsetParent !== null
      );
    });

    expect(hasExport).toBe(true);
  });

  it('should display export as markdown option', async () => {
    await browser.pause(500);

    const hasMDExport = await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      return btns.some(b => {
        const text = b.textContent.toLowerCase();
        return text.includes('markdown') && text.includes('export');
      });
    });

    expect(hasMDExport).toBe(true);
  });

  it('should display export as HTML option', async () => {
    await browser.pause(500);

    const hasHTMLExport = await browser.execute(() => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      return btns.some(b => {
        const text = b.textContent.toLowerCase();
        return text.includes('html') && text.includes('export');
      });
    });

    expect(hasHTMLExport).toBe(true);
  });

  it('should navigate back to home', async () => {
    await navigateToNotes();
    const url = await browser.getUrl();
    expect(url).not.toContain('settings');
  });
});
