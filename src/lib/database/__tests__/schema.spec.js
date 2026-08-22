// src/lib/database/__tests__/schema.spec.js
import { describe,it,expect } from 'vitest'
import { COLUMN_TYPES, VIEW_TYPES, VIEW_ICONS, createColumn, createDatabase, createView, isDeleted } from '../schema'

describe('schema', () => {
  it('exposes the 22 Notion property types', () => {
    expect(COLUMN_TYPES).toHaveLength(22)
    expect(COLUMN_TYPES[0]).toBe('title')
  })
  it('creates columns with defaults', () => {
    const c = createColumn('select','Status')
    expect(c.id).toHaveLength(10)
    expect(c.config.options).toEqual([])
    expect(() => createColumn('nope','X')).toThrow()
    expect(createColumn('title','Name').config).toEqual({})
  })
  it('creates a database with primary title column, one table view', () => {
    const db = createDatabase({ title: 'Tasks' })
    expect(db.columns[0].type).toBe('title')
    expect(db.primaryColumnId).toBe(db.columns[0].id)
    expect(db.views).toHaveLength(1)
    expect(db.views[0].type).toBe('table')
    expect(db.lastViewId).toBeNull()
    expect(db.deletedColumnIds).toEqual({})
  })
  it('creates views per type with default configs and tombstones columns', () => {
    const db = createDatabase({ title: 'T' })
    db.views.push(createView('kanban'))
    expect(db.views[1].config.groupColumnId).toBeNull()
    for (const t of VIEW_TYPES) expect(VIEW_ICONS[t]).toMatch(/^ri/)
    db.deletedColumnIds[db.columns[0].id] = Date.now()
    expect(isDeleted(db, db.columns[0].id)).toBe(true)
  })
})
