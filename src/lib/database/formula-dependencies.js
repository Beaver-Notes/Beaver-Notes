// src/lib/database/formula-dependencies.js
import { tokenize } from './formula-evaluator'

// Token-level scan rather than full parse: string literals are opaque tokens, so
// text that looks like prop() inside a string can never register as a dependency,
// and partially-invalid expressions still yield their discoverable refs.
export function extractDependencies(expression) {
  try {
    const out = []
    const tokens = tokenize(expression)
    for (let i = 0; i + 2 < tokens.length; i++) {
      if (tokens[i].t === 'ident' && tokens[i].v === 'prop'
        && tokens[i + 1].v === '(' && tokens[i + 2].t === 'str'
        && !out.includes(tokens[i + 2].v)) out.push(tokens[i + 2].v)
    }
    return out
  } catch { /* untokenizable expressions have no deps yet */ return [] }
}

export function buildDependencyGraph(schemas) {
  const dependents = new Map()
  const addEdge = (from, to) => {
    if (!dependents.has(from)) dependents.set(from, new Set())
    dependents.get(from).add(to)
  }
  for (const db of Object.values(schemas)) {
    const byName = new Map(db.columns.map((c) => [c.name, c]))
    for (const c of db.columns) {
      const ref = `${db.id}:${c.name}`
      if (c.type === 'formula' && c.config?.expression) {
        for (const dep of extractDependencies(c.config.expression)) {
          if (byName.has(dep)) addEdge(`${db.id}:${dep}`, ref)
        }
      }
      if (c.type === 'rollup' && c.config) {
        const rel = db.columns.find((x) => x.id === c.config.relationPropertyId)
        const targetDbId = rel?.config?.databaseId
        // Edge from the target db's rolled-up property to this rollup.
        if (targetDbId) {
          const targetDb = schemas[targetDbId]
          const targetCol = targetDb?.columns.find((x) => x.id === c.config.rollupPropertyId)
          if (targetDb && targetCol) addEdge(`${targetDbId}:${targetCol.name}`, ref)
        }
        // Rollups also recompute when the relation set itself changes.
        const relName = rel?.name
        if (relName) addEdge(`${db.id}:${relName}`, ref)
      }
    }
  }
  return { dependents }
}

export function invalidate(ref, graph) {
  const out = new Set()
  const queue = [ref]
  while (queue.length) {
    const cur = queue.pop()
    if (out.has(cur)) continue
    out.add(cur)
    for (const next of graph.dependents.get(cur) || []) queue.push(next)
  }
  return out
}
