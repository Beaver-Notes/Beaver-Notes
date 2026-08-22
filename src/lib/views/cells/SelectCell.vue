<script setup>
import { computed } from 'vue'
import { nanoid } from 'nanoid'

const props = defineProps({
  column: { type: Object, required: true },
  value: { type: null, default: null },
  editing: Boolean,
})
const emit = defineEmits(['commit', 'options'])

const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']
// literal classes so Tailwind JIT keeps them
const CHIP_STYLES = {
  gray: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100',
  brown: 'bg-stone-300 text-stone-800 dark:bg-stone-700 dark:text-stone-100',
  orange: 'bg-orange-200 text-orange-800 dark:bg-orange-800 dark:text-orange-100',
  yellow: 'bg-yellow-200 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100',
  green: 'bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-100',
  blue: 'bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-100',
  purple: 'bg-purple-200 text-purple-800 dark:bg-purple-800 dark:text-purple-100',
  pink: 'bg-pink-200 text-pink-800 dark:bg-pink-800 dark:text-pink-100',
  red: 'bg-red-200 text-red-800 dark:bg-red-800 dark:text-red-100',
}

const options = computed(() => props.column.config?.options || [])
const selected = computed(() => (Array.isArray(props.value) ? props.value : props.value ? [props.value] : []))
const isMulti = computed(() => props.column.type === 'multi_select')

function toggle(opt) {
  if (isMulti.value) {
    const next = selected.value.includes(opt.id)
      ? selected.value.filter((i) => i !== opt.id)
      : [...selected.value, opt.id]
    emit('commit', next.length ? next : null)
  } else {
    emit('commit', opt.id === props.value ? null : opt.id)
  }
}

function addOption(name) {
  const used = options.value.map((o) => o.color)
  const opt = { id: nanoid(), name, color: COLORS.find((c) => !used.includes(c)) || COLORS[options.value.length % COLORS.length] }
  emit('options', [...options.value, opt])
  toggle(opt)
}
defineExpose({ addOption })

function chipStyle(id) {
  const color = options.value.find((o) => o.id === id)?.color || 'gray'
  return CHIP_STYLES[color] || CHIP_STYLES.gray
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1 px-2 py-1">
    <span
      v-for="id in selected"
      :key="id"
      class="max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium"
      :class="chipStyle(id)"
    >
      {{ options.find((o) => o.id === id)?.name || '?' }}
    </span>
  </div>
</template>
