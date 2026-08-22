import { describe, it, expect } from 'vitest'
import { defaultViewConfig, applyFilters, applySorts, groupRows, runView } from '../view-engine'

const columns = [
  { id: 't', name: 'Name', type: 'title' },
  { id: 'n', name: 'Pts', type: 'number' },
  { id: 's', name: 'Status', type: 'select', config: { options: [
    { id: 'o1', name: 'Todo', color: 'gray' }, { id: 'o2', name: 'Done', color: 'green' },
  ]}},
  { id: 'd', name: 'Due', type: 'date' },
]
const row = (id, cells) => ({ id, cells, createdAt: 1, updatedAt: 1 })
const rows = [
  row('r1', { t: rt('Alpha'), n: 3, s: 'o1', d: { start: '2026-01-02' } }),
  row('r2', { t: rt('Beta'), n: 10, s: 'o2', d: null }),
  row('r3', { t: rt('Gamma'), n: 1, s: 'o1', d: { start: '2026-03-04' } }),
]
function rt(text) { return [{ type: 'text', text }] }

describe('filters', () => {
  it('number greaterThan with and-conjunction', () => {
    const f = { conjunction: 'and', list: [{ columnId: 'n', operator: 'greaterThan', value: 2 }] }
    expect(applyFilters(rows, columns, f).map((r) => r.id)).toEqual(['r1', 'r2'])
  })
  it('or-conjunction across types', () => {
    const f = { conjunction: 'or', list: [
      { columnId: 'n', operator: 'lessThan', value: 2 },
      { columnId: 's', operator: 'contains', value: 'o2' },
    ]}
    expect(applyFilters(rows, columns, f).map((r) => r.id)).toEqual(['r2', 'r3'])
  })
})

describe('sorts', () => {
  it('multi-key stable sort', () => {
    const sorted = applySorts(rows, columns, [
      { columnId: 's', direction: 'asc' }, { columnId: 'n', direction: 'desc' },
    ])
    expect(sorted.map((r) => r.id)).toEqual(['r1', 'r3', 'r2'])
  })
})

describe('groups', () => {
  it('select groups follow option order', () => {
    const g = groupRows(rows, columns, 's')
    expect(g.map((x) => x.label)).toEqual(['Todo', 'Done'])
    expect(g[0].rows.map((r) => r.id)).toEqual(['r1', 'r3'])
  })
})

describe('runView', () => {
  it('returns groups for kanban-style config, rows otherwise', () => {
    const kanban = { type: 'kanban', config: { ...defaultViewConfig('kanban', columns), groupColumnId: 's' } }
    expect(runView({ columns }, kanban, rows).groups).toBeTruthy()
    const table = { type: 'table', config: defaultViewConfig('table', columns) }
    const tv = runView({ columns }, table, rows)
    expect(tv.groups).toBe(null); expect(tv.rows).toHaveLength(3)
  })
})
