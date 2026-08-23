import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { nanoid } from 'nanoid'
import { createColumn } from '../../lib/database/schema'

dayjs.extend(customParseFormat)

// ponytail: Notion-style palette; swap for a shared theme token list if one lands
export const OPTION_PALETTE = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']

const DATE_FORMATS = ['YYYY-MM-DD', 'YYYY/MM/DD', 'M/D/YYYY', 'MMMM D, YYYY', 'MMM D, YYYY']
const BOOL_RE = /^(yes|no|true|false)$/i
const URL_RE = /^https?:\/\/\S+$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[+()\d][\d\s().-]{5,}$/

const MAX_OPTION_LEN = 40
const MAX_SELECT_DISTINCT = 10

export function makeOptions(names) {
  return [...new Set(names)].map((name, i) => ({ id: nanoid(10), name, color: OPTION_PALETTE[i % OPTION_PALETTE.length] }))
}

// RFC4180: quoted fields, "" escapes, embedded newlines/CRLF
export function splitCsvRows(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const pushRow = () => {
    row.push(field)
    field = ''
    if (row.length > 1 || (row[0] ?? '').trim() !== '') rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      pushRow()
    } else field += c
  }
  if (field !== '' || row.length) pushRow()
  return rows
}

function parseDate(s) {
  const d = dayjs(s, DATE_FORMATS, true)
  return d.isValid() ? d.format('YYYY-MM-DD') : null
}

const isNumber = (s) => s.trim() !== '' && !/\s/.test(s.trim()) && Number.isFinite(Number(s))
const isBool = (s) => BOOL_RE.test(s)
const isUrl = (s) => URL_RE.test(s)
const isEmail = (s) => EMAIL_RE.test(s)
const isPhone = (s) => PHONE_RE.test(s)
const toBool = (s) => /^(yes|true)$/i.test(s)

// ponytail: categorical heuristic caps at 40 chars / 10 distinct values; long prose or tag-heavy columns fall through to rich_text/multi_select respectively
function inferColumn(cells) {
  const vals = cells.filter((c) => c !== '')
  if (!vals.length) return { type: 'rich_text', conv: (v) => v }
  if (vals.every(isBool)) return { type: 'checkbox', conv: toBool }
  if (vals.every((v) => parseDate(v))) return { type: 'date', conv: (v) => ({ start: parseDate(v) }) }
  if (vals.every(isNumber)) return { type: 'number', conv: (v) => Number(v) }
  if (vals.every(isUrl)) return { type: 'url', conv: (v) => v }
  if (vals.every(isEmail)) return { type: 'email', conv: (v) => v }
  if (vals.every(isPhone)) return { type: 'phone_number', conv: (v) => v }
  if (vals.some((v) => v.length > MAX_OPTION_LEN)) return { type: 'rich_text', conv: (v) => v }
  const parts = vals.map((v) => v.split(',').map((p) => p.trim()).filter(Boolean))
  const distinct = [...new Set(parts.flat())]
  if (!distinct.length) return { type: 'rich_text', conv: (v) => v }
  const multi = parts.some((p) => p.length > 1)
  if (!multi && distinct.length > MAX_SELECT_DISTINCT) return { type: 'rich_text', conv: (v) => v }
  const options = makeOptions(distinct)
  return {
    type: multi ? 'multi_select' : 'select',
    options,
    conv: (v) => {
      const list = v.split(',').map((p) => p.trim()).filter(Boolean)
      return multi ? list : (list[0] ?? '')
    },
  }
}

export function parseNotionCsv(csvText, { computedColumns = [] } = {}) {
  const issues = []
  const records = splitCsvRows(String(csvText ?? '').replace(/^\uFEFF/, ''))
  if (!records.length) return { schema: { columns: [] }, rows: [], issues: ['CSV contained no data'] }
  const headers = records[0].map((h) => h.trim())
  const computed = new Set(computedColumns)
  const titleIdx = Math.max(0, headers.findIndex((h) => /^(name|title)$/i.test(h)))

  const grid = headers.map((_, col) => records.slice(1).map((r) => (r[col] ?? '').trim()))
  const ragged = records.slice(1).some((r) => r.length !== headers.length)
  if (ragged) issues.push('Some CSV rows had a different column count than the header; missing cells were left empty')

  const inferred = grid.map((cells, idx) => {
    if (idx === titleIdx) return { type: 'title', conv: (v) => v }
    if (computed.has(headers[idx])) {
      issues.push(`Column "${headers[idx]}" looks like a computed value (formula/rollup/relation); imported as plain text`)
      return { type: 'rich_text', conv: (v) => v }
    }
    return inferColumn(cells)
  })

  const columns = headers.map((name, idx) => {
    const col = createColumn(inferred[idx].type, name || `Column ${idx + 1}`)
    if (inferred[idx].options) col.config.options = inferred[idx].options
    return col
  })

  const rows = records.slice(1).map((record) => {
    const cells = {}
    record.forEach((raw, idx) => {
      const v = raw.trim()
      if (v === '' || !columns[idx]) return
      cells[columns[idx].id] = inferred[idx].conv(v)
    })
    return { id: nanoid(10), cells }
  })

  return { schema: { columns }, rows, issues }
}
