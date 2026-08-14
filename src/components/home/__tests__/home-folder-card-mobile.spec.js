import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';

vi.mock('@/lib/tauri-bridge', () => ({ backend: { isMobileRuntime: () => true } }));
const folderStoreMock = {
  data: {},
  deletedIds: {},
  rootFolders: [],
  update: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  move: vi.fn(),
  delete: vi.fn(),
};
vi.mock('@/store/folder', () => ({
  useFolderStore: () => folderStoreMock,
}));
vi.mock('@/store/note', () => ({
  useNoteStore: () => ({ notesCountByFolder: new Map(), notes: [] }),
}));
vi.mock('@/lib/dialog', () => ({
  useDialog: () => ({ confirm: (opts) => opts.onConfirm?.() }),
}));
vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({
    translations: ref({
      card: {
        actions: 'Actions',
        archive: 'Archive',
        unarchive: 'Unarchive',
        moveToFolder: 'Move to folder',
        delete: 'Delete',
      },
    }),
  }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../FolderTree.vue', () => ({ default: { template: '<div />' } }));

import HomeFolderCard from '../HomeFolderCard.vue';

const folder = { id: 'f1', name: 'Work', color: '#6366f1', icon: '', isArchived: false, parentId: null };

describe('HomeFolderCard mobile', () => {
  it('exposes Delete inside the mobile customize modal', async () => {
    const wrapper = mount(HomeFolderCard, {
      props: { folder },
      global: {
        stubs: {
          'ui-modal': {
            template: '<div><slot name="header" /><slot /></div>',
          },
          'ui-popover': { template: '<div><slot name="trigger" /><slot /></div>' },
          'ui-emoji-picker': { template: '<div />' },
          'v-remixicon': { template: '<i />' },
        },
      },
    });
    wrapper.vm.showCustomizeModal = true;
    await wrapper.vm.$nextTick();
    const deleteBtn = wrapper.findAll('button').find((b) => b.text().toLowerCase().includes('delete'));
    expect(deleteBtn).toBeTruthy();

    await deleteBtn.trigger('click');
    expect(folderStoreMock.delete).toHaveBeenCalledWith('f1', { deleteContents: true });
  });
});
