import { describe, it, expect, beforeEach } from 'vitest'
import { getWorkspaceDoc, transactWorkspace, syncDatabaseSchema, removeDatabaseSchema, syncDeletedDatabaseIds } from '@/lib/yjs/workspace-doc'

const db = (id) => ({ id, title: id, icon: 'riLayoutGridLine', columns: [], views: [], deletedColumnIds: {}, lastViewId: null, createdAt: 1, updatedAt: 1 })

describe('workspace database schema sync', () => {
  beforeEach(() => {
    transactWorkspace(() => {
      getWorkspaceDoc().getMap('databases').clear()
      getWorkspaceDoc().getMap('deletedDatabaseIds').clear()
    })
  })
  it('round-trips a schema', () => {
    syncDatabaseSchema(db('db1'))
    expect(getWorkspaceDoc().getMap('databases').get('db1').toJSON().id).toBe('db1')
    removeDatabaseSchema('db1')
    expect(getWorkspaceDoc().getMap('databases').get('db1')).toBeUndefined()
  })
  it('tombstones deletions minimally', () => {
    syncDeletedDatabaseIds({ a: 1 })
    expect(Object.keys(getWorkspaceDoc().getMap('deletedDatabaseIds').toJSON())).toEqual(['a'])
  })
})
