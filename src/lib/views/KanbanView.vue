<script setup>
import { computed, ref } from 'vue'
import CellRenderer from './cells/CellRenderer.vue'
import { runView, groupRows, cellValue } from '../database/view-engine'
import { richTextToPlain } from '../database/rich-text-convert'
import { useTranslations } from '@/composable/useTranslations'

const props = defineProps({ schema: Object, rows: Array, version: Number, view: Object })
const emit = defineEmits(['cell-update', 'add-row-in-group', 'open-row'])

const { translations } = useTranslations()
const t = computed(() => translations.value.database || {})

const GROUPABLE = ['select', 'status', 'multi_select']
// canonical key is groupColumnId (store-created views); fall back to the first
// groupable column so hand-made configs still board instead of blanking out.
const groupId = computed(
  () =>
    props.view?.config?.groupColumnId ||
    props.schema.columns.find((c) => GROUPABLE.includes(c.type))?.id ||
    null
)
const groupCol = computed(() => props.schema.columns.find((c) => c.id === groupId.value) || null)

const result = computed(() => {
  void props.version
  const r = runView(props.schema, props.view, props.rows)
  return {
    rows: r.rows,
    groups: groupId.value ? groupRows(r.rows, props.schema.columns, groupId.value) : [],
  }
})

const cardCols = computed(() => {
  const ids = props.view?.config?.cardFields
  if (!ids?.length) return []
  return ids.map((id) => props.schema.columns.find((c) => c.id === id)).filter(Boolean)
})

function titleOf(row) {
  const col = props.schema.columns.find((c) => c.type === 'title')
  return col ? String(richTextToPlain(cellValue(col, row))) : ''
}

function optionIdFor(key) {
  return (groupCol.value?.config?.options || []).find((o) => o.name === key)?.id ?? key
}

// value a new/dropped row gets for this group; multi_select merges on drop
function seedValue(group, row) {
  if (!groupCol.value || !group.key) return null
  const id = optionIdFor(group.key)
  if (groupCol.value.type !== 'multi_select') return id
  if (!row) return [id]
  const current = Array.isArray(row.cells?.[groupCol.value.id]) ? row.cells[groupCol.value.id] : []
  return [...new Set([...current, id])]
}

const dragging = ref(null)
const dragOver = ref(null)
function onDragStart(row, e) {
  dragging.value = row.id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', row.id)
  }
}
function onDrop(group, e) {
  dragOver.value = null
  const rowId = e.dataTransfer?.getData('text/plain') || dragging.value
  if (!rowId) return
  const row = result.value.rows.find((r) => r.id === rowId)
  emit('cell-update', { rowId, columnId: groupId.value, value: seedValue(group, row) })
}

const DOT_STYLES = {
  gray: 'bg-neutral-400',
  brown: 'bg-stone-500',
  orange: 'bg-orange-400',
  yellow: 'bg-yellow-400',
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
  red: 'bg-red-500',
}
</script>

<template>
  <div
    v-if="result.groups.length"
    class="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3"
    role="list"
  >
    <section
      v-for="g in result.groups"
      :key="g.key"
      :data-test="`group-${g.label}`"
      role="listitem"
      :aria-label="g.label"
      class="flex max-h-full w-[264px] shrink-0 flex-col rounded-xl bg-neutral-100 transition-colors duration-150 dark:bg-neutral-800/60"
    >
      <header class="flex items-center gap-2 px-3 py-2 text-sm font-medium">
        <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="DOT_STYLES[g.color] || DOT_STYLES.gray" />
        <span class="truncate">{{ g.label }}</span>
        <span class="ml-auto text-xs tabular-nums opacity-50">{{ g.rows.length }}</span>
      </header>
      <div
        data-test="drop-zone"
        class="flex min-h-[80px] flex-1 flex-col gap-2 overflow-y-auto rounded-lg px-2 pb-2 transition-colors duration-150"
        :class="dragOver === g.label ? 'bg-primary/10 ring-1 ring-primary/40' : ''"
        @dragover.prevent="dragOver = g.label"
        @dragleave.self="dragOver = null"
        @drop.prevent="onDrop(g, $event)"
      >
        <article
          v-for="r in g.rows"
          :key="r.id"
          :data-test="`card-${r.id}`"
          draggable="true"
          tabindex="0"
          class="cursor-grab select-none rounded-lg bg-white p-2 shadow-sm outline-none transition-transform duration-150 hover:shadow-md focus-visible:ring-1 focus-visible:ring-primary active:cursor-grabbing active:scale-[0.98] dark:bg-neutral-900"
          @dragstart="onDragStart(r, $event)"
          @click="emit('open-row', r.id)"
          @keydown.enter.prevent="emit('open-row', r.id)"
        >
          <div class="truncate text-sm font-medium">{{ titleOf(r) }}</div>
          <div v-for="c in cardCols" :key="c.id" class="mt-1">
            <cell-renderer :column="c" :row="r" />
          </div>
        </article>
        <button
          :data-test="`new-${g.label}`"
          class="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-neutral-500 transition-colors duration-150 hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700/70 dark:hover:text-neutral-100"
          @click.stop="emit('add-row-in-group', { columnId: groupId, value: seedValue(g) })"
        >
          <v-remixicon name="riAddLine" size="14" />
          <span>{{ t.newRow || 'New' }}</span>
        </button>
      </div>
    </section>
  </div>
  <div v-else class="flex flex-1 items-center justify-center p-4 text-sm text-neutral-500">
    {{ t.noGroupColumn || 'Add a select or status column to group cards' }}
  </div>
</template>
