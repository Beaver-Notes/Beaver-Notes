import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';

vi.mock('@/store/note', () => ({
  useNoteStore: () => ({
    lockNote: vi.fn(),
    unlockNote: vi.fn(),
    delete: vi.fn(),
  }),
}));
vi.mock('@/store/label', () => ({ useLabelStore: () => ({ getColor: () => null }) }));
vi.mock('@/lib/dialog', () => ({ useDialog: () => ({ alert: vi.fn(), confirm: vi.fn() }) }));
vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: ref({ card: { untitledNote: 'Untitled' } }) }),
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/composable/useGroupTooltip', () => ({ useGroupTooltip: () => {} }));
vi.mock('@/composable/useSounds', () => ({ useSounds: () => ({ play: vi.fn() }) }));
vi.mock('../FolderTree.vue', () => ({ default: { template: '<div class="folder-tree-stub" />' } }));

import HomeNoteCard from '../HomeNoteCard.vue';

const note = {
  id: 'n1',
  title: 'Hello',
  labels: [],
  isLocked: false,
  isArchived: false,
  isBookmarked: false,
  createdAt: new Date().toISOString(),
  cardPreview: { blocks: [], hasMore: false, mediaCount: 0, visibleMediaCount: 0 },
};

function mountCard() {
  return mount(HomeNoteCard, {
    props: { note },
    global: {
      directives: {
        tooltip: { mounted() {}, updated() {} },
      },
      stubs: {
        'ui-card': {
          template: '<div class="ui-card"><slot /></div>',
        },
        'v-remixicon': { template: '<i />' },
        'ui-modal': { template: '<div><slot /></div>' },
        'ui-button': { template: '<button type="button"><slot /></button>' },
        'ui-emoji-picker': { template: '<div />' },
        'ui-input': true,
      },
    },
  });
}

describe('HomeNoteCard move action', () => {
  it('emits move with the note when the Move button is clicked', async () => {
    const wrapper = mountCard();
    const moveBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label')?.toLowerCase().includes('move'));
    expect(moveBtn).toBeTruthy();
    await moveBtn.trigger('click');
    const emitted = wrapper.emitted('move');
    expect(emitted).toBeTruthy();
    expect(emitted[0][0]).toEqual(note);
  });

  it('does not render a FolderTree instance per card', () => {
    const wrapper = mountCard();
    expect(wrapper.find('.folder-tree-stub').exists()).toBe(false);
  });
});
