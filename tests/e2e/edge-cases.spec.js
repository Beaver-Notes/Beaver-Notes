import { browser, expect } from '@wdio/globals';
import { navigateToNotes, createNote, typeInEditor, getEditorText, getTitleText, waitForSaved, deleteCurrentNote } from './helpers.js';

describe('Edge Cases', () => {
  it('should handle empty note title', async () => {
    await navigateToNotes();
    await createNote();
    await waitForSaved();

    await navigateToNotes();
    await browser.waitUntil(async () => {
      const cards = await $$('[data-testid="note-card"]');
      return cards.length > 0;
    });

    const cards = await $$('[data-testid="note-card"]');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('should handle very long title (200 chars)', async () => {
    await navigateToNotes();
    await createNote();
    const longTitle = 'A'.repeat(200);

    await browser.execute(() => {
      const el = document.querySelector('[data-testid="note-title-input"]');
      if (el) el.focus();
    });
    await browser.pause(200);
    await browser.execute((text) => {
      document.execCommand('insertText', false, text);
    }, longTitle);
    await waitForSaved();

    const title = await getTitleText();
    expect(title.length).toBe(200);
  });

  it('should handle special characters in title', async () => {
    await navigateToNotes();
    await createNote();
    const specialTitle = 'Note <test> "quotes" & ampersand ñ é ü';

    await browser.execute(() => {
      const el = document.querySelector('[data-testid="note-title-input"]');
      if (el) el.focus();
    });
    await browser.pause(200);
    await browser.execute((text) => {
      document.execCommand('insertText', false, text);
    }, specialTitle);
    await waitForSaved();

    const title = await getTitleText();
    expect(title).toContain('ampersand');
    expect(title).toContain('ñ');
  });

  it('should handle unicode in title and body', async () => {
    await navigateToNotes();
    await createNote();
    const unicodeTitle = '日本語テスト 🎉 émojis';
    const unicodeBody = '中文内容 test العربية';

    await browser.execute(() => {
      const el = document.querySelector('[data-testid="note-title-input"]');
      if (el) el.focus();
    });
    await browser.pause(200);
    await browser.execute((text) => {
      document.execCommand('insertText', false, text);
    }, unicodeTitle);
    await browser.pause(300);

    await typeInEditor(unicodeBody);
    await waitForSaved();

    const title = await getTitleText();
    expect(title).toContain('🎉');

    const body = await getEditorText();
    expect(body).toContain('中文');
  });

  it('should handle rapid note creation', async () => {
    await navigateToNotes();

    for (let i = 0; i < 3; i++) {
      await createNote();
      await browser.execute((num) => {
        const el = document.querySelector('[data-testid="note-title-input"]');
        if (el) {
          el.focus();
          document.execCommand('insertText', false, `Rapid Note ${num}`);
        }
      }, i);
      await browser.pause(300);
      await navigateToNotes();
    }

    await browser.waitUntil(async () => {
      const cards = await $$('[data-testid="note-card"]');
      return cards.length >= 3;
    });

    const cards = await $$('[data-testid="note-card"]');
    expect(cards.length).toBeGreaterThanOrEqual(3);
  });

  it('should handle empty search gracefully', async () => {
    await navigateToNotes();
    await browser.pause(500);

    const cardsBefore = await $$('[data-testid="note-card"]');
    const countBefore = cardsBefore.length;

    const searchInput = await $('input[placeholder*="earch"]');
    if (await searchInput.isExisting()) {
      await searchInput.click();
      await searchInput.setValue('test');
      await browser.pause(1000);
      await searchInput.setValue('');
      await browser.pause(1000);

      const cardsAfter = await $$('[data-testid="note-card"]');
      expect(cardsAfter.length).toBe(countBefore);
    }
  });

  after(async () => {
    try {
      await navigateToNotes();
      const cards = await $$('[data-testid="note-card"]');
      for (let i = 0; i < Math.min(cards.length, 10); i++) {
        const card = (await $$('[data-testid="note-card"]'))[0];
        if (!card) break;
        const text = await card.getText();
        if (text.includes('Rapid Note') || text.includes('Note <test>') || text.includes('日本語')) {
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
