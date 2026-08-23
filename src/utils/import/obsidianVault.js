import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { nanoid } from 'nanoid'
import { createColumn, createView } from '../../lib/database/schema'
import { defaultViewConfig } from '../../lib/database/view-engine'
import { makeOptions } from './notionCsv'

dayjs.extend(customParseFormat)

const DATE_FORMATS = ['YYYY-MM-DD', 'YYYY/MM/DD', 'M/D/YYYY', 'MMMM D, YYYY', 'MMM D, YYYY']
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
const BOOL_TRUE = /^(true|yes)$/i

function stripQuotes(s) {
  return s.replace(/^["']|["']$/g, '').trim()
}

// Naive YAML frontmatter: top-level `key: value`, `- item` lists, inline [a,b]; nested maps ignored
export function frontmatterOf(content) {
  const text = String(content ?? '')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!m) return { fm: {}, body: text }
  const fm = {}
  let lastKey = null
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/)
    if (item && lastKey) {
      const prev = fm[lastKey]
      const list = Array.isArray(prev) ? prev : prev !== '' && prev != null ? [String(prev)] : []
      list.push(stripQuotes(item[1]))
      fm[lastKey] = list
      continue
    }
    const kv = line.match(/^([^\s:#][^:#]*):\s*(.*)$/)
    if (kv && !/^\s/.test(line)) {
      lastKey = kv[1].trim()
      const v = kv[2].trim()
      fm[lastKey] = /^\[.*\]$/.test(v)
        ? v.slice(1, -1).split(',').map((p) => stripQuotes(p.trim())).filter(Boolean)
        : stripQuotes(v)
    }
  }
  return { fm, body: text.slice(m[0].length) }
}

function parseDate(s) {
  const d = dayjs(s, DATE_FORMATS, true)
  return d.isValid() ? d.format('YYYY-MM-DD') : null
}

const asList = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()) : String(v).split(',').map((s) => s.trim()))
const hasLinks = (v) => new RegExp(WIKILINK_RE.source).test(String(v))

export function parseObsidianVault(files) {
  const issues = []
  const docs = []
  let skipped = 0
  for (const file of files ?? []) {
    if (!/\.md$/i.test(file.name ?? '')) { skipped++; continue }
    const { fm, body } = frontmatterOf(file.content)
    docs.push({ title: file.name.replace(/\.[^/]*$/, '').split('/').pop(), fm, body })
  }
  if (skipped) issues.push(`Skipped ${skipped} non-markdown file${skipped > 1 ? 's' : ''}`)

  const keys = [...new Set(docs.flatMap((d) => Object.keys(d.fm)))]
  const valuesOf = (key) => docs.flatMap((d) => (d.fm[key] == null || d.fm[key] === '' ? [] : asList(d.fm[key]))).filter(Boolean)
  const all = (vals, test) => vals.length > 0 && vals.every(test)

  // ponytail: all-values-must-match typing; mixed columns fall back to rich_text/multi_select rather than coercing per-cell
  const types = {}
  for (const key of keys) {
    const vals = valuesOf(key)
    if (all(vals, hasLinks)) { types[key] = 'relation'; continue }
    if (key.toLowerCase() === 'tags' || docs.some((d) => Array.isArray(d.fm[key]))) { types[key] = 'multi_select'; continue }
    if (vals.every((v) => /^(true|false|yes|no)$/i.test(v))) { types[key] = 'checkbox'; continue }
    if (all(vals, parseDate)) { types[key] = 'date'; continue }
    if (all(vals, (v) => v !== '' && Number.isFinite(Number(v)))) { types[key] = 'number'; continue }
    if (vals.some((v) => v.includes(',') || hasLinks(v))) { types[key] = 'multi_select'; continue }
    types[key] = 'rich_text'
  }

  const titleCol = createColumn('title', 'Name')
  const columns = [titleCol]
  const colByName = { Name: titleCol }
  for (const key of keys) {
    const col = createColumn(types[key], key)
    if (types[key] === 'multi_select') col.config.options = makeOptions(valuesOf(key))
    columns.push(col)
    colByName[key] = col
  }

  const bodyHasLinks = docs.some((d) => d.body.includes('[['))
  if (bodyHasLinks) {
    const links = createColumn('relation', 'Links')
    columns.push(links)
    colByName.Links = links
  }

  const rowIds = docs.map(() => nanoid(10))
  const idByTitle = {}
  let dupTitles = 0
  const seenTitles = new Set()
  docs.forEach((d, i) => {
    if (seenTitles.has(d.title)) dupTitles++
    seenTitles.add(d.title)
    if (!(d.title in idByTitle)) idByTitle[d.title] = rowIds[i]
  })
  if (dupTitles) issues.push(`${dupTitles} note${dupTitles > 1 ? 's' : ''} share a filename with another note; links resolve to the first match`)

  const rows = docs.map((d, i) => {
    const cells = { [titleCol.id]: d.title }
    for (const key of keys) {
      const raw = d.fm[key]
      if (raw == null || raw === '') continue
      const col = colByName[key]
      if (types[key] === 'multi_select') { cells[col.id] = asList(raw).filter(Boolean); continue }
      const v = Array.isArray(raw) ? raw.join(', ') : String(raw).trim()
      if (types[key] === 'checkbox') cells[col.id] = BOOL_TRUE.test(v)
      else if (types[key] === 'date') cells[col.id] = { start: parseDate(v) }
      else if (types[key] === 'number') cells[col.id] = Number(v)
      else if (types[key] === 'relation') {
        const targets = [...v.matchAll(new RegExp(WIKILINK_RE.source, 'g'))].map((m2) => m2[1].trim())
        cells[col.id] = targets.length > 1 ? targets.map((t) => idByTitle[t] ?? t) : (idByTitle[targets[0]] ?? targets[0])
      } else cells[col.id] = v
    }
    if (bodyHasLinks) {
      const links = [...d.body.matchAll(new RegExp(WIKILINK_RE.source, 'g'))].map((m2) => m2[1].trim())
      if (links.length) cells[colByName.Links.id] = links.map((t) => idByTitle[t] ?? t)
    }
    return { id: rowIds[i], cells }
  })

  const folders = [...new Set((files ?? []).flatMap((f) => (f.name?.includes('/') ? [f.name.split('/').slice(0, -1).join('/')] : [])))]
  if (folders.length) issues.push(`Notes span ${folders.length} folder${folders.length > 1 ? 's' : ''} (${folders.join(', ')}) — consider grouping views by folder`)
  return { schema: { columns }, rows, issues }
}

