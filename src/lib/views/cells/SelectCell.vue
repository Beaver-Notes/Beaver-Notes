<script setup>
import { computed } from 'vue'
import { nanoid } from 'nanoid'
import UiPopover from '@/components/ui/Popover.vue'

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
defineExpose({ addOption, toggle })

function chipStyle(id) {
  const color = options.value.find((o) => o.id === id)?.color || 'gray'
  return CHIP_STYLES[color] || CHIP_STYLES.gray
}

function clear() {
  emit('commit', null)
}
</script>

<template>
  <ui-popover
    placement="bottom-start"
    :model-value="editing && options.length > 0"
  >
    <template #trigger>
      <div class="flex h-full flex-wrap items-center gap-1 px-2 py-1">
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
    <!-- Edit picker: chips toggle membership (multi) or replace (single); Empty clears.
         Committing clears the cell's editing state, which closes the popover. -->
    <div data-test="select-picker" class="flex max-h-56 min-w-[160px] flex-col gap-1 overflow-auto">
      <button
        v-for="opt in options"
        :key="opt.id"
        :data-test="`pick-${opt.id}`"
        type="button"
        class="max-w-full truncate rounded-full px-2 py-0.5 text-left text-xs font-medium transition-opacity duration-100"
        :class="[chipStyle(opt.id), selected.includes(opt.id) ? '' : 'opacity-70 hover:opacity-100']"
        @mousedown.prevent
        @click.stop="toggle(opt)"
      >
        {{ opt.name }}
      </button>
      <button
        data-test="clear-selection"
        type="button"
        class="text-left text-xs opacity-60 transition-opacity duration-100 hover:opacity-100"
        @mousedown.prevent
        @click.stop="clear"
      >
        Empty
      </button>
    </div>
  </ui-popover>
</template>
