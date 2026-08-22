import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'

import TimelineView from '../TimelineView.vue'

const schema = {
  id: 'db',
  title: 'T',
  icon: '',
  deletedColumnIds: {},
  lastViewId: null,
  columns: [
    { id: 't', name: 'Name', type: 'title' },
    { id: 'd', name: 'Start', type: 'date' },
    { id: 'e', name: 'End', type: 'date' },
    {
      id: 's',
      name: 'Status',
      type: 'select',
      config: {
        options: [
          { id: 'o1', name: 'Todo', color: 'blue' },
          { id: 'o2', name: 'Done', color: 'green' },
        ],
      },
    },
  ],
  views: [{
    id: 'v1', name: 'Timeline', type: 'timeline', icon: '',
    config: {
      filters: { conjunction: 'and', list: [] }, sorts: [],
      startColumnId: 'd', endColumnId: 'e', groupColumnId: 's',
    },
  }],
}

const rows = [
  {
    id: 'r1',
    cells: {
      t: [{ type: 'text', text: 'Alpha' }],
      d: { start: '2026-08-28' },
      e: { start: '2026-09-02' },
      s: 'o1',
    },
  },
  {
    id: 'r2',
    cells: {
      t: [{ type: 'text', text: 'Beta' }],
      d: { start: '2026-08-30' },
      e: { start: '2026-09-04' },
      s: 'o2',
    },
  },
]

const mountView = (over = {}) =>
  mount(TimelineView, {
    props: { schema, rows, version: 0, view: schema.views[0], ...over },
    global: {
      plugins: [createPinia()],
      stubs: { 'v-remixicon': { template: '<i />' } },
    },
  })

describe('TimelineView', () => {
  it('renders absolutely-positioned bars with pct left/width', () => {
    const w = mountView()
    const style = w.find('[data-test=bar-r1]').attributes('style')
    expect(style).toMatch(/left:\s*[\d.]+%/)
    expect(style).toMatch(/width:\s*[\d.]+%/)
  })

  it('tooltips show the row title plus its date range', () => {
    const w = mountView()
    const tip = w.find('[data-test=bar-r1]').attributes('title')
    expect(tip).toContain('Alpha')
    expect(tip).toMatch(/2026/)
  })

  it('clicking a bar emits open-row with its id', async () => {
    const w = mountView()
    await w.find('[data-test=bar-r2]').trigger('click')
    expect(w.emitted('open-row')[0][0]).toBe('r2')
  })

  it('groups bars under swimlane headers', () => {
    const w = mountView()
    expect(w.find('[data-test=swimlane-Todo]').text()).toContain('Todo')
    expect(w.find('[data-test=swimlane-Todo]').find('[data-test=bar-r1]').exists()).toBe(true)
    expect(w.find('[data-test=swimlane-Done]').find('[data-test=bar-r2]').exists()).toBe(true)
  })

  it('renders month ticks on the shared axis', () => {
    const w = mountView()
    const ticks = w.findAll('[data-test=axis-tick]')
    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks[0].text()).toMatch(/20\d\d/)
  })

  it('still lays out bars when ungrouped', () => {
    const view = { ...schema.views[0], config: { ...schema.views[0].config, groupColumnId: null } }
    const w = mountView({ view })
    expect(w.find('[data-test=swimlane-Todo]').exists()).toBe(false)
    expect(w.find('[data-test=bar-r1]').exists()).toBe(true)
  })

  it('shows a hint when there is no start column', () => {
    const s = { ...schema, columns: schema.columns.filter((c) => c.type !== 'date') }
    const view = { ...schema.views[0], config: { ...schema.views[0].config, startColumnId: null } }
    const w = mountView({ schema: s, view })
    expect(w.text()).toContain('date column')
  })
})
