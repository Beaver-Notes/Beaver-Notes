<script setup>
import { computed } from 'vue'

const props = defineProps({
  value: { type: null, default: null },
  editing: Boolean,
  name: { type: String, default: '' },
})
const emit = defineEmits(['commit'])

// cell values arrive as ISO strings or {start,...} objects
const day = computed(() => {
  const start = typeof props.value === 'string' ? props.value : props.value?.start
  return typeof start === 'string' ? start.slice(0, 10) : ''
})

function onChange(e) {
  const v = e.target.value
  emit('commit', v ? { start: v, time_zone: null } : null)
}
</script>

<template>
  <input
    v-if="editing"
    type="date"
    :value="day"
    autofocus
    :aria-label="props.name"
    class="w-full bg-transparent px-2 py-1 text-sm outline-none focus:bg-input"
    @change="onChange"
  />
  <span v-else class="block truncate px-2 py-1 text-sm tabular-nums">{{ day }}</span>
</template>
