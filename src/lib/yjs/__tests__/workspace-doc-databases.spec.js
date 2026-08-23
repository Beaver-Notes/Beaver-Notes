import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { getWorkspaceDoc, transactWorkspace, syncDatabaseSchema, removeDatabaseSchema, syncDeletedDatabaseIds, syncNoteMeta } from '@/lib/yjs/workspace-doc'
import { writeStoresFromWorkspace } from '@/lib/yjs/meta-store'

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

  it('inDatabase flag survives add → syncNoteMeta → hydrate (Delta 3)', async () => {
    setActivePinia(createPinia())
    const { useNoteStore } = await import('@/store/note')
    const noteStore = useNoteStore()
    const now = Date.now()
    noteStore.$patch({
      data: {
        rownote: {
          id: 'rownote',
          title: 'Row backing note',
          content: { type: 'doc', content: [] },
          labels: [],
          createdAt: now,
          updatedAt: now,
          isBookmarked: false,
          isArchived: false,
          isLocked: false,
          isFullWidth: false,
          folderId: null,
          cardPreview: { version: 1, blocks: [], hasMore: false, mediaCount: 0, visibleMediaCount: 0 },
          inDatabase: true,
        },
      },
    })

    syncNoteMeta(noteStore.data.rownote)
    delete noteStore.data.rownote // prove the flag is restored from the doc

    await writeStoresFromWorkspace()
    expect(noteStore.data.rownote?.inDatabase).toBe(true)

    transactWorkspace(() => getWorkspaceDoc().getMap('notes').delete('rownote'))
  })
})
