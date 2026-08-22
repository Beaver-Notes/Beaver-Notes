import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'

import DatabaseToolbar from '../DatabaseToolbar.vue'

const schema = {
  id: 'db1',
  title: 'Tasks',
  icon: 'riLayoutGridLine',
  columns: [],
  views: [
    { id: 'v1', name: 'Table', type: 'table', icon: 'riTableLine', config: { filters: { conjunction: 'and', list: [] }, sorts: [] } },
    { id: 'v2', name: 'Board', type: 'kanban', icon: 'riLayoutColumnLine', config: { filters: { conjunction: 'and', list: [{ columnId: 'c', operator: 'contains', value: 'x' }] }, sorts: [{ columnId: 'c', direction: 'asc' }] } },
  ],
}

const mountToolbar = (over = {}) =>
  mount(DatabaseToolbar, {
    props: { schema, view: schema.views[0], ...over },
    global: {
      plugins: [createPinia()],
      stubs: {
        'v-remixicon': { template: '<i />' },
        UiPopover: { template: '<div><slot name="trigger" /><slot /></div>' },
      },
    },
  })

describe('DatabaseToolbar', () => {
  it('renders schema title and view names', () => {
    const w = mountToolbar()
    expect(w.text()).toContain('Tasks')
    expect(w.text()).toContain('Table')
    expect(w.text()).toContain('Board')
  })

  it('clicking second tab emits switch-view with its id', async () => {
    const w = mountToolbar()
    await w.find('[data-test=tab-v2]').trigger('click')
    expect(w.emitted('switch-view')[0][0]).toBe('v2')
  })

  it('marks the active view tab', () => {
    const w = mountToolbar()
    expect(w.find('[data-test=tab-v1]').attributes('data-active')).toBe('true')
    expect(w.find('[data-test=tab-v2]').attributes('data-active')).toBe('false')
  })

  it('shows filter and sort count badges for the active view', () => {
    const w = mountToolbar({ view: schema.views[1] })
    expect(w.find('[data-test=filters-badge]').text()).toBe('1')
    expect(w.find('[data-test=sorts-badge]').text()).toBe('1')
  })

  it('emits add-view / toggle-filters / toggle-sorts', async () => {
    const w = mountToolbar()
    await w.find('[data-test=add-view]').trigger('click')
    await w.find('[data-test=filters-btn]').trigger('click')
    await w.find('[data-test=sorts-btn]').trigger('click')
    expect(w.emitted('add-view')).toBeTruthy()
    expect(w.emitted('toggle-filters')).toBeTruthy()
    expect(w.emitted('toggle-sorts')).toBeTruthy()
  })

  it('overflow menu emits rename-schema and delete-schema', async () => {
    const w = mountToolbar()
    await w.find('[data-test=db-menu-btn]').trigger('click')
    await w.find('[data-test=menu-rename-db]').trigger('click')
    await w.find('[data-test=menu-delete-db]').trigger('click')
    expect(w.emitted('rename-schema')).toBeTruthy()
    expect(w.emitted('delete-schema')).toBeTruthy()
  })
})