const DB_TYPE_MAP = {
  file: 'title', media: 'files', text: 'rich_text', string: 'rich_text', number: 'number',
  select: 'select', multiselect: 'multi_select', multi_select: 'multi_select', status: 'status',
  date: 'date', datetime: 'date', checkbox: 'checkbox', bool: 'checkbox', boolean: 'checkbox',
  url: 'url', link: 'url', email: 'email', phone: 'phone_number', phone_number: 'phone_number',
  relation: 'relation', formula: 'formula', rollup: 'rollup',
}
const VIEW_MAP = { table: 'table', board: 'kanban', kanban: 'kanban', calendar: 'calendar' }

export function parseObsidianDatabaseJson(jsonText) {
  const raw = JSON.parse(jsonText)
  const issues = []
  const columns = (raw.columns ?? []).map((c) => {
    const mapped = DB_TYPE_MAP[String(c.type ?? '').toLowerCase()]
    if (!mapped) issues.push(`Column "${c.name}" has unsupported type "${c.type}"; imported as rich_text`)
    const col = createColumn(mapped ?? 'rich_text', c.name ?? '')
    if (Array.isArray(c.options)) {
      // preserve provided colors; fill gaps from the palette
      const opts = makeOptions(c.options.filter((o) => o && o.name != null).map((o) => String(o.name)))
      c.options.forEach((o, i) => { if (o?.color && opts[i]) opts[i].color = o.color })
      col.config.options = opts
    }
    return col
  })

  const byName = Object.fromEntries(columns.map((c) => [c.name, c]))
  const rows = (raw.rows ?? []).map((r) => {
    const src = r.cells ?? r
    const cells = {}
    for (const [k, v] of Object.entries(src ?? {})) {
      const col = byName[k]
      if (!col) { issues.push(`Row value "${k}" matched no column and was skipped`); continue }
      cells[col.id] = v
    }
    return { id: nanoid(10), cells }
  })

  const views = []
  for (const v of raw.views ?? []) {
    const type = VIEW_MAP[String(v.type ?? '').toLowerCase()]
    if (!type) { issues.push(`View "${v.name || v.type}" is not importable and was skipped`); continue }
    if (type === 'kanban' && !columns.some((c) => ['select', 'status'].includes(c.type))) { issues.push('Kanban view skipped: no select/status column found'); continue }
    if (type === 'calendar' && !columns.some((c) => c.type === 'date')) { issues.push('Calendar view skipped: no date column found'); continue }
    const view = createView(type)
    view.config = { ...view.config, ...defaultViewConfig(type, columns) }
    views.push(view)
  }
  if (!views.some((v) => v.type === 'table')) views.unshift(createView('table'))

  return { schema: { columns, views }, rows, issues }
}
