import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const editorCss = readFileSync(
  path.resolve(process.cwd(), 'src/assets/css/editor.css'),
  'utf8'
);

describe('editor.css scroll clearance for the fixed toolbar', () => {
  it('adds scroll-padding-bottom to a .ProseMirror block', () => {
    const blocks = editorCss.match(/\.ProseMirror\s*\{[^}]*\}/g);
    expect(blocks).toBeTruthy();
    const blockWithScrollPadding = blocks.find((block) =>
      block.includes('scroll-padding-bottom')
    );
    expect(blockWithScrollPadding).toBeTruthy();
  });

  it('sizes the scroll padding from the keyboard inset', () => {
    const blocks = editorCss.match(/\.ProseMirror\s*\{[^}]*\}/g);
    const blockWithScrollPadding = blocks.find((block) =>
      block.includes('scroll-padding-bottom')
    );
    expect(blockWithScrollPadding).toBeTruthy();
    expect(blockWithScrollPadding).toContain('var(--app-keyboard-inset-bottom)');
  });
});
