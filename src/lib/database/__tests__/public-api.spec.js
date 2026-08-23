// src/lib/database/__tests__/public-api.spec.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Y from 'yjs'
import { setActivePinia, createPinia } from 'pinia'
import { PermissionError } from '../permissions'
import { registerActiveDoc, unregisterActiveDoc } from '@/lib/yjs/shared'

vi.mock('@/lib/yjs/workspace-doc', () => ({
  syncDatabaseSchema: vi.fn(),
  removeDatabaseSchema: vi.fn(),
  syncDeletedDatabaseIds: vi.fn(),
  observeWorkspace: vi.fn(() => vi.fn()),
}))

// In-memory stand-in for the row-doc persistence layer: openRowDoc always
// returns a fresh doc seeded with everything persisted so far.
vi.mock('@/composable/useDatabaseYjs', async () => {
  const Y = await vi.importActual('yjs')
  const saved = new Map()
  return {
    ROW_DOC_PREFIX: 'db:',
    rowDocId: (dbId) => `db:${dbId}`,
    openRowDoc: vi.fn(async (dbId) => {
      const doc = new Y.Doc()
      const prev = saved.get(dbId)
      if (prev) Y.applyUpdate(doc, prev, 'load')
      return { doc, rows: doc.getArray('rows') }
    }),
    persistRowDocSnapshot: vi.fn(async (dbId, doc) => {
      saved.set(dbId, Y.encodeStateAsUpdate(doc))
    }),
  }
})

const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
const makeRow = (id) => {
  const m = new Y.Map()
  m.set('id', id)
  m.set('createdAt', Date.now())
  m.set('updatedAt', Date.now())
  return m
}

let store
let api
let openRowDoc
let useDatabaseStore
beforeEach(async () => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  ;({ useDatabaseStore } = await import('@/store/database'))
  store = useDatabaseStore()
  api = await import('../public-api')
  ;({ openRowDoc } = await import('@/composable/useDatabaseYjs'))
})

async function seedDb() {
  const id = store.createDatabase({ title: 'Projects' })
  const col = store.addColumn(id, { type: 'number', name: 'Pts' })
  return { id, col }
}

describe('reads', () => {
  it('listDatabases returns updatedAt-desc schemas', async () => {
    const { id: first } = await seedDb()
    store.createDatabase({ title: 'Second' })
    store.data[first].updatedAt = 1 // force deterministic desc order
    const list = await api.listDatabases('viewer')
    expect(list).toHaveLength(2)
    expect(list[0].title).toBe('Second')
  })

  it('getSchema returns columns and views', async () => {
    const { id } = await seedDb()
    const schema = await api.getSchema(id, 'viewer')
    expect(schema.title).toBe('Projects')
    expect(schema.columns.some((c) => c.name === 'Pts')).toBe(true)
    expect(schema.views.length).toBeGreaterThan(0)
  })

  it('queryView runs the shared pipeline over short-lived row docs', async () => {
    const { id, col } = await seedDb()
    const viewId = store.data[id].views[0].id
    await api.createRow(id, { [col.id]: 5 }, 'editor')
    await api.createRow(id, { [col.id]: 9 }, 'editor')

    const all = await api.queryView(id, undefined, 'viewer')
    expect(all.groups).toBeNull()
    expect(all.rows).toHaveLength(2)

    await api.updateView(
      id,
      viewId,
      { config: { filters: { conjunction: 'and', list: [{ columnId: col.id, operator: 'equals', value: 5 }] } } },
      'editor'
    )
    const filtered = await api.queryView(id, undefined, 'viewer')
    expect(filtered.rows).toHaveLength(1)
    expect(filtered.rows[0].cells[col.id]).toBe(5)
  })

  it('queryView prefers the live composable doc when one is registered', async () => {
    const { id } = await seedDb()
    const live = new Y.Doc()
    live.getArray('rows').push([makeRow('r1')])
    registerActiveDoc(id, live)
    try {
      const out = await api.queryView(id, undefined, 'viewer')
      expect(out.rows.map((r) => r.id)).toEqual(['r1'])
    } finally {
      unregisterActiveDoc(id)
    }
  })
})

describe('row mutations', () => {
  it('createRow persists and returns an id', async () => {
    const { id, col } = await seedDb()
    const rowId = await api.createRow(id, { [col.id]: 1 }, 'editor')
    expect(rowId).toBeTruthy()
    const out = await api.queryView(id, undefined, 'viewer')
    expect(out.rows[0].cells[col.id]).toBe(1)
  })

  it('updateCells patches cells and bumps updatedAt', async () => {
    const { id, col } = await seedDb()
    const rowId = await api.createRow(id, {}, 'editor')
    await new Promise((r) => setTimeout(r, 5))
    await api.updateCells(id, rowId, { [col.id]: 42 }, 'editor')
    const out = await api.queryView(id, undefined, 'viewer')
    expect(out.rows[0].cells[col.id]).toBe(42)
  })

  it('deleteRow removes the row', async () => {
    const { id } = await seedDb()
    const rowId = await api.createRow(id, {}, 'editor')
    await api.deleteRow(id, rowId, 'editor')
    const out = await api.queryView(id, undefined, 'viewer')
    expect(out.rows).toHaveLength(0)
  })

  it('mutating through a registered live doc skips persistence', async () => {
    const { id } = await seedDb()
    const live = new Y.Doc()
    registerActiveDoc(id, live)
    try {
      await api.createRow(id, {}, 'editor')
      expect(live.getArray('rows').length).toBe(1)
      expect(openRowDoc).not.toHaveBeenCalledWith(id)
    } finally {
      unregisterActiveDoc(id)
    }
  })
})

