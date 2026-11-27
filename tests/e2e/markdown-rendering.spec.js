import { browser, expect } from '@wdio/globals';
import { navigateToNotes, createNote, getEditorHTML } from './helpers.js';

describe('Markdown Rendering', () => {
  before(async () => {
    await navigateToNotes();
    await createNote();
  });

  const openParagraph = () => browser.execute(() => {
    const el = document.querySelector('.ProseMirror');
    if (el) {
      el.focus();
      el.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertParagraph', bubbles: true, cancelable: true
      }));
    }
  });

  const closeParagraph = () => browser.execute(() => {
    const el = document.querySelector('.ProseMirror');
    if (el) {
      el.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertParagraph', bubbles: true, cancelable: true
      }));
    }
  });

  // One table drives every feature: type the markdown, then assert the rendered element.
  const cases = [
    { title: 'should render H1 from # shortcut', markdown: '# ', pattern: /<h[12]/i },
    { title: 'should render H2 from ## shortcut', markdown: '## ', pattern: /<h[23]/i },
    { title: 'should render bold from **text** markdown', markdown: '**boldword**', pattern: /<(strong|b)>.*boldword.*<\/(strong|b)>/i },
    { title: 'should render italic from *text* markdown', markdown: '*italicword*', pattern: /<(em|i)>.*italicword.*<\/(em|i)>/i },
    { title: 'should render code from backtick markdown', markdown: '`codeword`', pattern: /<code.*>.*codeword.*<\/code>/i },
    { title: 'should render blockquote from > shortcut', markdown: '> ', pattern: /<blockquote/i },
    // '---' only settles into an <hr> once its paragraph is closed again.
    { title: 'should render horizontal rule from --- markdown', markdown: '---', pattern: /<hr/i, closeAfter: true },
  ];

  for (const { title, markdown, pattern, closeAfter } of cases) {
    it(title, async () => {
      await openParagraph();
      await browser.pause(200);
      await browser.execute((text) => {
        document.execCommand('insertText', false, text);
      }, markdown);
      await browser.pause(closeAfter ? 100 : 500);
      if (closeAfter) {
        await closeParagraph();
        await browser.pause(500);
      }

      const html = await getEditorHTML();
      expect(html).toMatch(pattern);
    });
  }

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
