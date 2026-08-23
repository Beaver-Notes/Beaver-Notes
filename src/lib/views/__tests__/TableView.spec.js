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

import TableView, { visibleWindow } from '../TableView.vue'

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

  it('unique_id column numbers rows 1..n', () => {
    const s = {
      ...schema,
      columns: [...schema.columns, { id: 'uid', name: '#', type: 'unique_id', config: {} }],
    }
    s.views[0] = { ...schema.views[0], config: { visibleColumns: ['t', 'n', 'uid'] } }
    const w = mountView({ schema: s, rows })
    expect(w.findAll('[data-test^=row-]').map((r) => r.find('[data-test$=-uid]').text())).toEqual(['1', '2'])
  })
})

describe('visibleWindow (virtualization math)', () => {
  it('returns all rows when content fits the viewport', () => {
    expect(visibleWindow(0, 1000, 10)).toEqual({ start: 0, end: 10 })
    expect(visibleWindow(120, 600, 5)).toEqual({ start: 0, end: 5 })
  })

  it('applies overscan 8 around the viewport at 40px rows', () => {
    expect(visibleWindow(800, 400, 500)).toEqual({ start: Math.floor(800 / 40) - 8, end: Math.ceil(1200 / 40) + 8 })
  })

  it('clamps to valid row bounds', () => {
    const w = visibleWindow(100000, 400, 50)
    expect(w.start).toBeGreaterThanOrEqual(0)
    expect(w.end).toBe(50)
    expect(visibleWindow(-50, 400, 3)).toEqual({ start: 0, end: 3 })
    expect(visibleWindow(0, 600, 0)).toEqual({ start: 0, end: 0 })
  })
})

describe('TableView virtualization', () => {
  const manyRows = Array.from({ length: 500 }, (_, i) => ({
    id: `r${i + 1}`,
    cells: { t: [{ type: 'text', text: `Row ${i + 1}` }] },
    createdAt: i,
    updatedAt: i,
  }))

  it('renders a bounded slice for large datasets with roles intact', () => {
    const w = mountView({ rows: manyRows })
    const rendered = w.findAll('[data-test^=row-]')
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThanOrEqual(40)
    expect(rendered.every((r) => r.attributes('role') === 'row')).toBe(true)
  })

  it('renders every row when the table fits the viewport', () => {
    const few = manyRows.slice(0, 5)
    const w = mountView({ rows: few })
    expect(w.findAll('[data-test^=row-]').length).toBe(5)
  })

  it('scroll events move the rendered slice', async () => {
    const w = mountView({ rows: manyRows })
    const scroller = w.find('[role="table"]')
    scroller.element.scrollTop = 800
    await scroller.trigger('scroll')
    const ids = new Set(w.findAll('[data-test^=row-]').map((r) => r.attributes('data-test')))
    // start = floor(800/40)-8 = 12 → first row r13; end = ceil((800+600)/40)+8 = 43
    expect(ids.has('row-r13')).toBe(true)
    expect(ids.has('row-r43')).toBe(true)
    expect(ids.has('row-r1')).toBe(false)
    expect(ids.has('row-r44')).toBe(false)
  })

  it('wrapCells view renders all rows unwindowed', () => {
    const view = { ...schema.views[0], config: { ...schema.views[0].config, wrapCells: true } }
    const w = mountView({ rows: manyRows.slice(0, 60), view })
    expect(w.findAll('[data-test^=row-]').length).toBe(60)
  })

  it('clears computed cache on version bump so unique_id stays correct after inserts', async () => {
    const s = {
      ...schema,
      columns: [...schema.columns, { id: 'uid', name: '#', type: 'unique_id', config: {} }],
    }
    s.views[0] = { ...schema.views[0], config: { visibleColumns: ['t', 'n', 'uid'] } }
    const w = mountView({ schema: s })
    expect(w.find('[data-test=row-r1] [data-test$=-uid]').text()).toBe('1')
    const inserted = [{ id: 'rN', cells: {}, createdAt: 9, updatedAt: 9 }, ...rows]
    await w.setProps({ rows: inserted, version: 1 })
    expect(w.find('[data-test=row-r1] [data-test$=-uid]').text()).toBe('2')
  })
})
