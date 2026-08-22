import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const editorCss = readFileSync(path.resolve(root, 'src/assets/css/editor.css'), 'utf8');
const appVue = readFileSync(path.resolve(root, 'src/App.vue'), 'utf8');

describe('editor.css list spacing', () => {
  it('does not force a bottom margin on list items', () => {
    const liBlock = editorCss.match(/\.ProseMirror li\s*{[^}]*}/)?.[0] ?? '';
    expect(liBlock).not.toMatch(/margin-bottom:\s*0\.25em\s*!important/);
  });

  it('does not add extra item margins inside task lists (same rhythm as normal lists)', () => {
    const taskBlock = editorCss.match(/ul\[data-type='taskList'\]\s*{[^}]*li\s*{[^}]*}/s)?.[0] ?? '';
    expect(taskBlock).not.toMatch(/margin-(top|bottom):/);
  });

  it('resets paragraph margins inside task items with !important so rows stay compact', () => {
    const start = editorCss.indexOf("ul[data-type='taskList']");
    const end = editorCss.indexOf('.search-result', start);
    const section = editorCss.slice(start, end > start ? end : undefined);
    expect(section).toMatch(/p\s*\{\s*margin:\s*0\s*!important\s*;?\s*\}/);
  });
});

describe('editor scroll clearance for the fixed toolbar', () => {
  it('sizes the scroll padding on the app-main scroll container', () => {
    expect(appVue).toContain('mobile:scroll-pb-[calc(var(--app-keyboard-inset-bottom)+4.5rem)]');
  });

  it('does not place scroll-padding-bottom on .ProseMirror (it is not the scroll container)', () => {
    const blocks = editorCss.match(/\.ProseMirror\s*\{[^}]*\}/g) ?? [];
    for (const block of blocks) {
      expect(block).not.toContain('scroll-padding-bottom');
    }
  });
});
