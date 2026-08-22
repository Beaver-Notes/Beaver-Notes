<script setup>
import { ref, watch } from 'vue'
import { formatNumber, parseNumberInput } from '@/lib/database/number-format'

const props = defineProps({
  value: { type: null, default: null },
  config: { type: Object, default: () => ({}) },
  editing: Boolean,
  name: { type: String, default: '' },
})
const emit = defineEmits(['commit'])

const draft = ref('')
watch(() => props.editing, (e) => { if (e) draft.value = props.value == null ? '' : String(props.value) })

function done(save) {
  const next = parseNumberInput(draft.value)
  // skip no-op/stale commits (blur firing after Enter would otherwise revert the edit)
  if (save && next !== props.value) emit('commit', next)
  draft.value = props.value == null ? '' : String(props.value)
}
</script>

<template>
  <input
    v-if="editing"
    v-model="draft"
    inputmode="decimal"
    :aria-label="props.name"
    class="w-full bg-transparent px-2 py-1 text-right text-sm outline-none focus:bg-input"
    @keydown.enter.prevent="done(true)"
    @keydown.esc.prevent="done(false)"
    @blur="done(true)"
  />
  <span v-else class="block truncate px-2 py-1 text-right text-sm tabular-nums">
    {{ value == null ? '' : formatNumber(value, config?.format || 'plain') }}
  </span>
</template>
