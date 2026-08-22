import { describe, it, expect } from 'vitest'
import { extractDependencies, buildDependencyGraph, invalidate } from '../formula-dependencies'

const col = (name, type, extra = {}) => ({ id: name.toLowerCase() + '-id', name, type, ...extra })

describe('extractDependencies', () => {
  it('finds prop refs', () => {
    expect(extractDependencies(`prop("Price") * if(prop("Qty") > 0, prop("Qty"), 1)`))
      .toEqual(['Price', 'Qty'])
  })
  it('ignores strings that look like props', () => {
    expect(extractDependencies(`concat("prop(\\"X\\")", prop("Real"))`)).toEqual(['Real'])
  })
})

describe('graph', () => {
  const schemas = {
    tasks: { id: 'tasks', columns: [
      col('Done', 'checkbox'),
      col('Score', 'rollup', { config: { relationPropertyId: 'rel-id', rollupPropertyId: 'points-id', function: 'sum' } }),
      col('Rel', 'relation', { id: 'rel-id', config: { databaseId: 'habits' } }),
      col('Label', 'formula', { config: { expression: 'if(prop("Done"), prop("Score"), 0)' } }),
    ]},
    habits: { id: 'habits', columns: [col('Points', 'number')] },
  }
  it('invalidates transitively across databases', () => {
    const g = buildDependencyGraph(schemas)
    const out = invalidate('habits:Points', g)
    expect(out.has('habits:Points')).toBe(true)
    expect(out.has('tasks:Score')).toBe(true)
    expect(out.has('tasks:Label')).toBe(true)
  })
})
