import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';

vi.mock('@/store/note', () => ({
  useNoteStore: () => ({
    lockNote: vi.fn(),
    unlockNote: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  }),
}));
vi.mock('@/store/label', () => ({ useLabelStore: () => ({ getColor: () => null }) }));
vi.mock('@/lib/dialog', () => ({ useDialog: () => ({ alert: vi.fn(), confirm: vi.fn() }) }));
vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: { card: { untitledNote: 'Untitled' } } }),
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/composable/useGroupTooltip', () => ({ useGroupTooltip: () => {} }));
vi.mock('@/composable/useSounds', () => ({ useSounds: () => ({ play: vi.fn() }) }));
vi.mock('../FolderTree.vue', () => ({ default: { template: '<div />' } }));

import HomeNoteMasonry from '../HomeNoteMasonry.vue';

const makeNotes = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    title: `Note ${i}`,
    labels: [],
    isLocked: false,
    isArchived: false,
    isBookmarked: false,
    cardPreview: { blocks: [], hasMore: false, mediaCount: 0, visibleMediaCount: 0 },
  }));

function mountMasonry(notes, props = {}) {
  return mount(HomeNoteMasonry, {
    props: { notes, ...props },
    global: {
      stubs: {
        'home-note-card': {
          props: ['note', 'isLocked', 'disableOpen'],
          template: '<div class="stub-card" data-testid="note-card">{{ note.title }}</div>',
        },
      },
    },
  });
}

let mockScrollY = 0;

beforeEach(() => {
  mockScrollY = 0;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return 800;
    },
  });
  // The masonry reads window.scrollY (its scroll parent is `window` in the
  // detached test mount) and computes containerOffset from a scroll-aware
  // getBoundingClientRect (cr.top + scrollY). happy-dom's rects are NOT
  // scroll-aware and its scrollTop is not wired to window.scrollY, so both
  // must be stubbed for the offset math to work.
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    get: () => mockScrollY,
    set: (v) => {
      mockScrollY = v;
    },
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function () {
      const top = -mockScrollY;
      return {
        top,
        left: 0,
        right: 800,
        bottom: 800 + top,
        width: 800,
        height: 800,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    }
  );
});

afterEach(() => {
  delete globalThis.ResizeObserver;
  delete HTMLElement.prototype.clientWidth;
  delete window.scrollY;
  vi.restoreAllMocks();
});

describe('HomeNoteMasonry', () => {
  it('renders only a window of cards and updates it on scroll', async () => {
    const wrapper = mountMasonry(makeNotes(1000));
    await flushPromises();
    await nextTick();

    const rendered = wrapper.findAll('.note-masonry__card');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(80);
    expect(wrapper.find('[data-item-id="note-n900"]').exists()).toBe(false);

    // Scroll 6000px down. The masonry listens on `window` (its scroll parent in
    // this detached mount), so dispatch there, then flush the rAF-deferred
    // onScroll handler. With lanes... (round-robin: item i sits at
    // y = floor(i / cols) * 274, cols = 2), the visible window spans roughly
    // indices 28..53, so note-n40 appears and the window stays bounded.
    mockScrollY = 6000;
    window.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await nextTick();

    expect(wrapper.findAll('.note-masonry__card').length).toBeLessThan(80);
    expect(wrapper.find('[data-item-id="note-n40"]').exists()).toBe(true);
  });

  it('emits item-click with the note id', async () => {
    const wrapper = mountMasonry(makeNotes(20));
    await flushPromises();
    await nextTick();

    const card = wrapper.find('[data-item-id="note-n0"]');
    expect(card.exists()).toBe(true);
    await card.trigger('click');

    const emitted = wrapper.emitted('item-click');
    expect(emitted).toBeTruthy();
    expect(emitted[0][0].noteId).toBe('n0');
  });

  it('forwards the card move event', async () => {
    const wrapper = mountMasonry(makeNotes(20));
    await flushPromises();
    await nextTick();

    const card = wrapper.find('[data-item-id="note-n1"]');
    await card.find('.stub-card').trigger('move', { id: 'n1' });
    const emitted = wrapper.emitted('move');
    expect(emitted).toBeTruthy();
    expect(emitted[0][0].id).toBe('n1');
  });

  it('rebinds the window when notes change', async () => {
    const wrapper = mountMasonry(makeNotes(50));
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-item-id="note-n0"]').exists()).toBe(true);

    await wrapper.setProps({
      notes: makeNotes(50).map((n, i) => ({ ...n, id: `m${i}`, title: `Note ${i}` })),
    });
    await nextTick();

    expect(wrapper.find('[data-item-id="note-m0"]').exists()).toBe(true);
  });
});
