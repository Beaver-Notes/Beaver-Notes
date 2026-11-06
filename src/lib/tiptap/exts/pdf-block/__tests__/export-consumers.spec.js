import { describe, expect, it } from 'vitest';
import { tiptapToHtml, sanitizeClone } from '@/utils/share/exportBulk.js';
import { tiptapToMarkdown } from '@/utils/markdown.js';
import { buildCardPreview } from '@/utils/note/cardPreview.js';
import { sanitizeNoteContent } from '@/utils/note/contentSecurity.js';
import { buildPdfBlockAttrs } from '../migrate.js';

const PDF_NODE = {
  type: 'pdfBlock',
  attrs: {
    src: 'assets://note-1/doc.pdf',
    fileName: 'report.pdf',
    markup: [],
  },
};

function docWith(nodes) {
  return { type: 'doc', content: nodes };
}

describe('pdfBlock export consumers', () => {
  it('exports as attachment link in tiptapToHtml', () => {
    const html = tiptapToHtml(docWith([PDF_NODE]));
    expect(html).toContain('<a href="assets/note-1/doc.pdf" download>');
    expect(html).toContain('report.pdf');
  });

  it('exports as attachment link in tiptapToMarkdown', () => {
    const md = tiptapToMarkdown(docWith([PDF_NODE]));
    expect(md).toContain('[report.pdf](assets/note-1/doc.pdf)');
  });

  it('shows PDF card preview with fileName label', () => {
    const preview = buildCardPreview(docWith([PDF_NODE]));
    const pdfBlock = preview.blocks.find(
      (b) => b.kind === 'media' && b.label === 'PDF Document'
    );
    expect(pdfBlock).toBeTruthy();
  });

  it('survives sanitizeNoteContent untouched', () => {
    const safe = sanitizeNoteContent(docWith([PDF_NODE]));
    expect(safe.content[0].type).toBe('pdfBlock');
    expect(safe.content[0].attrs.src).toBe('assets://note-1/doc.pdf');
  });
});

describe('fileEmbed → pdfBlock conversion', () => {
  it('maps embed attrs to pdfBlock attrs, dropping extras', () => {
    const attrs = buildPdfBlockAttrs({
      src: 'assets://note-1/doc.pdf?t=123',
      fileName: 'doc.pdf',
      size: 999,
    });
    expect(attrs).toEqual({
      src: 'assets://note-1/doc.pdf?t=123',
      fileName: 'doc.pdf',
      markup: [],
    });
  });
});

describe('sanitizeClone media snapshots', () => {
  function mountPaperClone(canvasW = 300, canvasH = 150) {
    const div = document.createElement('div');
    div.setAttribute('data-node-view-wrapper', '');
    div.className = 'paper-node';
    const surface = document.createElement('div');
    surface.className = 'paper-surface';
    const logic = document.createElement('canvas');
    logic.className = 'ink-canvas';
    logic.width = canvasW;
    logic.height = canvasH;
    const live = document.createElement('canvas');
    live.className = 'ink-canvas live';
    const hint = document.createElement('div');
    hint.className = 'surface-hint';
    surface.append(logic, live, hint);
    div.append(surface);
    return div;
  }

  it('replaces paper-node with committed canvas snapshot img', () => {
    const clone = document.createElement('div');
    clone.append(mountPaperClone());
    sanitizeClone(clone);
    const img = clone.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.src.startsWith('data:image/png')).toBe(true);
    expect(img.className).toBe('paper-node');
    expect(clone.querySelector('.surface-hint')).toBeNull();
  });

  it('keeps svg fallback for legacy paper markup', () => {
    const div = document.createElement('div');
    div.className = 'paper-node';
    div.innerHTML = '<svg viewBox="0 0 10 10"></svg>';
    const clone = document.createElement('div');
    clone.append(div);
    sanitizeClone(clone);
    expect(clone.querySelector('svg')).toBeTruthy();
  });

  it('exports pdf-block pages with rail ink composited', () => {
    const block = document.createElement('div');
    block.className = 'pdf-block';
    block.setAttribute('data-pdf-block', '');
    const railPages = document.createElement('div');
    railPages.className = 'pdf-rail-pages';
    const pageA = document.createElement('canvas');
    pageA.className = 'pdf-rail-page';
    pageA.width = 155;
    pageA.height = 200;
    const pageB = document.createElement('canvas');
    pageB.className = 'pdf-rail-page';
    pageB.width = 155;
    pageB.height = 200;
    railPages.append(pageA, pageB);
    const ink = document.createElement('canvas');
    ink.className = 'pdf-rail-surface';
    ink.width = 318;
    ink.height = 200;
    const frame = document.createElement('div');
    frame.className = 'pdf-frame';
    frame.append(railPages, ink);
    block.append(frame);

    const wrapper = document.createElement('div');
    wrapper.className = 'node-view-wrapper';
    wrapper.append(block);

    const clone = document.createElement('div');
    clone.append(wrapper);
    sanitizeClone(clone);
    const imgs = clone.querySelectorAll('img');
    expect(imgs.length).toBe(2);
    expect(imgs[0].src.startsWith('data:image/png')).toBe(true);
  });
});