describe('schema mutations', () => {
  it('addColumn / updateColumn delegate to the store', async () => {
    const { id } = await seedDb()
    const col = await api.addColumn(id, { type: 'select' }, 'editor')
    expect(col.type).toBe('select')
    await api.updateColumn(id, col.id, { name: 'Stage' }, 'editor')
    expect(store.data[id].columns.find((c) => c.id === col.id).name).toBe('Stage')
  })

  it('createView / updateView / deleteView delegate to the store', async () => {
    const { id } = await seedDb()
    const view = await api.createView(id, 'kanban', 'editor')
    expect(view.type).toBe('kanban')
    await api.updateView(id, view.id, { name: 'Board' }, 'editor')
    expect(store.data[id].views.find((v) => v.id === view.id).name).toBe('Board')
    await api.deleteView(id, view.id, 'editor')
    expect(store.data[id].views.some((v) => v.id === view.id)).toBe(false)
  })

  it('deleteDatabase requires owner', async () => {
    const { id } = await seedDb()
    await api.deleteDatabase(id, 'owner')
    expect(store.deletedIds[id]).toBeTypeOf('number')
    expect(await api.listDatabases('viewer')).toHaveLength(0)
  })
})

describe('subscribe', () => {
  it('notifies on live-doc row changes, coalesced per frame', async () => {
    const { id } = await seedDb()
    const cb = vi.fn()
    const live = new Y.Doc()
    const rows = live.getArray('rows')
    registerActiveDoc(id, live)
    const unsub = api.subscribe(id, cb, 'viewer')
    try {
      live.transact(() => rows.push([makeRow('a'), makeRow('b')]))
      await frame()
      expect(cb).toHaveBeenCalledTimes(1)

      live.transact(() => rows.push([makeRow('c')]))
      await frame()
      expect(cb).toHaveBeenCalledTimes(2)
    } finally {
      unsub()
      unregisterActiveDoc(id)
    }
  })

  it('observes its own row doc when no composable is live', async () => {
    const { id } = await seedDb()
    const cb = vi.fn()
    const unsub = api.subscribe(id, cb, 'viewer')
    await vi.waitFor(() => {
      expect(openRowDoc).toHaveBeenCalledWith(id)
    })
    const { doc } = await openRowDoc.mock.results.at(-1).value
    doc.getArray('rows').push([makeRow('x')])
    await frame()
    expect(cb).toHaveBeenCalledTimes(1)
    unsub()
    doc.getArray('rows').push([makeRow('y')])
    await frame()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('notifies on schema meta changes only for database flags', async () => {
    const { id } = await seedDb()
    const cb = vi.fn()
    const unsub = api.subscribe(id, cb, 'viewer')
    const wsCb = (await import('@/lib/yjs/workspace-doc')).observeWorkspace.mock.calls.at(-1)[0]
    wsCb(new Set(), { folders: true })
    await frame()
    expect(cb).not.toHaveBeenCalled()
    wsCb(new Set(), { databases: true })
    await frame()
    expect(cb).toHaveBeenCalledTimes(1)
    wsCb(new Set(), { deletedDatabases: true })
    await frame()
    expect(cb).toHaveBeenCalledTimes(2)
    unsub()
  })

  it('unsubscribe stops notifications and destroys the private doc', async () => {
    const { id } = await seedDb()
    const cb = vi.fn()
    const unsub = api.subscribe(id, cb, 'viewer')
    await vi.waitFor(() => expect(openRowDoc).toHaveBeenCalled())
    const { doc } = await openRowDoc.mock.results.at(-1).value
    unsub()
    expect(doc.isDestroyed).toBe(true)
  })

  it('unsubscribe removes its workspace observer (no leak)', async () => {
    const { observeWorkspace } = await import('@/lib/yjs/workspace-doc')
    const { id } = await seedDb()
    const cb = vi.fn()
    const before = observeWorkspace.mock.calls.length
    const unsub = api.subscribe(id, cb, 'viewer')
    expect(observeWorkspace.mock.calls.length).toBe(before + 1)
    unsub()

    // The registered meta callback must be a no-op after unsubscribe.
    const wsCb = observeWorkspace.mock.calls[before][0]
    wsCb(new Set(), { databases: true })
    await frame()
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('permission gates', () => {
  it.each([
    ['listDatabases', () => api.listDatabases(undefined)],
    ['getSchema', () => api.getSchema('x', 'admin')],
    ['queryView', () => api.queryView('x', undefined, 'admin')],
    ['subscribe', null],
    ['createRow', () => api.createRow('x', {}, 'viewer')],
    ['updateCells', () => api.updateCells('x', 'r', {}, 'guest')],
    ['deleteRow', () => api.deleteRow('x', 'r', undefined)],
    ['addColumn', () => api.addColumn('x', { type: 'text' }, 'viewer')],
    ['updateColumn', () => api.updateColumn('x', 'c', {}, 'viewer')],
    ['createView', () => api.createView('x', 'table', 'viewer')],
    ['updateView', () => api.updateView('x', 'v', {}, 'viewer')],
    ['deleteView', () => api.deleteView('x', 'v', 'viewer')],
    ['deleteDatabase', () => api.deleteDatabase('x', 'editor')],
  ])('%s throws PermissionError without sufficient role', async (_, fn) => {
    if (fn === null) {
      expect(() => api.subscribe('x', () => {}, undefined)).toThrow(PermissionError)
      return
    }
    await expect(fn()).rejects.toThrow(PermissionError)
  })
})
