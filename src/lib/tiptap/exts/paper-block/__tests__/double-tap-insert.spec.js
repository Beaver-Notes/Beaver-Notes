import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Paper from '../index.js';
import {
  PaperInsert,
  takePendingHandoff,
} from '../double-tap-insert.js';

const editors = [];

afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
  vi.restoreAllMocks();
});

function makeEditor(html = '<p>abc</p>') {
  const editor = new Editor({
    content: html,
    extensions: [Document, Paragraph, Text, Paper, PaperInsert],
  });
  editors.push(editor);
  return editor;
}

function pointerEvent(type, { x, y, ts, pointerType = 'pen', button = 0, target = null, extra = {} }) {
  const e = new PointerEvent(type, {
    bubbles: true,
    isPrimary: true,
    clientX: x,
    clientY: y,
    button,
    ...extra,
  });
  Object.defineProperty(e, 'timeStamp', { value: ts });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  if (target) Object.defineProperty(e, 'target', { value: target });
  return e;
}

function countPapers(editor) {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'paper') n += 1;
  });
  return n;
}

describe('paperInsert plugin', () => {
  it('pen pointerdown on blank space inserts a paper block and hands off the stroke', () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 5, inside: -1 });

    editor.view.dom.dispatchEvent(pointerEvent('pointerdown', { x: 100, y: 400, ts: 10 }));
    editor.view.dom.dispatchEvent(pointerEvent('pointerdown', { x: 100, y: 400, ts: 10 }));

    expect(countPapers(editor)).toBe(1);
    const paper = editor.state.doc.content.content[1];
    expect(paper.attrs.height).toBe(210);
    expect(paper.attrs.paperType).toBe('transparent');
    expect(paper.attrs.strokes).toEqual([]);
    expect(takePendingHandoff()).toEqual({ x: 100, y: 400 });
    expect(takePendingHandoff()).toBeNull();
  });

  it('pen down over text does not insert', () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 2, inside: 1 });

    editor.view.dom.dispatchEvent(pointerEvent('pointerdown', { x: 100, y: 20, ts: 10 }));

    expect(countPapers(editor)).toBe(0);
    expect(takePendingHandoff()).toBeNull();
  });

  it('pen down on a media node view does not insert even when coords resolve to blank space', () => {
    // Production DOM: v3 Vue node views carry data-node-view-wrapper and the
    // renderHTML data-type never reaches the live element.
    const editor = makeEditor('<div data-type="paper"></div><p>x</p>');
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 5, inside: -1 });
    const mediaEl = editor.view.dom.querySelector('[data-type="paper"]');
    mediaEl.removeAttribute('data-type');
    mediaEl.setAttribute('data-node-view-wrapper', '');

    mediaEl.dispatchEvent(pointerEvent('pointerdown', { x: 100, y: 20, ts: 9001, target: mediaEl }));

    expect(countPapers(editor)).toBe(1); // fixture paper only — no new insert
    expect(takePendingHandoff()).toBeNull();
  });

  it.skipIf(!import.meta.env.DEV)('touch double-tap inserts a drawing block and selects it (dev only)', () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 5, inside: -1 });
    const dom = editor.view.dom;

    dom.dispatchEvent(pointerEvent('pointerdown', { x: 100, y: 400, ts: 100, pointerType: 'touch' }));
    dom.dispatchEvent(pointerEvent('pointerdown', { x: 102, y: 402, ts: 250, pointerType: 'touch' }));

    expect(countPapers(editor)).toBe(1);
    expect(editor.state.selection.node?.type.name).toBe('paper');
    expect(takePendingHandoff()).toBeNull();
  });

  it('single/spaced touch taps never insert', () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 5, inside: -1 });
    const dom = editor.view.dom;

    dom.dispatchEvent(pointerEvent('pointerdown', { x: 100, y: 400, ts: 100, pointerType: 'touch' }));
    dom.dispatchEvent(pointerEvent('pointerdown', { x: 102, y: 402, ts: 500, pointerType: 'touch' }));

    expect(countPapers(editor)).toBe(0);
  });

  it('stylus-eraser pen down does not insert', () => {
    const editor = makeEditor();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 5, inside: -1 });

    editor.view.dom.dispatchEvent(
      pointerEvent('pointerdown', { x: 100, y: 400, ts: 10, button: 5 })
    );

    expect(countPapers(editor)).toBe(0);
  });

  it('pen-touched surfaces kill the WebKit double-tap zoom sentinel', () => {
    const editor = makeEditor();
    const dom = editor.view.dom;

    dom.dispatchEvent(pointerEvent('pointerdown', { x: 10, y: 10, ts: 10 }));
    const zooming = new Event('touchstart', { bubbles: true, cancelable: true });
    dom.dispatchEvent(zooming);
    expect(zooming.defaultPrevented).toBe(true);

    dom.dispatchEvent(pointerEvent('pointerup', { x: 10, y: 10, ts: 20 }));
    const afterUp = new Event('touchstart', { bubbles: true, cancelable: true });
    dom.dispatchEvent(afterUp);
    expect(afterUp.defaultPrevented).toBe(false);
  });
});
