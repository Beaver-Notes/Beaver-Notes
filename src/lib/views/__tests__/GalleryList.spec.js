import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'

import GalleryView from '../GalleryView.vue'
import ListView from '../ListView.vue'

const schema = {
  id: 'db',
  title: 'T',
  icon: '',
  deletedColumnIds: {},
  lastViewId: null,
  columns: [
    { id: 't', name: 'Name', type: 'title' },
    { id: 'f', name: 'Image', type: 'files' },
    { id: 'n', name: 'Pts', type: 'number' },
  ],
}

const baseConfig = { filters: { conjunction: 'and', list: [] }, sorts: [], cardFields: ['n'] }
const galleryView = {
  id: 'vg', name: 'Gallery', type: 'gallery', icon: '',
  config: { ...baseConfig, coverColumnId: 'f' },
}
const listView = { id: 'vl', name: 'List', type: 'list', icon: '', config: { ...baseConfig } }

const rows = [
  { id: 'r1', cells: { t: [{ type: 'text', text: 'Alpha' }], n: 1, f: [{ name: 'a.png', url: 'blob:a' }] } },
  { id: 'r2', cells: { t: [{ type: 'text', text: 'Beta' }] } },
]

const mountView = (component, view, over = {}) =>
  mount(component, {
    props: { schema, rows, version: 0, view, ...over },
    global: {
      plugins: [createPinia()],
      stubs: { 'v-remixicon': { template: '<i />' } },
    },
  })

describe('GalleryView', () => {
  it('renders one card per row', () => {
    const w = mountView(GalleryView, galleryView)
    expect(w.findAll('[data-test^=card-]')).toHaveLength(2)
    expect(w.find('[data-test=card-r1]').text()).toContain('Alpha')
    expect(w.find('[data-test=card-r2]').text()).toContain('Beta')
  })

  it('shows cardFields previews', () => {
    const w = mountView(GalleryView, galleryView)
    expect(w.find('[data-test=card-r1]').text()).toContain('1')
  })

  it('shows the cover image from the files column when a url exists', () => {
    const w = mountView(GalleryView, galleryView)
    expect(w.find('[data-test=card-r1] img').attributes('src')).toBe('blob:a')
    expect(w.find('[data-test=card-r2] img').exists()).toBe(false)
  })

  it('clicking a card emits open-row', async () => {
    const w = mountView(GalleryView, galleryView)
    await w.find('[data-test=card-r1]').trigger('click')
    expect(w.emitted('open-row')[0][0]).toBe('r1')
  })

  it('respects filters and sorts from the view config', () => {
    const sorted = {
      ...galleryView,
      config: {
        ...galleryView.config,
        filters: { conjunction: 'and', list: [{ columnId: 'n', operator: 'isNotEmpty', value: '' }] },
        sorts: [{ columnId: 'n', direction: 'desc' }],
      },
    }
    const withPts = [...rows, { id: 'r3', cells: { t: [{ type: 'text', text: 'Gamma' }], n: 5 } }]
    const w = mountView(GalleryView, sorted, { rows: withPts })
    expect(w.findAll('[data-test^=card-]').map((c) => c.attributes('data-test'))).toEqual(['card-r3', 'card-r1'])
  })
})

describe('ListView', () => {
  it('renders one stacked row per record with title and cardFields inline', () => {
    const w = mountView(ListView, listView)
    expect(w.findAll('[data-test^=row-]')).toHaveLength(2)
    expect(w.find('[data-test=row-r1]').text()).toContain('Alpha')
    expect(w.find('[data-test=row-r1]').text()).toContain('1')
  })

  it('clicking a row emits open-row', async () => {
    const w = mountView(ListView, listView)
    await w.find('[data-test=row-r2]').trigger('click')
    expect(w.emitted('open-row')[0][0]).toBe('r2')
  })
})
