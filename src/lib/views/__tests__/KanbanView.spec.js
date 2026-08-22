import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'

import KanbanView from '../KanbanView.vue'

const schema = {
  id: 'db',
  title: 'T',
  icon: '',
  deletedColumnIds: {},
  lastViewId: null,
  columns: [
    { id: 't', name: 'Name', type: 'title' },
    {
      id: 's', name: 'Status', type: 'select',
      config: { options: [
        { id: 'o1', name: 'Todo', color: 'red' },
        { id: 'o2', name: 'Done', color: 'green' },
      ] },
    },
    { id: 'n', name: 'Pts', type: 'number' },
  ],
  views: [{
    id: 'v1', name: 'Board', type: 'kanban', icon: '',
    config: { filters: { conjunction: 'and', list: [] }, sorts: [], groupColumnId: 's', cardFields: ['n'] },
  }],
}

const rows = [
  { id: 'r1', cells: { t: [{ type: 'text', text: 'Alpha' }], s: 'o1', n: 1 }, createdAt: 1, updatedAt: 1 },
  { id: 'r2', cells: { t: [{ type: 'text', text: 'Beta' }], s: 'o1' }, createdAt: 2, updatedAt: 2 },
  { id: 'r3', cells: { t: [{ type: 'text', text: 'Gamma' }], s: 'o2' }, createdAt: 3, updatedAt: 3 },
]

const mountView = (over = {}) =>
  mount(KanbanView, {
    props: { schema, rows, version: 0, view: schema.views[0], ...over },
    global: {
      plugins: [createPinia()],
      stubs: { 'v-remixicon': { template: '<i />' } },
    },
  })

const dropOn = async (w, groupLabel, rowId) => {
  await w.find(`[data-test=group-${groupLabel}] [data-test=drop-zone]`).trigger('drop', {
    dataTransfer: { getData: () => rowId },
  })
}

describe('KanbanView', () => {
  it('renders one column per option with its cards', () => {
    const w = mountView()
    expect(w.findAll('[data-test^=group-]').map((g) => g.text())).toHaveLength(2)
    expect(w.find('[data-test=group-Todo]').text()).toContain('Alpha')
    expect(w.find('[data-test=group-Done]').text()).toContain('Gamma')
  })

  it('shows card property pills from cardFields', () => {
    const w = mountView()
    expect(w.find('[data-test=card-r1]').text()).toContain('1')
  })

  it('groups rows without a value under Empty', () => {
    const withEmpty = [...rows, { id: 'r4', cells: { t: [{ type: 'text', text: 'Delta' }] } }]
    const w = mountView({ rows: withEmpty })
    expect(w.find('[data-test=group-Empty]').exists()).toBe(true)
    expect(w.find('[data-test=group-Empty]').text()).toContain('Delta')
  })

  it('dropping a card on a group emits cell-update with the option id', async () => {
    const w = mountView()
    await dropOn(w, 'Todo', 'r3')
    expect(w.emitted('cell-update')[0][0]).toEqual({ rowId: 'r3', columnId: 's', value: 'o1' })
  })

  it('dropping on the Empty group clears the value', async () => {
    const withEmpty = [...rows, { id: 'r4', cells: {} }]
    const w = mountView({ rows: withEmpty })
    await dropOn(w, 'Empty', 'r3')
    expect(w.emitted('cell-update')[0][0]).toEqual({ rowId: 'r3', columnId: 's', value: null })
  })

  it('+ New in a group emits add-row-in-group pre-seeded with the group value', async () => {
    const w = mountView()
    await w.find('[data-test=new-Done]').trigger('click')
    expect(w.emitted('add-row-in-group')[0][0]).toEqual({ columnId: 's', value: 'o2' })
  })

  it('clicking a card emits open-row', async () => {
    const w = mountView()
    await w.find('[data-test=card-r1]').trigger('click')
    expect(w.emitted('open-row')[0][0]).toBe('r1')
  })
})
