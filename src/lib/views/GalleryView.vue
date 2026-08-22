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

const coverCol = computed(
  () => props.schema.columns.find((c) => c.id === props.view?.config?.coverColumnId && c.type === 'files') || null
)

function coverUrl(row) {
  if (!coverCol.value) return null
  const v = cellValue(coverCol.value, row)
  return (Array.isArray(v) ? v : []).find((f) => f?.url)?.url || null
}

function titleOf(row) {
  const col = props.schema.columns.find((c) => c.type === 'title')
  return col ? String(richTextToPlain(cellValue(col, row))) : ''
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-3" role="list">
    <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))">
      <article
        v-for="r in viewRows"
        :key="r.id"
        :data-test="`card-${r.id}`"
        role="listitem"
        tabindex="0"
        class="gallery-card cursor-pointer overflow-hidden rounded-xl bg-white shadow-sm outline-none transition-shadow duration-150 hover:shadow-md focus-visible:ring-1 focus-visible:ring-primary dark:bg-neutral-900"
        @click="$emit('open-row', r.id)"
        @keydown.enter.prevent="$emit('open-row', r.id)"
      >
        <img
          v-if="coverUrl(r)"
          :src="coverUrl(r)"
          :alt="titleOf(r)"
          class="h-[120px] w-full bg-neutral-100 object-cover dark:bg-neutral-800"
        />
        <div class="p-2">
          <div class="truncate text-sm font-medium">{{ titleOf(r) }}</div>
          <div v-for="c in cardCols" :key="c.id" class="mt-0.5">
            <cell-renderer :column="c" :row="r" />
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .gallery-card {
    animation: gallery-in 200ms ease-out backwards;
  }
  @keyframes gallery-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
}
</style>
