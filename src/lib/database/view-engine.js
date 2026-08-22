import { richTextToPlain } from './rich-text-convert'

const TEXTISH = ['title', 'rich_text', 'url', 'email', 'phone_number']
const DATEISH = ['date', 'created_time', 'last_edited_time']
const MULTI = ['select', 'status', 'multi_select', 'people', 'relation']

export function defaultViewConfig(type, columns = []) {
  const firstOf = (...types) => columns.find((c) => types.includes(c.type))?.id || null
  const cardFields = () => columns.filter((c) => !['title', 'files'].includes(c.type)).slice(0, 3).map((c) => c.id)
  switch (type) {
    case 'kanban': return { groupColumnId: firstOf('select', 'status'), cardFields: cardFields(), coverColumnId: null }
    case 'calendar': return { dateColumnId: firstOf('date', 'created_time', 'last_edited_time'), granularity: 'month' }
    case 'gallery': return { cardFields: cardFields(), coverColumnId: null }
    case 'list': return { cardFields: cardFields() }
    case 'timeline': return { startColumnId: firstOf('date', 'created_time'), endColumnId: null, groupColumnId: firstOf('select', 'status') }
    default: return {}
  }
}

function cellValue(column, row) {
  const v = row.cells?.[column.id]
  if (column.type === 'created_time') return row.createdAt ? new Date(row.createdAt).toISOString() : null
  if (column.type === 'last_edited_time') return row.updatedAt ? new Date(row.updatedAt).toISOString() : null
  return v ?? null
}

function displayText(v) {
  if (v == null) return ''
  if (typeof v === 'object' && !Array.isArray(v)) return v.start ? String(v.start) : ''
  return String(richTextToPlain(v))
}

function cellIds(v) {
  return (Array.isArray(v) ? v : [v]).filter(Boolean)
}

function optionNames(column, v) {
  const opts = column.config?.options || []
  return cellIds(v).map((idOrName) => opts.find((o) => o.id === idOrName)?.name || idOrName)
}

function dayOf(v) {
  const s = v?.start ?? v
  return typeof s === 'string' ? s.slice(0, 10) : null
}

export function matchOperator(column, rawValue, op, filterValue) {
  const v = rawValue
  if (TEXTISH.includes(column.type)) {
    const s = displayText(v).toLowerCase(); const q = String(filterValue ?? '').toLowerCase()
    switch (op) {
      case 'contains': return q !== '' && s.includes(q)
      case 'notContains': return q === '' || !s.includes(q)
      case 'isEmpty': return s.trim() === ''
      case 'isNotEmpty': return s.trim() !== ''
    }
  }
  if (['number', 'unique_id'].includes(column.type) || typeof v === 'number') {
    const n = Number(v)
    switch (op) {
      case 'equals': return n === Number(filterValue)
      case 'notEquals': return n !== Number(filterValue)
      case 'greaterThan': return n > Number(filterValue)
      case 'lessThan': return n < Number(filterValue)
      case 'greaterThanOrEqual': return n >= Number(filterValue)
      case 'lessThanOrEqual': return n <= Number(filterValue)
      case 'isEmpty': return v == null || Number.isNaN(n)
      case 'isNotEmpty': return v != null && !Number.isNaN(n)
    }
  }
  if (column.type === 'checkbox') {
    const b = v === true
    return op === 'isChecked' ? b : !b
  }
  if (MULTI.includes(column.type)) {
    const ids = cellIds(v)
    const names = optionNames(column, v)
    const q = String(filterValue ?? '')
    switch (op) {
      case 'contains': return names.includes(q) || ids.includes(q)
      case 'notContains': return !names.includes(q) && !ids.includes(q)
      case 'isEmpty': return ids.length === 0
      case 'isNotEmpty': return ids.length > 0
    }
  }
  if (DATEISH.includes(column.type)) {
    const day = dayOf(v)
    switch (op) {
      case 'isEmpty': return !day
      case 'isNotEmpty': return !!day
      case 'is': return day === filterValue
      case 'before': return !!day && day < filterValue
      case 'after': return !!day && day > filterValue
      case 'onOrBefore': return !!day && day <= filterValue
      case 'onOrAfter': return !!day && day >= filterValue
    }
  }
  return false
}

export function applyFilters(rows, columns, filters) {
  if (!filters || !Array.isArray(filters.list) || filters.list.length === 0) return rows
  const byId = new Map(columns.map((c) => [c.id, c]))
  const keep = (row) => {
    const results = filters.list.map(({ columnId, operator, value }) => {
      const col = byId.get(columnId)
      return col ? matchOperator(col, cellValue(col, row), operator, value) : true
    })
    return filters.conjunction === 'or' ? results.some(Boolean) : results.every(Boolean)
  }
  return rows.filter(keep)
}

function sortKey(column, row) {
  const v = cellValue(column, row)
  if (TEXTISH.includes(column.type)) return displayText(v).toLowerCase()
  if (DATEISH.includes(column.type)) return dayOf(v) || ''
  if (column.type === 'checkbox') return v === true ? 1 : 0
  if (MULTI.includes(column.type)) {
    // sort by option index so order matches user-visible option order (groupRows does the same)
    const names = optionNames(column, v)
    if (!names.length) return Number.MAX_SAFE_INTEGER
    const idx = (column.config?.options || []).findIndex((o) => o.name === names[0])
    return idx >= 0 ? idx : names[0].toLowerCase() // ponytail: matched-index vs unmatched-name mix compares as strings; per-value rank keys if views need it
  }
  return v == null ? -Infinity : Number(v)
}

export function applySorts(rows, columns, sorts) {
  if (!Array.isArray(sorts) || sorts.length === 0) return rows
  const byId = new Map(columns.map((c) => [c.id, c]))
  return [...rows].sort((ra, rb) => {
    for (const { columnId, direction } of sorts) {
      const col = byId.get(columnId); if (!col) continue
      let a = sortKey(col, ra), b = sortKey(col, rb)
      if (typeof a === 'string' || typeof b === 'string') { a = String(a); b = String(b) }
      const cmp = a < b ? -1 : a > b ? 1 : 0
      if (cmp !== 0) return direction === 'desc' ? -cmp : cmp
    }
    return 0
  })
}

export function groupRows(rows, columns, groupByColumnId) {
  const col = columns.find((c) => c.id === groupByColumnId)
  if (!col) return []
  const buckets = new Map()
  for (const r of rows) {
    const names = MULTI.includes(col.type) ? optionNames(col, cellValue(col, r)) : [displayText(cellValue(col, r))]
    for (const name of (names.length ? names : [''])) {
      if (!buckets.has(name)) buckets.set(name, [])
      buckets.get(name).push(r)
    }
  }
  const orderedKeys = MULTI.includes(col.type)
    ? [...(col.config?.options || []).map((o) => o.name), ...[...buckets.keys()].filter((k) => !(col.config?.options || []).some((o) => o.name === k))]
    : [...buckets.keys()]
  return orderedKeys.filter((k) => buckets.has(k)).map((k) => ({
    key: k, label: k || 'Empty',
    color: (col.config?.options || []).find((o) => o.name === k)?.color || 'gray',
    rows: buckets.get(k),
  }))
}

export function runView(schema, view, rows) {
  const cfg = view.config || {}
  let out = applyFilters(rows, schema.columns, cfg.filters)
  out = applySorts(out, schema.columns, cfg.sorts)
  if (cfg.groupColumnId) return { rows: out, groups: groupRows(out, schema.columns, cfg.groupColumnId) }
  return { rows: out, groups: null }
}
