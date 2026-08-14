import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';

const folderStoreMock = {
  data: {},
  deletedIds: {},
  rootFolders: [],
  validFolders: [],
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
        untitledFolder: 'Untitled folder',
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
  it('exposes Delete inside the folder customize modal', async () => {
    const wrapper = mount(HomeFolderCard, {
      props: { folder },
      global: {
        stubs: {
          'ui-modal': {
            template: '<div><slot name="header" /><slot name="actions" /><slot /></div>',
          },
          'ui-input': true,
          'ui-emoji-picker': { template: '<div />' },
          'ui-button': { template: '<button type="button"><slot /></button>' },
          'v-remixicon': { template: '<i />' },
        },
      },
    });

    await wrapper.find('[data-testid="customize-folder-button"]').trigger('click');
    const deleteBtn = wrapper.findAll('button').find((b) => b.text().toLowerCase().includes('delete'));
    expect(deleteBtn).toBeTruthy();

    await deleteBtn.trigger('click');
    expect(folderStoreMock.delete).toHaveBeenCalledWith('f1', { deleteContents: true });
  });
});
