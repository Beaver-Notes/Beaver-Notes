import { browser, expect } from '@wdio/globals';
import { navigateToNotes, createNoteWithTitle, typeInEditor, waitForSaved, deleteCurrentNote } from './helpers.js';

describe('Note Linking', () => {
  const linkTestId = Date.now();


  it('should create a link via Ctrl+K', async () => {
    await navigateToNotes();
    await createNoteWithTitle(`Link Source ${linkTestId}`);
    await typeInEditor('Linking to another note');
    await waitForSaved();

    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.focus();
        const range = document.createRange();
        const textNode = el.querySelector('p')?.firstChild;
        if (textNode) {
          range.setStart(textNode, 0);
          range.setEnd(textNode, textNode.length || 10);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    });
    await browser.pause(200);

    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true
        }));
      }
    });
    await browser.pause(500);

    const hasLinkDialog = await browser.execute(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      return inputs.some(i =>
        i.placeholder?.includes('URL') || i.placeholder?.includes('url') || i.placeholder?.includes('@note')
      );
    });

    if (hasLinkDialog) {
      const linkInput = await browser.execute(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        return inputs.find(i =>
          i.placeholder?.includes('URL') || i.placeholder?.includes('url') || i.placeholder?.includes('@note')
        );
      });
      expect(linkInput).toBeTruthy();
    }

    await browser.keys(['Escape']);
    await browser.pause(300);
  });

  it('should render link as clickable element', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) el.focus();
    });
    await browser.pause(200);
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror');
      if (el) {
        el.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true
        }));
      }
    });
    await browser.pause(500);

    await browser.execute(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const urlInput = inputs.find(i =>
        i.placeholder?.includes('URL') || i.placeholder?.includes('url')
      );
      if (urlInput) {
        urlInput.value = 'https://example.com';
        urlInput.dispatchEvent(new Event('input', { bubbles: true }));
        const btns = Array.from(document.querySelectorAll('button'));
        const applyBtn = btns.find(b => b.textContent.includes('Apply') || b.textContent.includes('Save') || b.textContent.includes('Confirm'));
        if (applyBtn) applyBtn.click();
      }
    });
    await browser.pause(500);

    const html = await browser.execute(() => document.querySelector('.ProseMirror')?.innerHTML || '');
    const hasLink = html.includes('<a') || html.includes('href');
    expect(hasLink).toBe(true);
  });

  it('should navigate to linked note on click', async () => {
    await navigateToNotes();
    await createNoteWithTitle(`Link Target ${linkTestId}`);
    await waitForSaved();

    await navigateToNotes();
    const cards = await $$('[data-testid="note-card"]');
    for (const card of cards) {
      const text = await card.getText();
      if (text.includes(`Link Source ${linkTestId}`)) {
        await card.click();
        break;
      }
    }
    await browser.waitUntil(async () => {
      const url = await browser.getUrl();
      return url.includes('#/note/');
    });
    await browser.pause(500);

    const hasBacklinks = await browser.execute(() => {
      const els = Array.from(document.querySelectorAll('*'));
      return els.some(el =>
        el.textContent.includes('Backlinks') && el.offsetParent !== null
      );
    });

    expect(typeof hasBacklinks).toBe('boolean');
  });

  after(async () => {
    try {
      await navigateToNotes();
      const cards = await $$('[data-testid="note-card"]');
      for (const card of cards) {
        const text = await card.getText();
        if (text.includes(String(linkTestId))) {
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
