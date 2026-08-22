import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import dayjs from 'dayjs'

import CalendarView from '../CalendarView.vue'

const schema = {
  id: 'db',
  title: 'T',
  icon: '',
  deletedColumnIds: {},
  lastViewId: null,
  columns: [
    { id: 't', name: 'Name', type: 'title' },
    { id: 'd', name: 'Date', type: 'date' },
  ],
  views: [{
    id: 'v1', name: 'Calendar', type: 'calendar', icon: '',
    config: { filters: { conjunction: 'and', list: [] }, sorts: [], dateColumnId: 'd', granularity: 'month' },
  }],
}

const thisMonth = (day) => dayjs().startOf('month').add(day - 1, 'day').format('YYYY-MM-DD')

const rows = [
  { id: 'r1', cells: { t: [{ type: 'text', text: 'Alpha' }], d: { start: thisMonth(5) } }, createdAt: 1, updatedAt: 1 },
]

const mountView = (over = {}) =>
  mount(CalendarView, {
    props: { schema, rows, version: 0, view: schema.views[0], ...over },
    global: {
      plugins: [createPinia()],
      stubs: { 'v-remixicon': { template: '<i />' } },
    },
  })

describe('CalendarView', () => {
  it('renders the month grid with events on their day', () => {
    const w = mountView()
    expect(w.find('[data-test=month-label]').text()).toBe(dayjs().format('MMMM YYYY'))
    expect(w.find(`[data-test=day-${thisMonth(5)}]`).text()).toContain('Alpha')
  })

  it('clicking a day emits add-row-on-date with its ISO key', async () => {
    const w = mountView()
    await w.find(`[data-test=day-${thisMonth(12)}] [data-test=day-body]`).trigger('click')
    expect(w.emitted('add-row-on-date')[0][0]).toBe(thisMonth(12))
  })

  it('prev/next month buttons move the cursor; Today returns to now', async () => {
    const w = mountView()
    await w.find('[data-test=next-month]').trigger('click')
    expect(w.find('[data-test=month-label]').text()).toBe(dayjs().add(1, 'month').format('MMMM YYYY'))
    expect(w.find(`[data-test=day-${thisMonth(5)}]`).exists()).toBe(false)
    await w.find('[data-test=today-btn]').trigger('click')
    expect(w.find('[data-test=month-label]').text()).toBe(dayjs().format('MMMM YYYY'))
  })

  it('highlights today', () => {
    const w = mountView()
    const num = w.get(`[data-test=day-${dayjs().format('YYYY-MM-DD')}] span`)
    expect(num.classes().join(' ')).toContain('bg-primary')
  })

  it('shows a hint when the view has no date column', () => {
    const view = { ...schema.views[0], config: { ...schema.views[0].config, dateColumnId: null } }
    const w = mountView({ view })
    expect(w.text()).toContain('date column')
  })
})
