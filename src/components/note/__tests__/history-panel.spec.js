import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
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
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('selecting the current version shows the hint and does not preview', async () => {
    const wrapper = mountPanel();

    historyMock.selectCommit(0);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(160);
    await flushPromises();

    expect(historyMock.loadSnapshot).not.toHaveBeenCalled();
    expect(wrapper.emitted('preview')).toBeUndefined();
    // hint copy + testids stay available on the history tab
    expect(wrapper.text()).toContain('current version');
    expect(wrapper.find('[data-testid="history-timeline"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="history-activity-tab"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="history-entry"]').length).toBe(2);

    wrapper.unmount();
  });

  it('selecting an older version auto-loads the snapshot and previews it', async () => {
    const wrapper = mountPanel();

    historyMock.selectCommit(1);
    await flushPromises();
    // debounced while scrubbing
    expect(historyMock.loadSnapshot).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(160);
    await flushPromises();

    expect(historyMock.loadSnapshot).toHaveBeenCalledWith('h1', 'n1');
    const emitted = wrapper.emitted('preview');
    expect(emitted).toHaveLength(1);
    expect(emitted[0][0]).toMatchObject({
      hash: 'h1',
      content: '<p>preview body</p>',
    });
    expect(wrapper.text()).toContain('Restore this version');
    expect(wrapper.text()).toContain('Back to current');
    expect(wrapper.text()).not.toContain('Review changes');

    wrapper.unmount();
  });

  it('Back to current emits null', async () => {
    const wrapper = mountPanel();

    historyMock.selectCommit(1);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(160);
    await flushPromises();
    expect(wrapper.emitted('preview')).toHaveLength(1);

    wrapper.vm.hidePreview();
    await flushPromises();

    const emitted = wrapper.emitted('preview');
    expect(emitted[emitted.length - 1]).toEqual([null]);

    wrapper.unmount();
  });

  it('scrubbing back to the current version clears an active preview', async () => {
    const wrapper = mountPanel();

    historyMock.selectCommit(1);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(160);
    await flushPromises();
    expect(wrapper.emitted('preview')).toHaveLength(1);

    // scrub to current: index watch must drop snapshot + preview
    historyMock.selectedCommitIndex.value = 0;
    await flushPromises();

    const emitted = wrapper.emitted('preview');
    expect(emitted[emitted.length - 1]).toEqual([null]);
    expect(historyMock.selectedCommit.value).toBeNull();
    // back on the current version: the restore action collapses away (the
    // .acts 'on' state is gone; the panel re-enters hint mode)
    expect(wrapper.find('.acts').classes()).not.toContain('on');
    expect(wrapper.text()).toContain('Pick an earlier one on the timeline');

    wrapper.unmount();
  });
});
