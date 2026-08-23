import { describe, it, expect } from 'vitest'
import { parseObsidianVault, parseObsidianDatabaseJson } from '../obsidianVault'

const alpha = {
  name: 'Books/Alpha.md',
  content: [
    '---',
    'tags: [reading, sci-fi]',
    'rating: 4',
    'read: true',
    'published: 2026-01-05',
    'up: "[[Beta]]"',
    'aliases:',
    '  - Al',
    '---',
    'Body linking [[Gamma]] and [[Beta]].'
  ].join('\n')
}

const beta = {
  name: 'Books/Beta.md',
  content: [
    '---',
    'tags: reading',
    'rating: 4.5',
    'read: false',
    'up: "[[Alpha]]"',
    'deep:',
    '  nested: ignored',
    '---',
    '# Beta'
  ].join('\n')
}

const gamma = { name: 'Journal/Gamma.md', content: '---\nrating: notanumber\n---\nplain body' }

const files = [alpha, beta, gamma]

describe('parseObsidianVault', () => {
  it('uses the filename minus .md as title cells', () => {
    const { rows, schema } = parseObsidianVault(files)
    expect(rows).toHaveLength(3)
    const title = schema.columns.find((c) => c.type === 'title')
    expect(title.name).toBe('Name')
    expect(rows.map((r) => r.cells[title.id]).sort()).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('infers frontmatter column types across files', () => {
    const { schema } = parseObsidianVault(files)
    const t = Object.fromEntries(schema.columns.map((c) => [c.name, c]))
    expect(t.tags.type).toBe('multi_select')
    expect(t.rating.type).toBe('rich_text')
    expect(t.read.type).toBe('checkbox')
    expect(t.published.type).toBe('date')
    expect(t.up.type).toBe('relation')
    expect(t.aliases.type).toBe('multi_select')
  })

  it('converts values: arrays to multi_select names, booleans, dates', () => {
    const { rows, schema } = parseObsidianVault(files)
    const t = Object.fromEntries(schema.columns.map((c) => [c.name, c]))
    const a = rows.find((r) => r.cells[t.tags.id]?.includes('sci-fi')) || rows[0]
    expect(a.cells[t.tags.id]).toEqual(['reading', 'sci-fi'])
    expect(a.cells[t.published.id]).toEqual({ start: '2026-01-05' })
    expect(Object.values(a.cells)).toContain(true)
  })

  it('resolves wikilink relation stubs to imported row ids in a second pass', () => {
    const { rows, schema } = parseObsidianVault(files)
    const titleCol = schema.columns.find((c) => c.type === 'title')
    const idByTitle = Object.fromEntries(rows.map((r) => [r.cells[titleCol.id], r.id]))
    const up = schema.columns.find((c) => c.name === 'up')
    const a = rows.find((r) => r.cells[titleCol.id] === 'Alpha')
    const b = rows.find((r) => r.cells[titleCol.id] === 'Beta')
    expect(a.cells[up.id]).toBe(idByTitle.Beta)
    expect(b.cells[up.id]).toBe(idByTitle.Alpha)
  })

  it('collects body wikilinks into a Links relation column with resolved ids', () => {
    const { rows, schema } = parseObsidianVault(files)
    const titleCol = schema.columns.find((c) => c.type === 'title')
    const links = schema.columns.find((c) => c.name === 'Links')
    expect(links?.type).toBe('relation')
    const idByTitle = Object.fromEntries(rows.map((r) => [r.cells[titleCol.id], r.id]))
    const a = rows.find((r) => r.cells[titleCol.id] === 'Alpha')
    expect(a.cells[links.id].sort()).toEqual([idByTitle.Gamma, idByTitle.Beta].sort())
  })

  it('ignores non-markdown files and suggests folder grouping via issues', () => {
    const { issues } = parseObsidianVault([...files, { name: 'notes.txt', content: 'x' }])
    expect(issues.some((i) => i.includes('.txt') || i.toLowerCase().includes('skipped'))).toBe(true)
    expect(issues.some((i) => i.toLowerCase().includes('folder'))).toBe(true)
  })

  it('returns an empty schema for no input', () => {
    const out = parseObsidianVault([])
    expect(out.rows).toEqual([])
    expect(out.schema.columns.filter((c) => c.type !== 'title')).toEqual([])
  })
})

const dbJson = JSON.stringify({
  name: 'Reading',
  columns: [
    { name: 'Cover', type: 'file' },
    { name: 'Title', type: 'text' },
    { name: 'Rating', type: 'number' },
    { name: 'State', type: 'select', options: [{ name: 'Read', color: 'green' }, { name: 'Wish' }] },
    { name: 'Finished', type: 'date' },
    { name: 'Mystery', type: 'teleport' }
  ],
  rows: [{ cells: { Title: 'Dune', Rating: 5, State: 'Read', Finished: '2026-01-01' } }],
  views: [{ type: 'table' }, { type: 'kanban' }, { type: 'calendar' }, { type: 'gallery' }]
})

describe('parseObsidianDatabaseJson', () => {
  it('maps column types including file→title and unknown→rich_text with issue', () => {
    const { schema, issues } = parseObsidianDatabaseJson(dbJson)
    const t = Object.fromEntries(schema.columns.map((c) => [c.name, c]))
    expect(t.Cover.type).toBe('title')
    expect(t.Title.type).toBe('rich_text')
    expect(t.Rating.type).toBe('number')
    expect(t.Mystery.type).toBe('rich_text')
    expect(issues.some((i) => i.includes('Mystery'))).toBe(true)
  })

  it('keeps option colors and fills missing palette colors', () => {
    const { schema } = parseObsidianDatabaseJson(dbJson)
    const state = schema.columns.find((c) => c.name === 'State')
    expect(state.config.options).toHaveLength(2)
    expect(state.config.options[0]).toMatchObject({ name: 'Read', color: 'green' })
    expect(state.config.options[1].color).toBeTruthy()
  })

  it('remaps row cells to new column ids', () => {
    const { schema, rows } = parseObsidianDatabaseJson(dbJson)
    expect(rows).toHaveLength(1)
    const byId = Object.fromEntries(schema.columns.map((c) => [c.id, c.name]))
    const mapped = Object.fromEntries(Object.entries(rows[0].cells).map(([id, v]) => [byId[id], v]))
    expect(mapped).toMatchObject({ Title: 'Dune', Rating: 5, State: 'Read' })
  })

  it('maps compatible views only (table, kanban, calendar) and drops the rest with an issue', () => {
    const { schema, issues } = parseObsidianDatabaseJson(dbJson)
    const types = schema.views.map((v) => v.type).sort()
    expect(types).toEqual(['calendar', 'kanban', 'table'])
    expect(issues.some((i) => i.toLowerCase().includes('gallery'))).toBe(true)
    for (const v of schema.views) {
      expect(v.id).toBeTruthy()
      expect(v.icon).toBeTruthy()
      expect(v.config.filters).toEqual({ conjunction: 'and', list: [] })
    }
  })

  it('wires kanban grouping to a select column via default view config', () => {
    const { schema } = parseObsidianDatabaseJson(dbJson)
    const kanban = schema.views.find((v) => v.type === 'kanban')
    const state = schema.columns.find((c) => c.name === 'State')
    expect(kanban.config.groupColumnId).toBe(state.id)
  })

  it('throws on invalid JSON', () => {
    expect(() => parseObsidianDatabaseJson('{nope')).toThrow()
  })
})
