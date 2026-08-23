import { describe, it, expect } from 'vitest'
import { parseNotionCsv } from '../notionCsv'

const CSV = [
  'Name,Status,Tags,Due,Points,Done,Site,Notes',
  'Project A,In Progress,"web, design",2026-01-02,3,Yes,https://alpha.dev,"Said ""hi""',
  'Line two"',
  'Project B,Done,web,2026-02-03,5.5,No,https://beta.example.org,A longer sentence that clearly exceeds forty characters',
  'Project C,Todo,,2026-03-04,2,false,,Another prose note long enough to be excluded from select options'
].join('\n')

const byName = (schema) => Object.fromEntries(schema.columns.map((c) => [c.name, c]))

describe('parseNotionCsv', () => {
  it('parses RFC4180 quoted fields with escaped quotes and embedded newlines', () => {
    const { rows, schema } = parseNotionCsv(CSV)
    expect(rows).toHaveLength(3)
    const notes = byName(schema).Notes
    expect(rows[0].cells[notes.id]).toBe('Said "hi"\nLine two')
  })

  it('detects the title column by header name', () => {
    const { schema } = parseNotionCsv(CSV)
    expect(schema.columns[0].name).toBe('Name')
    expect(schema.columns[0].type).toBe('title')
  })

  it('falls back to the first column when no Name/Title header exists', () => {
    const { schema } = parseNotionCsv('ID,Score\na,1\nb,2\n')
    expect(schema.columns[0]).toMatchObject({ name: 'ID', type: 'title' })
  })

  it('infers types per column: date, number, checkbox, url, select, multi_select, rich_text', () => {
    const { schema } = parseNotionCsv(CSV)
    const t = byName(schema)
    expect(t.Due.type).toBe('date')
    expect(t.Points.type).toBe('number')
    expect(t.Done.type).toBe('checkbox')
    expect(t.Site.type).toBe('url')
    expect(t.Status.type).toBe('select')
    expect(t.Tags.type).toBe('multi_select')
    expect(t.Notes.type).toBe('rich_text')
  })

  it('builds select options from unique values with cycling palette colors', () => {
    const { schema } = parseNotionCsv(CSV)
    const status = byName(schema).Status
    expect(status.config.options.map((o) => o.name)).toEqual(['In Progress', 'Done', 'Todo'])
    expect(new Set(status.config.options.map((o) => o.color))).toHaveLength(3)
    expect(status.config.options.every((o) => o.id && o.name && o.color)).toBe(true)
  })

  it('unions comma-separated cell values into multi_select options', () => {
    const { schema } = parseNotionCsv(CSV)
    const tags = byName(schema).Tags
    expect(tags.config.options.map((o) => o.name)).toEqual(['web', 'design'])
    expect(schema.columns.every((c) => c.id)).toBe(true)
  })

  it('converts cell values to canonical shapes keyed by column id', () => {
    const { rows, schema } = parseNotionCsv(CSV)
    const t = byName(schema)
    const rowA = rows[0]
    expect(rowA.cells[t.Points.id]).toBe(3)
    expect(rowA.cells[t.Done.id]).toBe(true)
    expect(rowA.cells[t.Due.id]).toEqual({ start: '2026-01-02' })
    expect(rowA.cells[t.Status.id]).toBe('In Progress')
    expect(rowA.cells[t.Tags.id]).toEqual(['web', 'design'])
    expect(rows[2].cells[t.Done.id]).toBe(false)
    expect(rows[1].cells[t.Points.id]).toBe(5.5)
  })

  it('forces computed columns to rich_text and records an issue', () => {
    const csv = 'Task,Calc\nA,10 pts\nB,20 pts\n'
    const { schema, issues } = parseNotionCsv(csv, { computedColumns: ['Calc'] })
    expect(byName(schema).Calc.type).toBe('rich_text')
    expect(issues.some((i) => i.includes('Calc'))).toBe(true)
  })

  it('returns no rows for header-only input without throwing', () => {
    const { schema, rows, issues } = parseNotionCsv('Name,Status\n')
    expect(schema.columns.map((c) => c.name)).toEqual(['Name', 'Status'])
    expect(rows).toEqual([])
    expect(Array.isArray(issues)).toBe(true)
  })
})
