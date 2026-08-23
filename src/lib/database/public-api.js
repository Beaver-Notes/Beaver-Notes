// src/lib/database/public-api.js
//
// Extensibility facade over the databases feature (Delta 2). Pure ES-module
// exports; authorization is enforced here at the seam — every call must pass
// src/lib/database/permissions.js predicates or it throws PermissionError.
// Role resolution belongs to the caller: each function takes a trailing
// `role` argument (fail-closed when omitted).

import * as Y from 'yjs'
import { nanoid } from 'nanoid'
import { useDatabaseStore } from '@/store/database'
import { openRowDoc, persistRowDocSnapshot } from '@/composable/useDatabaseYjs'
import { getActiveDoc } from '@/lib/yjs/shared'
import { observeWorkspace } from '@/lib/yjs/workspace-doc'
import { runView } from './view-engine'
import { canView, canDeleteDb, assertCan, PermissionError } from './permissions'

export { PermissionError }

function requireViewable(role) {
  if (!canView(role)) throw new PermissionError("Requires 'viewer' role")
}

function requireOwner(role) {
  if (!canDeleteDb(role)) throw new PermissionError("Requires 'owner' role")
}

function store() {
  return useDatabaseStore()
}

const rowSnapshot = (m) => ({
  id: m.get('id'),
  cells: m.get('cells')?.toJSON() ?? {},
  noteId: m.get('noteId') ?? null,
  createdAt: m.get('createdAt'),
  updatedAt: m.get('updatedAt'),
})

// Run `fn(rows)` against the live composable doc when one is registered
// (the composable persists its own writes), else against a short-lived doc
// that is persisted and destroyed around the mutation.
async function withRows(dbId, fn) {
  const live = getActiveDoc(dbId)
  if (live) return fn(live.getArray('rows'))
  const { doc, rows } = await openRowDoc(dbId)
  try {
    const out = fn(rows)
    await persistRowDocSnapshot(dbId, doc)
    return out
  } finally {
    doc.destroy()
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listDatabases(role) {
  requireViewable(role)
  return store().databases
}

export async function getSchema(dbId, role) {
  requireViewable(role)
  return store().getById(dbId)
}

export async function queryView(dbId, viewId = null, role) {
  requireViewable(role)
  const schema = store().getById(dbId)
  if (!schema) throw new Error(`no such database: ${dbId}`)
  const view =
    schema.views.find((v) => v.id === (viewId || schema.lastViewId)) || schema.views[0]
  if (!view) return { rows: [], groups: null }
  const rows = await withRows(dbId, (arr) => arr.toArray().map(rowSnapshot))
  return runView(schema, view, rows)
}

// ── Row mutations ────────────────────────────────────────────────────────────

export async function createRow(dbId, cells = {}, role) {
  assertCan(role, 'editor')
  return withRows(dbId, (rows) => {
    const row = new Y.Map()
    rows.doc.transact(() => {
      row.set('id', nanoid())
      row.set('createdAt', Date.now())
      row.set('updatedAt', Date.now())
      const c = new Y.Map()
      for (const [k, v] of Object.entries(cells)) c.set(k, v)
      row.set('cells', c)
      rows.push([row])
    })
    return row.get('id')
  })
}

export async function updateCells(dbId, rowId, patch = {}, role) {
  assertCan(role, 'editor')
  await withRows(dbId, (rows) => {
    const row = rows.toArray().find((m) => m.get('id') === rowId)
    if (!row) return
    rows.doc.transact(() => {
      let cells = row.get('cells')
      if (!cells) {
        cells = new Y.Map()
        row.set('cells', cells)
      }
      for (const [k, v] of Object.entries(patch)) cells.set(k, v)
      row.set('updatedAt', Date.now())
    })
  })
}

export async function deleteRow(dbId, rowId, role) {
  assertCan(role, 'editor')
  await withRows(dbId, (rows) => {
    const idx = rows.toArray().findIndex((m) => m.get('id') === rowId)
    if (idx >= 0) rows.doc.transact(() => rows.delete(idx, 1))
  })
}

// ── Schema mutations (delegated to the store) ───────────────────────────────

export async function addColumn(dbId, partial, role) {
  assertCan(role, 'editor')
  return store().addColumn(dbId, partial)
}

export async function updateColumn(dbId, columnId, patch, role) {
  assertCan(role, 'editor')
  return store().updateColumn(dbId, columnId, patch)
}

export async function createView(dbId, type, role) {
  assertCan(role, 'editor')
  return store().createView(dbId, type)
}

export async function updateView(dbId, viewId, patch, role) {
  assertCan(role, 'editor')
  return store().updateView(dbId, viewId, patch)
}

export async function deleteView(dbId, viewId, role) {
  assertCan(role, 'editor')
  return store().deleteView(dbId, viewId)
}

export async function deleteDatabase(dbId, role) {
  requireOwner(role)
  return store().deleteDatabase(dbId)
}

// ── Subscriptions ────────────────────────────────────────────────────────────

// Observe schema meta-map + row-doc changes for one database. Callbacks are
// coalesced to at most one per animation frame. Returns an unsubscribe
// handle; after it runs no further callbacks fire and any privately-opened
// observer doc is destroyed.
export function subscribe(dbId, cb, role) {
  requireViewable(role)

  let closed = false
  let scheduled = false
  let rafId = 0
  let ownDoc = null
  let observedRows = null

  const schedule = () => {
    if (closed || scheduled) return
    scheduled = true
    rafId = requestAnimationFrame(() => {
      scheduled = false
      if (closed) return
      try {
        cb()
      } catch (err) {
        console.error('[public-api] subscriber callback failed:', err)
      }
    })
  }

  observeWorkspace((_changed, flags) => {
    if (flags?.databases || flags?.deletedDatabases) schedule()
  })

  const live = getActiveDoc(dbId)
  if (live) {
    observedRows = live.getArray('rows')
    observedRows.observeDeep(schedule)
  } else {
    // ponytail: one private observer doc per subscription, no shared-doc dedup — add a registry if subscriber counts matter.
    openRowDoc(dbId)
      .then(({ doc, rows }) => {
        if (closed) {
          doc.destroy()
          return
        }
        ownDoc = doc
        observedRows = rows
        rows.observeDeep(schedule)
      })
      .catch((err) => console.error('[public-api] subscribe failed:', err))
  }

  return () => {
    closed = true
    cancelAnimationFrame(rafId)
    if (observedRows) observedRows.unobserveDeep(schedule)
    if (ownDoc) ownDoc.destroy()
  }
}

// Plugin surface intentionally not registered yet — no plugin system exists.
// See docs/superpowers/specs/2026-08-22-databases-implementation-delta.md (Delta 2):
// uncomment once window.beaver lands.
// if (typeof window !== 'undefined') {
//   window.beaver = window.beaver || {}
//   window.beaver.databases = api
// }
