<script setup>
import { computed } from 'vue'
import CellRenderer from './cells/CellRenderer.vue'
import { runView, cellValue } from '../database/view-engine'
import { richTextToPlain } from '../database/rich-text-convert'

const props = defineProps({ schema: Object, rows: Array, version: Number, view: Object })
defineEmits(['open-row'])

const viewRows = computed(() => {
  void props.version
  return runView(props.schema, props.view, props.rows).rows
})

// canonical key is cardFields (store-created views)
const cardCols = computed(() => {
  const ids = props.view?.config?.cardFields
  if (!ids?.length) return []
  return ids.map((id) => props.schema.columns.find((c) => c.id === id)).filter(Boolean)
})

function titleOf(row) {
  const col = props.schema.columns.find((c) => c.type === 'title')
  return col ? String(richTextToPlain(cellValue(col, row))) : ''
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-2" role="list">
    <div
      v-for="r in viewRows"
      :key="r.id"
      :data-test="`row-${r.id}`"
      role="listitem"
      tabindex="0"
      class="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-2 py-1.5 outline-none transition-colors duration-100 hover:bg-neutral-100 focus-visible:bg-neutral-100 dark:hover:bg-neutral-800/70 dark:focus-visible:bg-neutral-800/70"
      @click="$emit('open-row', r.id)"
      @keydown.enter.prevent="$emit('open-row', r.id)"
    >
      <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ titleOf(r) }}</span>
      <span v-for="c in cardCols" :key="c.id" class="shrink-0 text-sm opacity-80">
        <cell-renderer :column="c" :row="r" />
      </span>
    </div>
  </div>
</template>
