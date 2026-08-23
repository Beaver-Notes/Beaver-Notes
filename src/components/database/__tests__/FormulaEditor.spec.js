import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { ref } from 'vue'

import FormulaEditor from '../FormulaEditor.vue'

const { describeMock } = vi.hoisted(() => ({ describeMock: vi.fn() }))
vi.mock('@/composable/useFormulaGenerator', () => ({
  useFormulaGenerator: () => ({ describe: describeMock, busy: ref(false) }),
}))

const baseColumn = { id: 'c3', name: 'Total', type: 'formula', config: {} }

const schema = {
  id: 'db1',
  title: 'Tasks',
  columns: [
    { id: 'c1', name: 'Price', type: 'number', config: {} },
    { id: 'c2', name: 'Qty', type: 'number', config: {} },
    baseColumn,
  ],
  views: [],
}

const rows = [{ id: 'r1', cells: { c1: 2, c2: 3 } }]

const mountEditor = (over = {}) =>
  mount(FormulaEditor, {
    props: { column: baseColumn, schema, rows, ...over },
    global: {
      plugins: [createPinia()],
      stubs: {
        UiModal: { template: '<div><slot name="header" /><slot /><slot name="actions" /></div>' },
      },
    },
  })

const setExpr = async (w, value) => {
  const ta = w.find('[data-test=expression-input]')
  ta.element.value = value
  ta.element.setSelectionRange(value.length, value.length)
  await ta.trigger('input')
}

beforeEach(() => describeMock.mockReset())

describe('FormulaEditor', () => {
  it('mounts an expression column in expression mode', () => {
    const w = mountEditor({ column: { ...baseColumn, config: { expression: 'prop("Price")' } } })
    expect(w.find('[data-test=expression-input]').exists()).toBe(true)
    expect(w.find('[data-test=mode-expression]').attributes('data-active')).toBe('true')
  })

  it('empty draft disables Save; valid expression enables it and emits payload', async () => {
    const w = mountEditor()
    await w.find('[data-test=mode-expression]').trigger('click')
    expect(w.find('[data-test=save]').attributes('disabled')).toBeDefined()

    await setExpr(w, 'prop("Price") + 1')
    expect(w.find('[data-test=save]').attributes('disabled')).toBeUndefined()
    await w.find('[data-test=save]').trigger('click')
    expect(w.emitted('save')[0][0]).toBe('prop("Price") + 1')
  })

  it('invalid expression shows error with position hint, error class, and keeps Save disabled', async () => {
    const w = mountEditor()
    await w.find('[data-test=mode-expression]').trigger('click')
    await setExpr(w, 'prop("Price') // unterminated string, pos 5
    expect(w.find('[data-test=formula-error]').exists()).toBe(true)
    expect(w.find('[data-test=formula-error]').text()).toContain('5')
    expect(w.find('[data-test=expression-input]').classes().join(' ')).toContain('border-red-500')
    expect(w.find('[data-test=save]').attributes('disabled')).toBeDefined()
  })

  it('autocompletes column names after prop( and inserts on enter', async () => {
    const w = mountEditor()
    await w.find('[data-test=mode-expression]').trigger('click')
    await setExpr(w, 'prop("')
    expect(w.find('[data-test=autocomplete]').exists()).toBe(true)
    expect(w.find('[data-test=ac-Price]').exists()).toBe(true)

    await w.find('[data-test=expression-input]').trigger('keydown', { key: 'ArrowDown' })
    await w.find('[data-test=expression-input]').trigger('keydown', { key: 'Enter' })
    expect(w.find('[data-test=expression-input]').element.value).toBe('prop("Qty")')
  })

  it('suggests catalog functions at word-start with arity hints', async () => {
    const w = mountEditor()
    await w.find('[data-test=mode-expression]').trigger('click')
    await setExpr(w, 'su')
    expect(w.find('[data-test=ac-sum]').exists()).toBe(true)
    expect(w.find('[data-test=ac-sum]').text()).toContain('number')
  })

  it('escape closes the autocomplete popup', async () => {
    const w = mountEditor()
    await w.find('[data-test=mode-expression]').trigger('click')
    await setExpr(w, 'prop("')
    expect(w.find('[data-test=autocomplete]').exists()).toBe(true)
    await w.find('[data-test=expression-input]').trigger('keydown', { key: 'Escape' })
    expect(w.find('[data-test=autocomplete]').exists()).toBe(false)
  })

  it('previews the result against the first row', () => {
    const w = mountEditor({ column: { ...baseColumn, config: { expression: 'prop("Price") * prop("Qty")' } } })
    expect(w.find('[data-test=formula-preview]').text()).toContain('6')
  })

  it('hides preview without rows', () => {
    const w = mountEditor({ rows: [], column: { ...baseColumn, config: { expression: '1 + 1' } } })
    expect(w.find('[data-test=formula-preview]').exists()).toBe(false)
  })

  it('describe mode generates a formula and inserts it into the expression textarea', async () => {
    describeMock.mockResolvedValue({ formula: 'dateBetween(prop("Due"), now(), "days")' })
    const w = mountEditor()
    await w.find('[data-test=describe-input]').setValue('days until due')
    await w.find('[data-test=generate]').trigger('click')
    await flushPromises()
    expect(describeMock).toHaveBeenCalledWith('days until due', schema.columns)
    expect(w.find('[data-test=generated-formula]').text()).toContain('dateBetween')

    await w.find('[data-test=insert-generated]').trigger('click')
    expect(w.find('[data-test=mode-expression]').attributes('data-active')).toBe('true')
    expect(w.find('[data-test=expression-input]').element.value).toBe(
      'dateBetween(prop("Due"), now(), "days")',
    )
  })

  it('shows a retry affordance when generation fails, never blocking', async () => {
    describeMock.mockResolvedValue({ error: 'could-not-generate' })
    const w = mountEditor()
    await w.find('[data-test=describe-input]').setValue('nonsense request')
    await w.find('[data-test=generate]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test=generate-error]').exists()).toBe(true)
    expect(w.find('[data-test=generate]').attributes('disabled')).toBeUndefined()
  })

  it('cancel emits cancel', async () => {
    const w = mountEditor()
    await w.find('[data-test=cancel]').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })
})
