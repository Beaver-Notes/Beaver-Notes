// src/lib/database/compute-row.js
import dayjs from 'dayjs'
import { evaluateExpression } from './formula-evaluator'
import { computeRollup } from './rollup-engine'

const AUTO_TYPES = ['created_time', 'last_edited_time', 'unique_id']

const iso = (t) => (t == null ? null : new Date(t).toISOString())

// Feed formulas dayjs objects (T5 convention): raw ISO strings break date ordering.
// Range cells ({start, end}) contribute their start side; {__date} tags pass through
// for the evaluator to unwrap.
function asDate(v) {
  if (v == null || dayjs.isDayjs(v)) return v
  const d = dayjs(typeof v === 'object' ? v.start : v)
  return d.isValid() ? d : v
}

function computedValue(schema, row, col, context) {
  switch (col.type) {
    case 'formula': {
      const props = {}
      for (const c of schema.columns) {
        if (c.type === 'formula' || c.type === 'rollup' || AUTO_TYPES.includes(c.type)) continue
        props[c.name] = c.type === 'date' ? asDate(row.cells?.[c.id]) : row.cells?.[c.id]
      }
      return evaluateExpression(col.config.expression, {
        props,
        now: context.now,
        users: context.users,
      })
    }
    case 'rollup': {
      const cfg = col.config
      const rel = schema.columns.find((c) => c.id === cfg.relationPropertyId)
      const ids = row.cells?.[cfg.relationPropertyId] ?? []
      const dbId = rel?.config?.databaseId
      const rows = dbId && context.getRows ? context.getRows(dbId) : []
      return computeRollup(
        rows.filter((r) => ids.includes(r.id)).map((r) => r.cells?.[cfg.rollupPropertyId]),
        cfg,
      )
    }
    case 'created_time': return iso(row.createdAt)
    case 'last_edited_time': return iso(row.updatedAt)
    // unique_id is position-based by design (v1): not stable across sort changes.
    case 'unique_id': {
      const rows = context.getRows ? context.getRows(schema.id) : []
      const i = rows.findIndex((r) => r.id === row.id)
      return { number: Math.max(i, 0) + 1, prefix: col.config.prefix }
    }
    default: return undefined
  }
}

export function computeRowCells(schema, row, context = {}) {
  const out = {}
  for (const col of schema.columns) {
    try {
      const value = computedValue(schema, row, col, context)
      if (value !== undefined) out[col.id] = { value }
    } catch (e) {
      out[col.id] = { error: e.message }
    }
  }
  return out
}

export function createComputeCache() {
  const cache = new Map()
  return {
    get(schema, row, context) {
      const key = `${schema.id}:${row.id}:${row.updatedAt}`
      if (!cache.has(key)) cache.set(key, computeRowCells(schema, row, context))
      return cache.get(key)
    },
    clear(dbId) {
      if (!dbId) return cache.clear()
      for (const k of cache.keys()) if (k.startsWith(`${dbId}:`)) cache.delete(k)
    },
  }
}
