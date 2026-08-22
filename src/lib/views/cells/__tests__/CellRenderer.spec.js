import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CellRenderer from '../CellRenderer.vue'
import SelectCell from '../SelectCell.vue'

const row = (cells) => ({ id: 'r1', cells, createdAt: 0, updatedAt: 0 })
const col = (id, type, config = {}) => ({ id, name: id, type, config })
const mountOpts = {
  global: { stubs: { 'v-remixicon': { template: '<i />' } } },
}

describe('CellRenderer', () => {
  it('renders number through number format', () => {
    const w = mount(CellRenderer, { props: {
      column: col('n', 'number', { format: 'dollar' }), row: row({ n: 42 }), editing: false,
    }})
    expect(w.text()).toContain('$42')
  })
  it('emits update patch on text commit', async () => {
    const w = mount(CellRenderer, { props: {
      column: col('t', 'rich_text'), row: row({ t: [{ type: 'text', text: 'a' }] }), editing: true,
    }})
    const input = w.find('input')
    await input.setValue('hello')
    await input.trigger('keydown.enter')
    expect(w.emitted('update')[0][0]).toEqual({ t: [{ type: 'text', text: 'hello' }] })
  })
  it('checkbox toggles emit boolean', async () => {
    const w = mount(CellRenderer, { ...mountOpts, props: { column: col('c', 'checkbox'), row: row({ c: false }) } })
    await w.find('[data-test=checkbox-cell]').trigger('click')
    expect(w.emitted('update')[0][0]).toEqual({ c: true })
    await w.setProps({ row: row({ c: true }) })
    await w.find('input[type=checkbox]').setValue(false)
    expect(w.emitted('update')[1][0]).toEqual({ c: false })
  })

  it('esc on text cancels without commit', async () => {
    const w = mount(CellRenderer, { props: {
      column: col('t', 'rich_text'), row: row({ t: [{ type: 'text', text: 'a' }] }), editing: true,
    }})
    await w.find('input').setValue('changed')
    await w.find('input').trigger('keydown.esc')
    expect(w.emitted('update')).toBeUndefined()
  })
  it('url cells commit plain strings, not rich text', async () => {
    const w = mount(CellRenderer, { props: {
      column: col('u', 'url'), row: row({ u: 'https://a.co' }), editing: true,
    }})
    const input = w.find('input')
    await input.setValue('https://b.co')
    await input.trigger('keydown.enter')
    expect(w.emitted('update')[0][0]).toEqual({ u: 'https://b.co' })
  })
  it('number esc cancels without clearing the cell', async () => {
    const w = mount(CellRenderer, { props: {
      column: col('n', 'number', {}), row: row({ n: 7 }), editing: true,
    }})
    await w.find('input').setValue('999')
    await w.find('input').trigger('keydown.esc')
    expect(w.emitted('update')).toBeUndefined()
  })
  it('number commits parsed value or null when empty', async () => {
    const w = mount(CellRenderer, { props: { column: col('n', 'number'), row: row({ n: null }), editing: true } })
    await w.find('input').setValue('3.5')
    await w.find('input').trigger('blur')
    expect(w.emitted('update')[0][0]).toEqual({ n: 3.5 })
    await w.find('input').setValue('')
    await w.setProps({ row: row({ n: 3.5 }) })
    await w.find('input').trigger('keydown.enter')
    expect(w.emitted('update')[1][0]).toEqual({ n: null })
  })
  it('date commits {start,time_zone} and null when cleared', async () => {
    const w = mount(CellRenderer, { props: {
      column: col('d', 'date'), row: row({ d: { start: '2026-01-02', time_zone: null } }), editing: true,
    }})
    const input = w.find('input[type=date]')
    expect(input.element.value).toBe('2026-01-02')
    await input.setValue('2026-03-04')
    expect(w.emitted('update')[0][0]).toEqual({ d: { start: '2026-03-04', time_zone: null } })
    await input.setValue('')
    expect(w.emitted('update')[1][0]).toEqual({ d: null })
  })
  it('renders select option pills and toggles single select', async () => {
    const column = col('s', 'select', { options: [{ id: 'o1', name: 'Todo', color: 'red' }, { id: 'o2', name: 'Done', color: 'green' }] })
    const w = mount(CellRenderer, { ...mountOpts, props: { column, row: row({ s: 'o1' }), editing: false } })
    expect(w.text()).toContain('Todo')
    const cell = w.findComponent(SelectCell)
    cell.vm.toggle(column.config.options[1])
    expect(w.emitted('update')[0][0]).toEqual({ s: 'o2' })
    await w.setProps({ row: row({ s: 'o2' }) })
    cell.vm.toggle(column.config.options[1])
    expect(w.emitted('update')[1][0]).toEqual({ s: null })
  })
  it('multi_select toggle emits array membership', async () => {
    const column = col('m', 'multi_select', { options: [{ id: 'a', name: 'A', color: 'blue' }] })
    const w = mount(CellRenderer, { ...mountOpts, props: { column, row: row({ m: [] }) } })
    const cell = w.findComponent(SelectCell)
    cell.vm.toggle(column.config.options[0])
    expect(w.emitted('update')[0][0]).toEqual({ m: ['a'] })
    await w.setProps({ row: row({ m: ['a'] }) })
    cell.vm.toggle(column.config.options[0])
    expect(w.emitted('update')[1][0]).toEqual({ m: null })
  })
  it('readonly columns render computed value, unknown types a dash', () => {
    const w = mount(CellRenderer, { props: {
      column: col('f', 'formula'), row: row({}), editing: false, computed: '42',
    }})
    expect(w.text()).toContain('42')
    const w2 = mount(CellRenderer, { props: { column: col('x', 'people'), row: row({}) } })
    expect(w2.text()).toContain('—')
  })
})
