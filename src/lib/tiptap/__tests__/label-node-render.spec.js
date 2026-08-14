import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/store/label', () => ({
  useLabelStore: () => ({
    data: ['work'],
    colors: { work: '#ffba00' },
    getColor: (name) => ({ work: '#ffba00' })[name] ?? null,
    add: vi.fn(),
  }),
}));

import createEditor from '../index.js';

function makeEditor() {
  return createEditor({
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hello ' },
            { type: 'noteLabel', attrs: { id: 'work' } },
          ],
        },
      ],
    },
  });
}

describe('noteLabel editor rendering', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('renders the label chip through the registered node view with its color', () => {
    const editor = makeEditor();
    const chip = editor.view.dom.querySelector('.note-label-chip');
    expect(chip).toBeTruthy();
    expect(chip.getAttribute('style')).toContain('#ffba00');
    expect(chip.textContent).toBe('#work');
    editor.destroy();
  });
});
