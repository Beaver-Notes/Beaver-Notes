<script setup>
import { computed, ref } from 'vue'
import CellRenderer from './cells/CellRenderer.vue'
import { runView } from '../database/view-engine'
import { createComputeCache } from '../database/compute-row'
import { useDatabaseStore } from '@/store/database'
import { useTranslations } from '@/composable/useTranslations'
import UiPopover from '@/components/ui/Popover.vue'

const props = defineProps({ schema: Object, rows: Array, version: Number, view: Object })
const emit = defineEmits(['cell-update', 'add-row', 'open-row'])

const db = useDatabaseStore()
const { translations } = useTranslations()

// Canonical config keys are columnOrder/hiddenColumns (store-created views);
// visibleColumns is the brief-era exhaustive list, kept working for old payloads.
const ordered = computed(() => {
  const cfg = props.view?.config || {}
  const hidden = new Set(cfg.hiddenColumns || [])
  const all = props.schema.columns.filter((c) => !hidden.has(c.id))
  const order = cfg.columnOrder?.length ? cfg.columnOrder : cfg.visibleColumns?.length ? cfg.visibleColumns : null
  if (!order) return all
  const shown = order.map((id) => all.find((c) => c.id === id)).filter(Boolean)
  return cfg.visibleColumns ? shown : [...shown, ...all.filter((c) => !order.includes(c.id))]
})

const viewRows = computed(() => {
  void props.version
  return runView(props.schema, props.view, props.rows).rows
})

const COMPUTED_TYPES = ['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id']
const computeCache = createComputeCache()
const computedRows = computed(() => {
  void props.version
  if (!props.schema.columns.some((c) => COMPUTED_TYPES.includes(c.type))) return null
  const m = new Map()
  for (const r of viewRows.value) m.set(r.id, computeCache.get(props.schema, r, { getRows: () => props.rows }))
  return m
})
function computedFor(row, column) {
  const entry = computedRows.value?.get(row.id)?.[column.id]
  if (!entry) return null
  if (entry.error != null) return entry.error
  if (column.type === 'unique_id' && entry.value) return [entry.value.prefix, entry.value.number].filter(Boolean).join('-')
  return entry.value
}

// ponytail: click-to-edit without focusout cleanup — clicking another cell moves
// the edit caret; committing clears it. Clicking fully outside leaves the last
// cell in edit mode (cosmetic only); swap to focusout handling if it bothers anyone.
const editingCell = ref(null)
const cellKey = (rowId, colId) => `${rowId}:${colId}`

function onCell(rowId, patch) {
  editingCell.value = null
  const [[columnId, value]] = Object.entries(patch)
  emit('cell-update', { rowId, columnId, value })
}

const openMenu = ref(null)
const renaming = ref(null)
const nameDraft = ref('')
function closeMenu() {
  openMenu.value = null
  renaming.value = null
}
function startRename(column) {
  renaming.value = column.id
  nameDraft.value = column.name
}
function commitRename(column) {
  if (renaming.value !== column.id) return
  const name = nameDraft.value.trim()
  if (name && name !== column.name) db.updateColumn(props.schema.id, column.id, { name })
  closeMenu()
}
function hideColumn(column) {
  const hidden = props.view.config.hiddenColumns || []
  db.updateView(props.schema.id, props.view.id, {
    config: { hiddenColumns: [...new Set([...hidden, column.id])] },
  })
  closeMenu()
}
function removeColumn(column) {
  db.removeColumn(props.schema.id, column.id)
  closeMenu()
}

const t = computed(() => translations.value.database || {})
</script>

