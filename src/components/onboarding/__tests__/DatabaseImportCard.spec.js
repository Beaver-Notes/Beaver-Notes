import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';

vi.mock('../databaseImport.js', () => ({
  pickDatabaseSource: vi.fn(),
}));
vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: ref({}) }),
}));

import { mount } from '@vue/test-utils';
import DatabaseImportCard from '../DatabaseImportCard.vue';
import { pickDatabaseSource } from '../databaseImport.js';

const fixturePayload = {
  source: 'notion',
  title: 'My Table',
  schema: { columns: [{ id: 'c1', type: 'title', name: 'Name' }] },
  rows: [{ id: 'r1', cells: { c1: 'Alice' } }],
  issues: [],
};

const mountCard = () =>
  mount(DatabaseImportCard, {
    global: {
      stubs: {
        'ui-card': { template: '<button type="button"><slot /></button>' },
        'v-remixicon': { template: '<i />' },
      },
    },
  });

describe('DatabaseImportCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders one button per source', () => {
    const wrapper = mountCard();
    expect(wrapper.find('[data-test="db-import-notion"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="db-import-obsidian"]').exists()).toBe(true);
  });

  it('emits import(payload) with the parsed fixture payload', async () => {
    pickDatabaseSource.mockResolvedValue(fixturePayload);
    const wrapper = mountCard();
    await wrapper.find('[data-test="db-import-notion"]').trigger('click');
    await flushPromises();
    expect(pickDatabaseSource).toHaveBeenCalledWith('notion');
    expect(wrapper.emitted('import')).toEqual([[fixturePayload]]);
  });

  it('does not emit when the source is cancelled (null payload)', async () => {
    pickDatabaseSource.mockResolvedValue(null);
    const wrapper = mountCard();
    await wrapper.find('[data-test="db-import-obsidian"]').trigger('click');
    await flushPromises();
    expect(pickDatabaseSource).toHaveBeenCalledWith('obsidian');
    expect(wrapper.emitted('import')).toBeUndefined();
  });

  it('shows a spinner and ignores re-entry while parsing', async () => {
    let resolveParse;
    pickDatabaseSource.mockReturnValue(
      new Promise((resolve) => {
        resolveParse = resolve;
      })
    );
    const wrapper = mountCard();
    await wrapper.find('[data-test="db-import-notion"]').trigger('click');
    await nextTick();
    expect(wrapper.find('[data-test="db-import-spinner"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-test="db-import-obsidian"]').attributes('disabled')
    ).toBeDefined();

    await wrapper.find('[data-test="db-import-obsidian"]').trigger('click');
    resolveParse(null);
    await flushPromises();
    // Second click was ignored while busy.
    expect(pickDatabaseSource).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="db-import-spinner"]').exists()).toBe(false);
  });

  it('surfaces parse errors instead of emitting', async () => {
    pickDatabaseSource.mockRejectedValue(new Error('bad csv'));
    const wrapper = mountCard();
    await wrapper.find('[data-test="db-import-notion"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('import')).toBeUndefined();
    expect(wrapper.find('[data-test="db-import-error"]').text()).toContain(
      'bad csv'
    );
  });
});
