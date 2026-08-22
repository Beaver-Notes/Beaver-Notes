import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/yjs/workspace-doc', () => ({
  syncDatabaseSchema: vi.fn(),
  removeDatabaseSchema: vi.fn(),
  syncDeletedDatabaseIds: vi.fn(),
  observeWorkspace: vi.fn(),
}))

let useDatabaseStore
beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  ;({ useDatabaseStore } = await import('@/store/database'))
})

describe('database store', () => {
  it('creates, updates, deletes with tombstone', () => {
    const store = useDatabaseStore()
    const id = store.createDatabase({ title: 'Projects' })
    expect(store.data[id].title).toBe('Projects')
    expect(store.databases).toHaveLength(1)

    store.updateSchema(id, { title: 'Renamed' })
    expect(store.data[id].title).toBe('Renamed')

    store.deleteDatabase(id)
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
})
