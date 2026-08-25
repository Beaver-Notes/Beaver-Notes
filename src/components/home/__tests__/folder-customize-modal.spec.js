import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/store/folder', () => ({
  useFolderStore: () => ({
    add: vi.fn().mockResolvedValue({ id: 'new' }),
    update: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    move: vi.fn(),
    delete: vi.fn(),
  }),
}));
vi.mock('@/lib/dialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('@/composable/useTranslations', () => ({ useTranslations: () => ({ translations: {} }) }));

import FolderCustomizeModal from '../FolderCustomizeModal.vue';

function mountModal(props) {
  return mount(FolderCustomizeModal, {
    props,
    global: {
      stubs: {
        'ui-modal': {
          template: '<div><slot name="header" /><slot name="actions" /><slot /></div>',
        },
        'ui-input': true,
        'ui-emoji-picker': true,
        'ui-button': { template: '<button type="button"><slot /></button>' },
        'v-remixicon': true,
        'folder-tree': true,
      },
    },
  });
}

describe('FolderCustomizeModal', () => {
  // Delete lives in the card's ... menu / selection rail since 8d230b11 —
  // this modal is customize-only (name, color, emoji).
  it('shows Done in edit mode and never a Delete action', () => {
    const wrapper = mountModal({ modelValue: true, folder: { id: 'f1', name: 'Work' } });
    const texts = wrapper.findAll('button').map((b) => b.text().toLowerCase());
    expect(texts.some((t) => t.includes('delete'))).toBe(false);
    expect(texts.some((t) => t.includes('done'))).toBe(true);
    expect(texts.some((t) => t.includes('cancel'))).toBe(true);
  });

  it('hides Delete and shows Create in create mode', () => {
    const wrapper = mountModal({ modelValue: true, folder: null });
    expect(wrapper.findAll('button').some((b) => b.text().toLowerCase().includes('delete'))).toBe(false);
    expect(wrapper.findAll('button').some((b) => b.text().toLowerCase().includes('create'))).toBe(true);
  });
});
