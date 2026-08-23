import { describe, it, expect } from 'vitest'
import { createDatabase, createColumn } from '../schema'
import { computeRowCells, createComputeCache } from '../compute-row'

function fixture() {
  const schema = createDatabase()
  const price = createColumn('number', 'Price')
  const qty = createColumn('number', 'Qty')
  const total = createColumn('formula', 'Total'); total.config.expression = 'prop("Price") * prop("Qty")'
  const broken = createColumn('formula', 'Broken'); broken.config.expression = 'nosuch(1)'
  const missing = createColumn('formula', 'MissingRef'); missing.config.expression = 'prop("Nope")'
  const created = createColumn('created_time', 'Created')
  const edited = createColumn('last_edited_time', 'Edited')
  const key = createColumn('unique_id', 'Key'); key.config.prefix = 'TASK'
  schema.columns.push(price, qty, total, broken, missing, created, edited, key)
  const row = { id: 'r1', createdAt: 1700000000000, updatedAt: 1700000001000, cells: {} }
  row.cells[price.id] = 2
  row.cells[qty.id] = 5
  return { schema, price, qty, total, broken, missing, created, edited, key, row }
}

describe('computeRowCells', () => {
  it('evaluates formula columns and reports errors instead of throwing', () => {
    const f = fixture()
    const out = computeRowCells(f.schema, f.row)
    expect(out[f.total.id]).toEqual({ value: 10 })
    expect(out[f.broken.id].error).toContain('nosuch')
    // T5 semantics: unknown props resolve to null, not errors
    expect(out[f.missing.id]).toEqual({ value: null })
  })

  it('only includes computed (formula/rollup/auto) columns', () => {
    const f = fixture()
    const out = computeRowCells(f.schema, f.row)
    const expected = [f.total.id, f.broken.id, f.missing.id, f.created.id, f.edited.id, f.key.id]
    expect(Object.keys(out).sort()).toEqual(expected.sort())
  })

  it('maps auto columns from row metadata and position', () => {
    const f = fixture()
    const r2 = { id: 'r2', createdAt: 0, updatedAt: 0, cells: {} }
    const ctx = { getRows: () => [f.row, r2] }
    const out2 = computeRowCells(f.schema, r2, ctx)
    expect(computeRowCells(f.schema, f.row, ctx)[f.created.id])
      .toEqual({ value: new Date(1700000000000).toISOString() })
    expect(out2[f.edited.id]).toEqual({ value: new Date(0).toISOString() })
    expect(out2[f.key.id]).toEqual({ value: { number: 2, prefix: 'TASK' } })
  })

  it('converts date cells so formula comparisons work', () => {
    const f = fixture()
    const a = createColumn('date', 'A')
    const b = createColumn('date', 'B')
    const later = createColumn('formula', 'Later'); later.config.expression = 'prop("A") > prop("B")'
    f.schema.columns.push(a, b, later)
    f.row.cells[a.id] = { start: '2026-01-03' }
    f.row.cells[b.id] = { start: '2026-01-02' }
    expect(computeRowCells(f.schema, f.row)[later.id]).toEqual({ value: true })
  })

  it('feeds rollup with related values and surfaces stub null until T21', () => {
    const other = createDatabase()
    const points = createColumn('number', 'Points')
    other.columns.push(points)
    const rel = createColumn('relation', 'Rel'); rel.config.databaseId = other.id
    const rollup = createColumn('rollup', 'Sum')
    rollup.config = { relationPropertyId: rel.id, rollupPropertyId: points.id, function: 'sum' }
    const f = fixture()
    f.schema.columns.push(rel, rollup)
    const orow = { id: 'o1', createdAt: 0, updatedAt: 0, cells: {} }
    orow.cells[points.id] = 7
    f.row.cells[rel.id] = ['missing-row', orow.id]
    const seen = []
    const out = computeRowCells(f.schema, f.row, { getRows: (dbId) => { seen.push(dbId); return [orow] } })
    expect(seen).toContain(other.id)
    expect(out[rollup.id]).toEqual({ value: 7 })
  })
})

describe('createComputeCache', () => {
  it('caches per dbId:rowId:updatedAt and recomputes when updatedAt moves', () => {
    const f = fixture()
    const cache = createComputeCache()
    const first = cache.get(f.schema, f.row)
    expect(cache.get(f.schema, f.row)).toBe(first)
    f.row.updatedAt += 1
    f.row.cells[f.qty.id] = 3
    expect(cache.get(f.schema, f.row)[f.total.id]).toEqual({ value: 6 })
  })

  it('clear(dbId) drops only that database, clear() drops all', () => {
    const a = fixture()
    const b = fixture()
    const cache = createComputeCache()
    const aOut = cache.get(a.schema, a.row)
    const bOut = cache.get(b.schema, b.row)
    cache.clear(a.schema.id)
    expect(cache.get(b.schema, b.row)).toBe(bOut)
    expect(cache.get(a.schema, a.row)).not.toBe(aOut)
    cache.clear()
    expect(cache.get(b.schema, b.row)).not.toBe(bOut)
  })
})
