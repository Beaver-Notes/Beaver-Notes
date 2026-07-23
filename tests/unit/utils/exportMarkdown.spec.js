import { describe, it, expect } from 'vitest';
import { tiptapToMarkdown } from '@/utils/markdown';

// Characterization test: captures CURRENT markdown output. Do not idealize.
describe('tiptapToMarkdown (characterization)', () => {
  const fixture = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'My Title' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello ' },
          {
            type: 'text',
            text: 'world',
            marks: [{ type: 'bold' }],
          },
          { type: 'text', text: ' with a ' },
          {
            type: 'text',
            text: 'link',
            marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
          },
          { type: 'text', text: '.' },
        ],
      },
      {
        type: 'codeBlock',
        attrs: { language: 'js' },
        content: [{ type: 'text', text: "const x = 1;" }],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'first' }],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'second' }],
              },
            ],
          },
        ],
      },
    ],
  };

  it('renders the representative fixture to the current markdown shape', () => {
    const out = tiptapToMarkdown(fixture, { noteId: 'note-1' });
    expect(out).toBe(
      `# My Title

Hello **world** with a [link](https://example.com)\\.

\`\`\`js
const x = 1;
\`\`\`

- first
- second`
    );
  });
});
