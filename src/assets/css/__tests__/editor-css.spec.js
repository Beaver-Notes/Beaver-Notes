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
