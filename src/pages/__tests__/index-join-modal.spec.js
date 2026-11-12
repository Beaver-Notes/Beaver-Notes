import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive, ref, computed } from 'vue';

const joinViaInviteLink = vi.fn();
vi.mock('@/lib/api/collaboration', () => ({
  joinViaInviteLink: (...args) => joinViaInviteLink(...args),
}));

const haptic = vi.fn();
vi.mock('@/lib/native/haptics', () => ({
  triggerInteractionHaptic: (...args) => haptic(...args),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ serverUrl: 'https://api.test', isAuthenticated: false }),
}));

const query = reactive({ join: 'tok-1' });
const push = vi.fn();
const replace = vi.fn();
vi.mock(import('vue-router'), async (importOriginal) => ({
  ...(await importOriginal()),
  useRoute: () => ({ query, path: '/', fullPath: '/?join=tok-1' }),
  useRouter: () => ({ push, replace }),
}));

vi.mock('@/composable/useTranslations', async () => {
  const { ref } = await import('vue');
  return {
    useTranslations: () => ({
      translations: ref({ sidebar: {}, index: {}, card: {} }),
    }),
  };
});

vi.mock('@/store/note', () => ({
  useNoteStore: () => ({ notes: [], data: {}, getById: vi.fn(), update: vi.fn() }),
}));
vi.mock('@/store/folder', () => ({
  useFolderStore: () => ({ rootFolders: [], data: {}, getById: () => null }),
}));

const pageController = {
  selectedItems: ref(new Set()),
  isSelecting: ref(false),
  selectionBoxStyle: {},
  selectionMode: ref(false),
  isSorting: ref(false),
  isFiltering: ref(false),
  dragOverFolderId: ref(null),
  showMoveModal: ref(false),
  moveTarget: ref(null),
  moveMode: ref('move'),
  selectedNotes: computed(() => []),
  selectedFolders: computed(() => []),
  handleMouseDown: vi.fn(),
  handleGridClick: vi.fn(),
  handleItemClick: vi.fn(),
  getAllVisibleItems: () => [],
  handleItemTouchStart: vi.fn(),
  handleItemTouchMove: vi.fn(),
  handleItemTouchEnd: vi.fn(),
  handleItemTouchCancel: vi.fn(),
  handleNoteDragStart: vi.fn(),
  handleFolderDragStart: vi.fn(),
  handleDragEnd: vi.fn(),
  handleDragOver: vi.fn(),
  handleDragLeave: vi.fn(),
  handleDrop: vi.fn(),
  handleMoved: vi.fn(),
  bulkDelete: vi.fn(),
  bulkMove: vi.fn(),
  clearSelection: vi.fn(),
};
vi.mock('@/composable/useNotesBrowser', () => ({
  useNotesBrowser: () => pageController,
}));

vi.mock('@/composable/useNoteMove', () => ({
  useNoteMove: () => ({ openMoveForNote: vi.fn() }),
}));

const syncSelection = vi.fn();
vi.mock('@/composable/useSelectionBar', () => ({
  useSelectionBar: () => ({ syncSelection }),
}));

vi.mock('@/lib/dialog', () => ({ useDialog: () => ({}) }));
vi.mock('@/lib/tauri/runtime', () => ({ isMobileRuntime: () => false }));

import Index from '../Index.vue';

function mountIndex() {
  return mount(Index, {
    global: {
      mocks: { $route: { query } },
      stubs: {
        // Everything except the join dialog: this spec only exercises the
        // `?join=` wiring, not the note grid or its sub-views.
        HomeSearch: true,
        HomeNoteMasonry: true,
        HomeFolderCard: true,
        FolderTree: true,
        FolderCustomizeModal: true,
        Actions: true,
        EmptyState: true,
        MobileSyncStrip: true,
        WorkspaceSwitcher: true,
        'ui-modal': {
          props: ['modelValue'],
          emits: ['close'],
          template:
            '<div v-if="modelValue"><slot name="header" /><slot /><slot name="actions" /></div>',
        },
        'ui-button': {
          props: ['loading', 'disabled'],
          emits: ['click'],
          template:
            '<button type="button" :disabled="loading || disabled" @click="$emit(\'click\')"><slot /></button>',
        },
        'v-remixicon': true,
      },
    },
  });
}

describe('Index ?join= modal wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.join = 'tok-1';
  });

  it('opens the join invite dialog when the route query carries a token', () => {
    const wrapper = mountIndex();

    expect(wrapper.text()).toContain('Sign in to accept');
    expect(wrapper.text()).toContain('invited to collaborate');
  });

  it('does not open the dialog without a join token', () => {
    query.join = undefined;
    const wrapper = mountIndex();

    expect(wrapper.text()).not.toContain('Sign in to accept');
    expect(wrapper.text()).not.toContain('invited to collaborate');
  });

  it('strips the ?join= query via router.replace when the dialog closes', async () => {
    const wrapper = mountIndex();

    wrapper
      .findComponent({ name: 'JoinInviteDialog' })
      .vm.$emit('close');
    await wrapper.vm.$nextTick();

    expect(replace).toHaveBeenCalledTimes(1);
    const payload = replace.mock.calls[0][0];
    expect(payload.query).toEqual({});
  });
});
