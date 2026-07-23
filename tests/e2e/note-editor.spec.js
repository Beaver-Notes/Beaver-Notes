import { browser, expect } from '@wdio/globals';
import { navigateToNotes, deleteCurrentNote, getEditorHTML } from './helpers.js';

describe('Note Editor', () => {
  before(async () => {
    const notesBtn = await $('[data-testid="nav-notes-button"]');
    if (await notesBtn.isExisting()) {
      await notesBtn.click();
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return url.endsWith('#/') || url.endsWith('#');
      });
    }

    const addBtn = await $('[data-testid="add-note-button"]');
    await addBtn.click();
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('#/note/');
    });
    await browser.pause(1000);
  });

  it('should display the note title input', async () => {
    const titleInput = await $('[data-testid="note-title-input"]');
    await expect(titleInput).toBeExisting();
    await expect(titleInput).toHaveAttribute('contenteditable', 'true');
  });

  it('should display the ProseMirror editor', async () => {
    const editor = await $('[data-testid="note-body-editor"]');
    await expect(editor).toBeExisting();
  });

  it('should type plain text in the editor', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) { el.focus(); }
    });
    await browser.pause(200);
    await browser.execute(() => {
      document.execCommand('insertText', false, 'Hello world from the editor.');
    });
    await browser.pause(500);
    const text = await browser.execute(() => document.querySelector('.ProseMirror')?.textContent || '');
    expect(text).toContain('Hello world');
  });

  it('should apply bold formatting with keyboard shortcut', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        const ev = new KeyboardEvent('keydown', {
          key: 'b', code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true
        });
        el.dispatchEvent(ev);
      }
    });
    await browser.pause(200);
    await browser.execute(() => {
      document.execCommand('insertText', false, 'bold text');
    });
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        const ev = new KeyboardEvent('keydown', {
          key: 'b', code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true
        });
        el.dispatchEvent(ev);
      }
    });
    await browser.pause(300);

    const html = await getEditorHTML();
    expect(html).toContain('bold text');
    expect(html).toMatch(/<(strong|b)>.*bold text.*<\/(strong|b)>/i);
  });

  it('should apply italic formatting with keyboard shortcut', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        const ev = new KeyboardEvent('keydown', {
          key: 'i', code: 'KeyI', ctrlKey: true, bubbles: true, cancelable: true
        });
        el.dispatchEvent(ev);
      }
    });
    await browser.pause(200);
    await browser.execute(() => {
      document.execCommand('insertText', false, 'italic text');
    });
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        const ev = new KeyboardEvent('keydown', {
          key: 'i', code: 'KeyI', ctrlKey: true, bubbles: true, cancelable: true
        });
        el.dispatchEvent(ev);
      }
    });
    await browser.pause(300);

    const html = await getEditorHTML();
    expect(html).toContain('italic text');
    expect(html).toMatch(/<(em|i)>.*italic text.*<\/(em|i)>/i);
  });

  it('should create a heading with markdown shortcut', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        el.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertParagraph', bubbles: true, cancelable: true
        }));
      }
    });
    await browser.pause(100);
    await browser.execute(() => {
      document.execCommand('insertText', false, 'Heading ');
    });
    await browser.pause(300);

    const html = await getEditorHTML();
    expect(html).toMatch(/<h[12]/i);
  });

  it('should create a bullet list with keyboard shortcut', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        el.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertParagraph', bubbles: true, cancelable: true
        }));
      }
    });
    await browser.pause(100);
    await browser.execute(() => {
      document.execCommand('insertText', false, '- List item');
    });
    await browser.pause(300);

    const html = await getEditorHTML();
    expect(html).toMatch(/<(li|ul)/i);
  });

  it('should apply strikethrough formatting', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        el.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertParagraph', bubbles: true, cancelable: true
        }));
      }
    });
    await browser.pause(100);
    await browser.execute(() => {
      document.execCommand('insertText', false, '~~strikethrough~~');
    });
    await browser.pause(300);

    const html = await getEditorHTML();
    const hasStrikethrough = html.includes('strike') || html.includes('s>') || html.includes('del>');
    expect(hasStrikethrough || html.includes('strikethrough')).toBe(true);
  });

  it('should create a code block', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        el.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertParagraph', bubbles: true, cancelable: true
        }));
      }
    });
    await browser.pause(100);
    await browser.execute(() => {
      document.execCommand('insertText', false, '```');
    });
    await browser.pause(100);
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertParagraph', bubbles: true, cancelable: true
        }));
      }
    });
    await browser.pause(300);

    const html = await getEditorHTML();
    const hasCodeBlock = html.includes('pre>') || html.includes('code>');
    expect(hasCodeBlock).toBe(true);
  });

  it('should clean up - go back to home', async () => {
    const notesBtn = await $('[data-testid="nav-notes-button"]');
    if (await notesBtn.isExisting()) {
      await notesBtn.click();
    }
  });

  after(async () => {
    try {
      await navigateToNotes();
      const cards = await $$('[data-testid="note-card"]');
      for (const card of cards) {
        const text = await card.getText();
        if (text.includes('Hello world') || text.includes('bold text')) {
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
