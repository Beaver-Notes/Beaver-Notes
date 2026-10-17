import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import HistoryPanel from '@/components/note/HistoryPanel.vue';

vi.mock('@/composable/useNoteHistory', async () => {
  const { ref } = await import('vue');
  const commits = [
    {
      hash: 'h2',
      createdAt: '2026-01-02T10:00:00Z',
      wordCount: 110,
      snippet: 'second snippet',
      authorName: 'Ada',
    },
    {
      hash: 'h1',
      createdAt: '2026-01-01T10:00:00Z',
      wordCount: 90,
      snippet: 'first snippet',
      authorName: 'Ada',
    },
  ];
  const api = {
    commits: ref(commits),
    loading: ref(false),
    error: ref(null),
    selectedCommit: ref(null),
    selectedCommitIndex: ref(-1),
    timeFilter: ref('all'),
    filteredCommits: ref(commits),
    loadCommits: vi.fn(),
    loadSnapshot: vi.fn(async () => {
      api.selectedCommit.value = { content: '<p>preview body</p>' };
    }),
    selectCommit: vi.fn((i) => {
      api.selectedCommitIndex.value = i;
    }),
    setFilter: vi.fn(),
    clearSelection: vi.fn(() => {
      api.selectedCommitIndex.value = -1;
      api.selectedCommit.value = null;
    }),
  };
  return { useNoteHistory: () => api, __api: api };
});

vi.mock('@/composable/useActivityLog', async () => {
  const { ref } = await import('vue');
  const api = {
    entries: ref([]),
    loading: ref(false),
    error: ref(null),
    loadIfNeeded: vi.fn(),
    canUndo: vi.fn(() => false),
    undo: vi.fn(),
    clear: vi.fn(),
  };
  return { useActivityLog: () => api, __api: api };
});

vi.mock('@/composable/useTranslations', async () => {
  const { ref } = await import('vue');
  return {
    useTranslations: () => ({ translations: ref({ history: {} }) }),
  };
});

vi.mock('@/lib/dialog', () => ({
  useDialog: () => ({ confirm: vi.fn() }),
}));

import { __api as historyMock } from '@/composable/useNoteHistory';

function mountPanel() {
  return mount(HistoryPanel, {
    props: { noteId: 'n1' },
    stubs: { 'v-remixicon': true },
  });
}

beforeAll(() => {
  // happy-dom has no 2D canvas context; the timeline engine only needs calls to succeed.
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () =>
      new Proxy(
        {},
        {
          get: () => () => {},
        },
      ),
  );
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  historyMock.loadSnapshot.mockClear();
  historyMock.selectCommit.mockClear();
  historyMock.selectedCommit.value = null;
  historyMock.selectedCommitIndex.value = -1;
});

describe('history preview gating', () => {
  it('selecting a version only highlights it and does not emit preview', async () => {
    const wrapper = mountPanel();

    historyMock.selectCommit(0);
    await flushPromises();

    expect(wrapper.emitted('preview')).toBeUndefined();
    expect(historyMock.loadSnapshot).not.toHaveBeenCalled();
    // version number = total - index
    expect(wrapper.find('[data-testid="history-panel-title"]').text()).toBe('2');
    // testids stay available on the history tab
    expect(wrapper.find('[data-testid="history-timeline"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="history-activity-tab"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="history-entry"]').length).toBe(2);

    wrapper.unmount();
  });

  it('Show preview loads the snapshot, then emits preview and reveals restore actions', async () => {
    const wrapper = mountPanel();

    historyMock.selectCommit(0);
    await flushPromises();
    expect(wrapper.text()).toContain('Show preview');

    await wrapper.vm.startPreview();

    expect(historyMock.loadSnapshot).toHaveBeenCalledWith('h2', 'n1');
    const emitted = wrapper.emitted('preview');
    expect(emitted).toHaveLength(1);
    expect(emitted[0][0]).toMatchObject({
      hash: 'h2',
      content: '<p>preview body</p>',
    });
    expect(wrapper.text()).toContain('Restore');
    expect(wrapper.text()).toContain('Review changes');
    expect(wrapper.text()).not.toContain('Show preview');

    wrapper.unmount();
  });

  it('Hide preview emits null and returns to the Show preview action', async () => {
    const wrapper = mountPanel();

    historyMock.selectCommit(0);
    await flushPromises();
    await wrapper.vm.startPreview();
    expect(wrapper.emitted('preview')).toHaveLength(1);

    wrapper.vm.hidePreview();
    await flushPromises();

    const emitted = wrapper.emitted('preview');
    expect(emitted[emitted.length - 1]).toEqual([null]);
    expect(wrapper.text()).toContain('Show preview');
    expect(wrapper.text()).not.toContain('Restore');

    wrapper.unmount();
  });

  it('changing the selected version clears an active preview', async () => {
    const wrapper = mountPanel();

    historyMock.selectCommit(0);
    await flushPromises();
    await wrapper.vm.startPreview();
    expect(wrapper.emitted('preview')).toHaveLength(1);

    // scrub to another version: index watch must drop snapshot + preview
    historyMock.selectedCommitIndex.value = 1;
    await flushPromises();

    const emitted = wrapper.emitted('preview');
    expect(emitted[emitted.length - 1]).toEqual([null]);
    expect(historyMock.selectedCommit.value).toBeNull();
    expect(wrapper.text()).not.toContain('Restore');

    wrapper.unmount();
  });
});
