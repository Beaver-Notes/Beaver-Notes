import { describe, it, expect } from 'vitest'
import { generateFromDescription } from '../formula-fallback'
import { evaluateExpression } from '../formula-evaluator'

const cols = [
  { id: 'due', name: 'Due', type: 'date' },
  { id: 'status', name: 'Status', type: 'select', config: { options: [{ id: 'o1', name: 'Done' }, { id: 'o2', name: 'Doing' }] } },
  { id: 'chk', name: 'Complete', type: 'checkbox' },
  { id: 'first', name: 'First', type: 'rich_text' },
  { id: 'last', name: 'Last', type: 'rich_text' },
]

describe('rule engine', () => {
  it('date arithmetic: days until a date column', () => {
    expect(generateFromDescription('days until Due', cols))
      .toEqual({ formula: 'dateBetween(prop("Due"), now(), "days")' })
  })
  it('overdue highlight styles title red', () => {
    const r = generateFromDescription('highlight overdue rows in red', cols)
    expect(r.formula).toBe(`if(prop("Due") < today(), style("Overdue", "red"), "")`)
  })
  it('status to number mapping', () => {
    const r = generateFromDescription('score Status where Done is 3 and Doing is 1', cols)
    expect(r.formula).toContain('prop("Status")'); expect(r.formula).toContain('"Done"')
  })
  it('checkbox percentage', () => {
    expect(generateFromDescription('% of Complete checked', cols).formula)
      .toBe('format(round(prop("Complete") * 100)) + "%"')
  })
  it('concatenation of two text columns', () => {
    const r = generateFromDescription('combine First and Last', cols)
    expect(r.formula).toBe('concat(prop("First"), " ", prop("Last"))')
  })
  it('no match returns explicit error', () => {
    expect(generateFromDescription('make something wild', cols)).toEqual({ error: 'could-not-generate' })
  })
  it('every emitted formula evaluates without throwing (sparse props)', () => {
    const fixtures = [
      'days until Due',
      'highlight overdue rows in red',
      'score Status where Done is 3 and Doing is 1',
      '% of Complete checked',
      'combine First and Last',
    ]
    for (const text of fixtures) {
      const { formula } = generateFromDescription(text, cols)
      expect(formula).toBeTruthy()
      const result = evaluateExpression(formula, { props: {} })
      expect(result).toBeDefined()
    }
    // overdue with missing date prop falls through if-else to ""
    const overdue = generateFromDescription('highlight overdue rows in red', cols).formula
    expect(evaluateExpression(overdue, { props: { Due: null } })).toBe('')
  })
})
