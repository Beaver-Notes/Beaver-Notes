import { ref } from 'vue'
import { generateFromDescription } from '@/lib/database/formula-fallback'

export function useFormulaGenerator() {
  const busy = ref(false)
  // Seam for future describe→formula model (see docs/superpowers/specs/2026-08-22-databases-implementation-delta.md, Delta 1).
  async function describe(text, columns) {
    busy.value = true
    try { return generateFromDescription(text, columns) }
    finally { busy.value = false }
  }
  return { describe, busy }
}
