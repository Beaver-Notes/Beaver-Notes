import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';

const selectionBarMock = {
  hasSelection: true,
  hasSelectedNotes: false,
  hasSelectedFolders: true,
  selectedCount: 1,
  selectedNotes: [],
  shouldLock: true,
  shouldBookmark: true,
  shouldArchive: false,
  toggleLock: vi.fn(),
  toggleBookmark: vi.fn(),
  toggleArchive: vi.fn(),
  moveSelection: vi.fn(),
  deleteSelection: vi.fn(),
  clearSelection: vi.fn(),
};

vi.mock('@/composable/useSelectionBar', () => ({
  useSelectionBar: () => selectionBarMock,
}));
vi.mock('@/composable/useAppShellActions', () => ({
  useAppShellActions: () => ({
    translations: ref({
      card: {
        lock: 'Lock',
        unlock: 'Unlock',
        bookmark: 'Bookmark',
        removeBookmark: 'Unbookmark',
        archive: 'Archive',
        unarchive: 'Unarchive',
        moveToFolder: 'Move',
        delete: 'Delete',
      },
      index: { close: 'Close' },
      sidebar: { newFolder: 'New Folder', addNotes: 'New Note' },
    }),
    navItems: [],
    addNote: vi.fn(),
    addFolder: vi.fn(),
    openSettings: vi.fn(),
    openLastEdited: vi.fn(),
    handleNavigation: vi.fn(),
    createShortcutMap: () => ({}),
  }),
}));
vi.mock('vue-router', () => ({
  useRoute: () => ({ fullPath: '/', path: '/', query: {} }),
}));
vi.mock('@/lib/dialog', () => ({ useDialog: () => ({ confirm: vi.fn(), alert: vi.fn() }) }));
vi.mock('@/store/note', () => ({ useNoteStore: () => ({ delete: vi.fn() }) }));
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    isAuthenticated: false,
    serverUrl: '',
    profile: null,
  }),
}));
vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: () => ({
    workspaces: [],
    activeId: null,
  }),
}));
vi.mock('tiny-emitter/instance', () => ({ default: { on: vi.fn(), off: vi.fn() } }));
vi.mock('@/utils/ui/globalShortcuts.js', () => ({ bindGlobalShortcuts: vi.fn() }));

import AppNavbar from '../AppNavbar.vue';

describe('AppNavbar selection actions', () => {
  it('delegates delete to the selection bar so folders can be deleted too', async () => {
    const wrapper = mount(AppNavbar, {
      global: { stubs: ['v-remixicon', 'ui-button'] },
    });
    const deleteBtn = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Delete');
    expect(deleteBtn).toBeTruthy();
    await deleteBtn.trigger('click');
    expect(selectionBarMock.deleteSelection).toHaveBeenCalled();
  });

  it('keeps Lock/Bookmark rendered but disabled when only folders are selected', async () => {
    const wrapper = mount(AppNavbar, {
      global: { stubs: ['v-remixicon', 'ui-button'] },
    });
    const lockBtn = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Lock');
    const bookmarkBtn = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Bookmark');
    expect(lockBtn).toBeTruthy();
    expect(bookmarkBtn).toBeTruthy();
    expect(lockBtn.attributes('disabled')).toBeDefined();
    expect(bookmarkBtn.attributes('disabled')).toBeDefined();
  });
});
