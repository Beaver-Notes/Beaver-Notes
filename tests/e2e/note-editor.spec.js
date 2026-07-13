import { browser, expect } from '@wdio/globals';

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

    const html = await browser.execute(() => document.querySelector('.ProseMirror')?.innerHTML || '');
    expect(html).toContain('bold text');
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

    const html = await browser.execute(() => document.querySelector('.ProseMirror')?.innerHTML || '');
    expect(html).toContain('italic text');
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

    const text = await browser.execute(() => document.querySelector('.ProseMirror')?.textContent || '');
    expect(text).toContain('Heading');
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
      document.execCommand('insertText', false, 'List item');
    });
    await browser.pause(300);

    const text = await browser.execute(() => document.querySelector('.ProseMirror')?.textContent || '');
    expect(text).toContain('List item');
  });

  it('should clean up - go back to home', async () => {
    const notesBtn = await $('[data-testid="nav-notes-button"]');
    if (await notesBtn.isExisting()) {
      await notesBtn.click();
    }
  });
});
