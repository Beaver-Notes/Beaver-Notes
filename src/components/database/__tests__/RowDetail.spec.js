import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'

import RowDetail from '../RowDetail.vue'

const schema = {
  id: 'db1',
  title: 'Tasks',
  columns: [
    { id: 't', name: 'Name', type: 'title' },
    { id: 'done', name: 'Done', type: 'checkbox' },
    { id: 'n', name: 'Points', type: 'number' },
  ],
}

const row = {
  id: 'r1',
  cells: { t: [{ type: 'text', text: 'Write tests' }], done: false, n: 3 },
  createdAt: 1,
  updatedAt: 2,
}

const mountDrawer = (over = {}) =>
  mount(RowDetail, {
    attachTo: document.body,
    props: { schema, row, open: true, ...over },
    global: {
      plugins: [createPinia()],
      stubs: {
        'v-remixicon': { template: '<i />' },
        'ui-button': { template: '<button><slot /></button>' },
      },
    },
  })

const q = (sel) => document.body.querySelector(sel)

describe('RowDetail drawer', () => {
  it('renders nothing while closed', () => {
    const w = mountDrawer({ open: false })
    expect(q('[data-test=row-drawer]')).toBe(null)
    w.unmount()
  })

  it('shows the row title and one property row per column when open', () => {
    const w = mountDrawer()
    const panel = q('[data-test=row-drawer]')
    expect(panel).toBeTruthy()
    expect(panel.textContent).toContain('Write tests')
    for (const c of schema.columns) {
      expect(q(`[data-test=property-${c.id}]`)).toBeTruthy()
      expect(q(`[data-test=property-${c.id}]`).textContent).toContain(c.name)
    }
    w.unmount()
  })

  it('emits close on backdrop click, close button, and Escape', async () => {
    const w = mountDrawer()
    await q('[data-test=drawer-backdrop]').click()
    await q('[data-test=drawer-close]').click()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')).toHaveLength(3)
    w.unmount()
  })

  it('emits open-page / delete-row with the row id from the footer buttons', async () => {
    const w = mountDrawer()
    await q('[data-test=drawer-open-page]').click()
    await q('[data-test=drawer-delete-row]').click()
    expect(w.emitted('open-page')[0][0]).toBe('r1')
    expect(w.emitted('delete-row')[0][0]).toBe('r1')
    w.unmount()
  })

  it('passes cell edits through as update events scoped to the row', async () => {
    const w = mountDrawer()
    await q('[data-test=property-done] [data-test=checkbox-cell]').click()
    expect(w.emitted('update')[0][0]).toEqual({ rowId: 'r1', patch: { done: true } })
    w.unmount()
  })
})
