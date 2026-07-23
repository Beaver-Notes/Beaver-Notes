import { browser, expect } from '@wdio/globals';
import { navigateToNotes, createNote, getEditorHTML } from './helpers.js';

describe('Markdown Rendering', () => {
  before(async () => {
    await navigateToNotes();
    await createNote();
  });

  it('should render H1 from # shortcut', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) el.focus();
    });
    await browser.pause(200);
    await browser.execute(() => {
      document.execCommand('insertText', false, '# ');
    });
    await browser.pause(500);

    const html = await getEditorHTML();
    expect(html).toMatch(/<h[12]/i);
  });

  it('should render H2 from ## shortcut', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        el.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertParagraph', bubbles: true, cancelable: true
        }));
      }
    });
    await browser.pause(200);
    await browser.execute(() => {
      document.execCommand('insertText', false, '## ');
    });
    await browser.pause(500);

    const html = await getEditorHTML();
    expect(html).toMatch(/<h[23]/i);
  });

  it('should render bold from **text** markdown', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        el.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertParagraph', bubbles: true, cancelable: true
        }));
      }
    });
    await browser.pause(200);
    await browser.execute(() => {
      document.execCommand('insertText', false, '**boldword**');
    });
    await browser.pause(500);

    const html = await getEditorHTML();
    expect(html).toMatch(/<(strong|b)>.*boldword.*<\/(strong|b)>/i);
  });

  it('should render italic from *text* markdown', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        el.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertParagraph', bubbles: true, cancelable: true
        }));
      }
    });
    await browser.pause(200);
    await browser.execute(() => {
      document.execCommand('insertText', false, '*italicword*');
    });
    await browser.pause(500);

    const html = await getEditorHTML();
    expect(html).toMatch(/<(em|i)>.*italicword.*<\/(em|i)>/i);
  });

  it('should render code from backtick markdown', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        el.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertParagraph', bubbles: true, cancelable: true
        }));
      }
    });
    await browser.pause(200);
    await browser.execute(() => {
      document.execCommand('insertText', false, '`codeword`');
    });
    await browser.pause(500);

    const html = await getEditorHTML();
    expect(html).toMatch(/<code.*>.*codeword.*<\/code>/i);
  });

  it('should render blockquote from > shortcut', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        el.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertParagraph', bubbles: true, cancelable: true
        }));
      }
    });
    await browser.pause(200);
    await browser.execute(() => {
      document.execCommand('insertText', false, '> ');
    });
    await browser.pause(500);

    const html = await getEditorHTML();
    expect(html).toMatch(/<blockquote/i);
  });

  it('should render horizontal rule from --- markdown', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        el.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertParagraph', bubbles: true, cancelable: true
        }));
      }
    });
    await browser.pause(200);
    await browser.execute(() => {
      document.execCommand('insertText', false, '---');
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
    await browser.pause(500);

    const html = await getEditorHTML();
    expect(html).toMatch(/<hr/i);
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
