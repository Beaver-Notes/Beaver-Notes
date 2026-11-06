import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import fileEmbed from '../../file-block';
import pdfBlock from '../index';
import { migrateFileEmbedPdfs, PdfEmbedMigration } from '../migrate';

// pdf.js is never opened here; the migration path only manipulates nodes.
vi.mock('../pdfSource.js', () => ({
  openPdf: vi.fn(async () => ({
    numPages: 1,
    pageDims: Promise.resolve([{ width: 612, height: 792 }]),
    renderPage: vi.fn(),
  })),
}));

const editors = [];

function makeEditor(withMigration = true) {
  const editor = new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      fileEmbed,
      pdfBlock,
      ...(withMigration ? [PdfEmbedMigration] : []),
    ],
    enableCoreExtensions: { paste: false, textDirection: false },
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop().destroy();
});

function nodesIn(editor, name) {
  const found = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === name) found.push(node);
  });
  return found;
}

describe('migrateFileEmbedPdfs', () => {
  it('swaps pdf fileEmbeds for pdfBlocks keeping src and fileName', () => {
    const editor = makeEditor(false);
    const doc = editor.state.schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'fileEmbed',
          attrs: { src: 'assets://n1/spec.pdf', fileName: 'spec.pdf' },
        },
        {
          type: 'fileEmbed',
          attrs: { src: 'assets://n1/notes.txt', fileName: 'notes.txt' },
        },
      ],
    });

    const migrated = migrateFileEmbedPdfs(doc);
    const pdfs = nodesIn({ state: { doc: migrated } }, 'pdfBlock');
    const embeds = nodesIn({ state: { doc: migrated } }, 'fileEmbed');

    expect(pdfs).toHaveLength(1);
    expect(pdfs[0].attrs.src).toBe('assets://n1/spec.pdf');
    expect(pdfs[0].attrs.fileName).toBe('spec.pdf');
    expect(pdfs[0].attrs.markup).toEqual([]);
    expect(embeds).toHaveLength(1);
    expect(embeds[0].attrs.fileName).toBe('notes.txt');
  });

  it('detects inline data:application/pdf srcs without a pdf fileName', () => {
    const editor = makeEditor(false);
    const doc = editor.state.schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'fileEmbed',
          attrs: {
            src: 'data:application/pdf;base64,AAA=',
            fileName: 'download',
          },
        },
      ],
    });

    const migrated = migrateFileEmbedPdfs(doc);
    const pdfs = nodesIn({ state: { doc: migrated } }, 'pdfBlock');
    expect(pdfs).toHaveLength(1);
    expect(pdfs[0].attrs.src).toBe('data:application/pdf;base64,AAA=');
  });

  it('is a no-op on a doc without pdf fileEmbeds', () => {
    const editor = makeEditor(false);
    const doc = editor.state.schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'fileEmbed',
          attrs: { src: 'assets://n1/notes.txt', fileName: 'notes.txt' },
        },
      ],
    });
    expect(migrateFileEmbedPdfs(doc)).toBe(doc);
  });
});

describe('pdfBlock parse rules', () => {
  it('claims legacy fileEmbed spans that carry a pdf fileName', () => {
    const editor = makeEditor(false);
    editor.commands.setContent(
      `<span data-file-name="spec.pdf" data-src="assets://n1/spec.pdf"></span>` +
        `<span data-file-name="notes.txt" data-src="assets://n1/notes.txt"></span>`,
    );
    const pdfs = nodesIn(editor, 'pdfBlock');
    const embeds = nodesIn(editor, 'fileEmbed');
    expect(pdfs).toHaveLength(1);
    expect(pdfs[0].attrs.src).toBe('assets://n1/spec.pdf');
    expect(pdfs[0].attrs.fileName).toBe('spec.pdf');
    expect(embeds).toHaveLength(1);
    expect(embeds[0].attrs.fileName).toBe('notes.txt');
  });

  it('round-trips its own html back into a pdfBlock', () => {
    const editor = makeEditor(false);
    editor.commands.setContent(
      `<div data-type="pdf-block" data-src="assets://n1/spec.pdf" data-file-name="spec.pdf" data-markup="[]"></div>`,
    );
    const html = editor.getHTML();
    const second = makeEditor(false);
    second.commands.setContent(html);
    const pdfs = nodesIn(second, 'pdfBlock');
    expect(pdfs).toHaveLength(1);
    expect(pdfs[0].attrs.src).toBe('assets://n1/spec.pdf');
    expect(nodesIn(second, 'fileEmbed')).toHaveLength(0);
  });

  it('drops unsafe srcs on the floor instead of rendering them', () => {
    const editor = makeEditor(false);
    editor.commands.setContent(
      `<span data-file-name="evil.pdf" data-src="javascript:alert(1)"></span>`,
    );
    expect(nodesIn(editor, 'pdfBlock')).toHaveLength(0);
    expect(nodesIn(editor, 'fileEmbed')).toHaveLength(0);
  });
});

describe('PdfEmbedMigration plugin', () => {
  it('migrates pdf fileEmbeds on load via appendTransaction', () => {
    const editor = makeEditor(true);
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'fileEmbed',
          attrs: { src: 'assets://n1/spec.pdf', fileName: 'spec.pdf' },
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      ],
    });

    const pdfs = nodesIn(editor, 'pdfBlock');
    expect(pdfs).toHaveLength(1);
    expect(pdfs[0].attrs.src).toBe('assets://n1/spec.pdf');
    expect(nodesIn(editor, 'fileEmbed')).toHaveLength(0);
  });

  it('leaves plain text edits alone (no pdf fileEmbeds present)', () => {
    const editor = makeEditor(true);
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] });
    editor.commands.insertContent(' more');
    expect(editor.state.doc.textContent).toContain('more');
    expect(nodesIn(editor, 'pdfBlock')).toHaveLength(0);
  });
});
