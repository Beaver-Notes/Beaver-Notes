import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/composable/useNoteMenu', () => ({
  useNoteMenu: () => ({
    store: { inReaderMode: false },
    translations: { menu: { share: '', readerMode: '' } },
    shareActions: [],
    toggleReaderMode: vi.fn(),
    deleteNode: vi.fn(),
    lockNote: vi.fn(),
    toggleBookmark: vi.fn(),
    toggleArchive: vi.fn(),
    toggleFullWidth: vi.fn(),
    copyNoteContent: vi.fn(),
  }),
}));
vi.mock('@/store/note', () => ({ useNoteStore: () => ({}) }));
vi.mock('@/store/account', () => ({ useAccountStore: () => ({ isAuthenticated: false }) }));
vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: {} }),
}));
vi.mock('@/composable/useClipboard', () => ({
  useClipboard: () => ({ copyState: 0, copyToClipboard: vi.fn() }),
}));
vi.mock('@/lib/dialog', () => ({ useDialog: () => ({ prompt: vi.fn(), alert: vi.fn() }) }));

import NoteActions from '../NoteActions.vue';

const baseProps = {
  editor: { chain: () => ({ focus: () => ({ undo: () => ({ run: vi.fn() }), redo: () => ({ run: vi.fn() }) }) }), getText: () => '' },
  id: 'n1',
  note: { id: 'n1', isBookmarked: false, isArchived: false, isFullWidth: false },
  goBack: vi.fn(),
};

describe('NoteActions padding', () => {
  it('mobile shell stays full-bleed (no extra inset)', async () => {
    document.documentElement.classList.add('runtime-mobile');
    const wrapper = mount(NoteActions, {
      props: baseProps,
      global: {
        stubs: ['ui-popover', 'ui-list', 'ui-list-item', 'ui-switch', 'ui-modal', 'presence-avatars', 'share-modal', 'history-panel', 'v-remixicon'],
      },
    });
    const shell = wrapper.find('.editor-actions-mobile-shell');
    expect(shell.classes()).not.toContain('px-2');
    document.documentElement.classList.remove('runtime-mobile');
  });

  it('desktop bar keeps its original p-1 inner padding', () => {
    const wrapper = mount(NoteActions, {
      props: baseProps,
      global: {
        stubs: ['ui-popover', 'ui-list', 'ui-list-item', 'ui-switch', 'ui-modal', 'presence-avatars', 'share-modal', 'history-panel', 'v-remixicon'],
      },
    });
    const bar = wrapper.find('.w-fit');
    expect(bar.classes()).toContain('p-1');
    expect(bar.classes()).not.toContain('p-1.5');
  });
});