<template>
  <div class="relative min-h-0 flex-1 overflow-auto" role="table">
    <div
      role="row"
      class="sticky top-0 z-10 flex items-stretch border-b bg-white transition-colors duration-100 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700"
    >
      <template v-for="(c, i) in ordered" :key="c.id">
        <div
          role="columnheader"
          :class="i === 0 ? 'w-[240px] shrink-0' : 'min-w-[160px] flex-1 border-l border-neutral-200 dark:border-neutral-700'"
        >
          <ui-popover
            placement="bottom-start"
            :model-value="openMenu === c.id"
            @update:model-value="(v) => (openMenu = v ? c.id : null)"
          >
            <template #trigger>
              <button
                :data-test="`header-name-${c.id}`"
                class="h-full w-full truncate px-2 py-2 text-left text-xs font-medium uppercase tracking-wide opacity-60 transition-colors duration-100 hover:bg-neutral-100 hover:opacity-100 dark:hover:bg-neutral-800"
              >
                {{ c.name }}
                <v-remixicon name="riArrowDownSLine" class="inline h-3 w-3 -mt-0.5" />
              </button>
            </template>
            <div class="min-w-[160px]">
              <template v-if="renaming === c.id">
                <input
                  v-model="nameDraft"
                  data-test="rename-input"
                  :aria-label="c.name"
                  autofocus
                  class="w-full rounded-lg bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-input"
                  @keydown.enter.prevent="commitRename(c)"
                  @keydown.esc.prevent="closeMenu"
                  @blur="commitRename(c)"
                />
              </template>
              <template v-else>
                <button
                  :data-test="`menu-rename-${c.id}`"
                  class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-sm transition-colors duration-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  @click="startRename(c)"
                >
                  <v-remixicon name="riEditLine" />
                  <span>{{ t.rename || 'Rename' }}</span>
                </button>
                <button
                  :data-test="`menu-hide-${c.id}`"
                  class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-sm transition-colors duration-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  @click="hideColumn(c)"
                >
                  <v-remixicon name="riEyeOffLine" />
                  <span>{{ t.hide || 'Hide' }}</span>
                </button>
                <hr class="my-1 border-t border-neutral-200 dark:border-neutral-700" />
                <button
                  :data-test="`menu-delete-${c.id}`"
                  class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-sm text-red-600 transition-colors duration-100 hover:bg-red-500/10 dark:text-red-400"
                  @click="removeColumn(c)"
                >
                  <v-remixicon name="riDeleteBin6Line" />
                  <span>{{ t.delete || 'Delete' }}</span>
                </button>
              </template>
            </div>
          </ui-popover>
        </div>
      </template>
      <button
        data-test="add-column"
        :title="t.addColumn || 'Add column'"
        :aria-label="t.addColumn || 'Add column'"
        class="w-[120px] shrink-0 opacity-50 transition-opacity duration-100 hover:opacity-100"
        @click="db.addColumn(schema.id, { type: 'rich_text' })"
      >
        <v-remixicon name="riAddLine" class="mx-auto" />
      </button>
    </div>

    <div
      v-for="r in viewRows"
      :key="r.id"
      :data-test="`row-${r.id}`"
      role="row"
      tabindex="0"
      class="group flex border-b transition-colors duration-100 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 border-neutral-200 dark:border-neutral-700 focus-visible:outline-none focus-visible:bg-neutral-50 dark:focus-visible:bg-neutral-800/50"
      @dblclick="emit('open-row', r.id)"
      @keydown.enter.self.prevent="emit('open-row', r.id)"
    >
      <template v-for="(c, i) in ordered" :key="c.id">
        <div
          :data-test="`cell-${r.id}-${c.id}`"
          :class="[
            i === 0 ? 'w-[240px] shrink-0' : 'min-w-[160px] flex-1 border-l border-neutral-200 dark:border-neutral-700',
            editingCell === cellKey(r.id, c.id) ? '' : 'cursor-default',
          ]"
          @click="editingCell = cellKey(r.id, c.id)"
          @keydown.esc="editingCell = null"
        >
          <cell-renderer
            :column="c"
            :row="r"
            :editing="editingCell === cellKey(r.id, c.id)"
            :computed="computedFor(r, c)"
            @update="(p) => onCell(r.id, p)"
          />
        </div>
      </template>
    </div>

    <button
      data-test="add-row"
      class="m-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-neutral-500 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      @click="emit('add-row')"
    >
      <v-remixicon name="riAddLine" />
      <span>{{ t.newRow || 'New row' }}</span>
    </button>
  </div>
</template>
