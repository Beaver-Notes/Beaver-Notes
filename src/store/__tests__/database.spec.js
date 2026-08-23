import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Y from 'yjs'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/yjs/workspace-doc', () => ({
  syncDatabaseSchema: vi.fn(),
  removeDatabaseSchema: vi.fn(),
  syncDeletedDatabaseIds: vi.fn(),
  observeWorkspace: vi.fn(),
}))

// openRowDoc serves a per-dbId in-memory doc so deleteDatabase can read rows.
const rowDocs = vi.hoisted(() => new Map())
vi.mock('@/composable/useDatabaseYjs', async () => {
  const Y = await vi.importActual('yjs')
  return {
    openRowDoc: vi.fn(async (dbId) => {
      let doc = rowDocs.get(dbId)
      if (!doc) {
        doc = new Y.Doc()
        rowDocs.set(dbId, doc)
      }
      return { doc, rows: doc.getArray('rows') }
    }),
  }
})

function seedRow(doc, id, noteId) {
  const row = new Y.Map()
  row.set('id', id)
  row.set('createdAt', Date.now())
  row.set('updatedAt', Date.now())
  if (noteId) row.set('noteId', noteId)
  doc.getArray('rows').push([row])
}

let useDatabaseStore
beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  ;({ useDatabaseStore } = await import('@/store/database'))
})

describe('database store', () => {
  it('creates, updates, deletes with tombstone', async () => {
    const store = useDatabaseStore()
    const id = store.createDatabase({ title: 'Projects' })
    expect(store.data[id].title).toBe('Projects')
    expect(store.databases).toHaveLength(1)

    store.updateSchema(id, { title: 'Renamed' })
    expect(store.data[id].title).toBe('Renamed')

    await store.deleteDatabase(id)
    expect(store.data[id]).toBeUndefined()
    expect(store.deletedIds[id]).toBeTypeOf('number')
  })

  it('columns: add, update, remove leaves tombstone', () => {
    const store = useDatabaseStore()
    const id = store.createDatabase({})
    const col = store.addColumn(id, { type: 'number', name: 'Pts' })
    expect(store.data[id].columns.find((c) => c.id === col.id).type).toBe('number')

    store.updateColumn(id, col.id, { name: 'Points' })
    expect(store.data[id].columns.find((c) => c.id === col.id).name).toBe('Points')

    store.removeColumn(id, col.id)
    expect(store.data[id].columns.find((c) => c.id === col.id)).toBeUndefined()
    expect(store.data[id].deletedColumnIds[col.id]).toBeTypeOf('number')
  })

  it('views: create typed defaults, never delete the last one', () => {
    const store = useDatabaseStore()
    const id = store.createDatabase({})
    const schema = store.data[id]
    expect(schema.views).toHaveLength(1) // initial table view from createDatabaseSchema

    const kanban = store.createView(id, 'kanban')
    expect(kanban.type).toBe('kanban')
    expect(kanban.config.groupColumnId).toBeDefined()

    store.setLastView(id, kanban.id)
    expect(store.data[id].lastViewId).toBe(kanban.id)

    store.deleteView(id, kanban.id)
    store.deleteView(id, schema.views[0].id) // would leave zero
    expect(store.data[id].views).toHaveLength(1)
  })

  it('deleteDatabase cascades materialized backing notes', async () => {
    const { useNoteStore } = await import('@/store/note')
    const noteStore = useNoteStore()
    const now = Date.now()
    const base = {
      content: { type: 'doc', content: [] },
      labels: [],
      createdAt: now,
      updatedAt: now,
      isBookmarked: false,
      isArchived: false,
      isLocked: false,
      isFullWidth: false,
      folderId: null,
    }
    noteStore.$patch({
      data: {
        note1: { ...base, id: 'note1', title: 'Backed' },
        keep: { ...base, id: 'keep', title: 'Unrelated' },
      },
    })

    const store = useDatabaseStore()
    const id = store.createDatabase({ title: 'Doomed' })
    const { doc } = await (await import('@/composable/useDatabaseYjs')).openRowDoc(id)
    seedRow(doc, 'r1', 'note1')
    seedRow(doc, 'r2', null)
    seedRow(doc, 'r3', 'missing-note')

    await store.deleteDatabase(id)

    expect(noteStore.getById('note1')).toBeUndefined()
    expect(noteStore.getById('keep')).toBeTruthy()
    expect(store.deletedIds[id]).toBeTypeOf('number')
  })
})
