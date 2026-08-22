import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'

const db = vi.hoisted(() => ({
  addColumn: vi.fn(() => ({ id: 'c-new', type: 'rich_text', name: 'Text' })),
  updateColumn: vi.fn(),
  removeColumn: vi.fn(),
  updateView: vi.fn(),
}))
vi.mock('@/store/database', () => ({ useDatabaseStore: () => db }))

import TableView from '../TableView.vue'

const schema = {
  id: 'db',
  title: 'T',
  icon: '',
  deletedColumnIds: {},
  lastViewId: null,
  columns: [
    { id: 't', name: 'Name', type: 'title' },
    { id: 'n', name: 'Pts', type: 'number' },
  ],
  views: [{
    id: 'v1', name: 'Table', type: 'table', icon: '',
    config: { visibleColumns: ['t', 'n'], sort: [], filters: { conjunction: 'and', list: [] }, groupByColumnId: null, wrapCells: false },
  }],
}
const rows = [
  { id: 'r1', cells: { t: [{ type: 'text', text: 'Alpha' }], n: 1 }, createdAt: 1, updatedAt: 1 },
  { id: 'r2', cells: { t: [{ type: 'text', text: 'Beta' }] }, createdAt: 2, updatedAt: 2 },
]

const mountOpts = {
  global: {
    plugins: [createPinia()],
    stubs: {
      'v-remixicon': { template: '<i />' },
      UiPopover: { template: '<div><slot name="trigger" /><slot /></div>' },
    },
  },
}
const mountView = (over = {}) =>
  mount(TableView, {
    ...mountOpts,
    props: { schema, rows, version: 0, view: schema.views[0], ...over },
  })

describe('TableView', () => {
  it('renders headers and row titles', () => {
    const w = mountView()
    expect(w.text()).toContain('Name')
    expect(w.text()).toContain('Pts')
    expect(w.text()).toContain('Alpha')
    expect(w.text()).toContain('Beta')
  })

  it('emits add-row', async () => {
    const w = mountView()
    await w.find('[data-test=add-row]').trigger('click')
    expect(w.emitted('add-row')).toBeTruthy()
  })

  it('emits cell-update payload on text edit', async () => {
    const w = mountView()
    await w.find('[data-test=cell-r1-t]').trigger('click')
    const input = w.findAll('input').find((i) => i.element.value === 'Alpha')
    await input.setValue('Gamma')
    await input.trigger('keydown.enter')
    expect(w.emitted('cell-update')[0][0]).toEqual({
      rowId: 'r1',
      columnId: 't',
      value: [{ type: 'text', text: 'Gamma' }],
    })
  })

  it('click edits a cell; esc exits without emitting', async () => {
    const w = mountView({ rows: rows.map((r) => ({ ...r, cells: { ...r.cells } })) })
    await w.find('[data-test=cell-r1-t]').trigger('click')
    expect(w.findAll('input').map((i) => i.element.value)).toContain('Alpha')
    const input = w.findAll('input').find((i) => i.element.value === 'Alpha')
    await input.setValue('Changed')
    await input.trigger('keydown.esc')
    expect(w.emitted('cell-update')).toBeUndefined()
    // back to display mode
    expect(w.findAll('input').map((i) => i.element.value)).not.toContain('Changed')
  })

  it('orders by columnOrder and drops hiddenColumns', () => {
    const view = { ...schema.views[0], config: { columnOrder: ['n', 't'], hiddenColumns: [] } }
    const w = mountView({ view })
    const headers = w.findAll('[data-test^=header-name-]').map((h) => h.text())
    expect(headers).toEqual(['Pts', 'Name'])
  })

  it('hidden columns are not rendered', () => {
    const view = { ...schema.views[0], config: { columnOrder: ['t', 'n'], hiddenColumns: ['n'] } }
    const w = mountView({ view })
    expect(w.text()).not.toContain('Pts')
  })

  it('header menu hides a column via updateView', async () => {
    const w = mountView()
    await w.find('[data-test=menu-hide-n]').trigger('click')
    expect(db.updateView).toHaveBeenCalledWith('db', 'v1', {
      config: { hiddenColumns: ['n'] },
    })
  })

  it('header menu deletes a column via removeColumn', async () => {
    const w = mountView()
    await w.find('[data-test=menu-delete-n]').trigger('click')
    expect(db.removeColumn).toHaveBeenCalledWith('db', 'n')
  })

  it('header menu renames inline via updateColumn', async () => {
    const w = mountView()
    await w.find('[data-test=menu-rename-t]').trigger('click')
    const input = w.find('[data-test=rename-input]')
    await input.setValue('Full name')
    await input.trigger('keydown.enter')
    expect(db.updateColumn).toHaveBeenCalledWith('db', 't', { name: 'Full name' })
  })

  it('+ adds a rich_text column', async () => {
    const w = mountView()
    await w.find('[data-test=add-column]').trigger('click')
    expect(db.addColumn).toHaveBeenCalledWith('db', { type: 'rich_text' })
  })

  it('dblclick emits open-row with the row id', async () => {
    const w = mountView()
    await w.find('[data-test=row-r1]').trigger('dblclick')
    expect(w.emitted('open-row')[0][0]).toBe('r1')
  })

  it('renders computed values for readonly columns', () => {
    const s = {
      ...schema,
      columns: [...schema.columns, { id: 'ct', name: 'Created', type: 'created_time' }],
    }
    s.views[0] = { ...schema.views[0], config: { visibleColumns: ['t', 'n', 'ct'] } }
    const w = mountView({ schema: s })
    expect(w.text()).toContain('1970')
  })
})
