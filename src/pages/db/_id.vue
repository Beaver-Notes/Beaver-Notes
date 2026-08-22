<script setup>
import { computed, ref, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDatabaseStore } from '@/store/database'
import { useDatabaseYjs } from '@/composable/useDatabaseYjs'
import { useTranslations } from '@/composable/useTranslations'
import { useDialog } from '@/lib/dialog'
import DatabaseToolbar from '@/components/database/DatabaseToolbar.vue'
import TableView from '@/lib/views/TableView.vue'

const route = useRoute()
const router = useRouter()
const store = useDatabaseStore()
const dialog = useDialog()
const { translations } = useTranslations()
store.hydrate()

const dbId = computed(() => String(route.params.id))
const schema = computed(() => store.getById(dbId.value))
if (!schema.value) router.replace({ name: 'Home' })
// Deleted from another synced window while viewing → redirect instead of spinning.
watchEffect(() => {
  if (!schema.value) router.replace({ name: 'Home' })
})

const { rows, ready, version, createRow, updateCells } = useDatabaseYjs(dbId)

const view = computed(
  () =>
    schema.value?.views.find((v) => v.id === schema.value.lastViewId) ||
    schema.value?.views[0]
)

function onCellUpdate({ rowId, columnId, value }) {
  updateCells(rowId, { [columnId]: value })
}
function addRow() {
  createRow({})
}

// Filter/sort panels live here (brief); every edit writes straight through
// store.updateView so schema changes persist like any other view tweak.
const panel = ref(null)
function togglePanel(name) {
  panel.value = panel.value === name ? null : name
}

function patchConfig(patch) {
  store.updateView(schema.value.id, view.value.id, { config: patch })
}

const filtersList = computed(() => view.value?.config?.filters?.list || [])
const sortsList = computed(() => view.value?.config?.sorts || [])

function setFilters(list) {
  const current = view.value.config.filters || {}
  patchConfig({ filters: { conjunction: current.conjunction || 'and', list } })
}
function setFilter(index, patch) {
  setFilters(filtersList.value.map((f, i) => (i === index ? { ...f, ...patch } : f)))
}
function removeFilter(index) {
  setFilters(filtersList.value.filter((_, i) => i !== index))
}

const TEXT_OPS = ['contains', 'notContains', 'isEmpty', 'isNotEmpty']
const NUMBER_OPS = ['equals', 'notEquals', 'greaterThan', 'lessThan', 'greaterThanOrEqual', 'lessThanOrEqual', 'isEmpty', 'isNotEmpty']
const MULTI_OPS = ['contains', 'notContains', 'isEmpty', 'isNotEmpty']
const DATE_OPS = ['is', 'before', 'after', 'onOrBefore', 'onOrAfter', 'isEmpty', 'isNotEmpty']
const OPS_BY_TYPE = {
  title: TEXT_OPS,
  rich_text: TEXT_OPS,
  url: TEXT_OPS,
  email: TEXT_OPS,
  phone_number: TEXT_OPS,
  number: NUMBER_OPS,
  unique_id: NUMBER_OPS,
  checkbox: ['isChecked'],
  select: MULTI_OPS,
  status: MULTI_OPS,
  multi_select: MULTI_OPS,
  people: MULTI_OPS,
  relation: MULTI_OPS,
  date: DATE_OPS,
  created_time: DATE_OPS,
  last_edited_time: DATE_OPS,
}

function opsFor(columnId) {
  const column = schema.value.columns.find((c) => c.id === columnId)
  return OPS_BY_TYPE[column?.type] || TEXT_OPS
}
function needsValue(f) {
  return !['isEmpty', 'isNotEmpty', 'isChecked'].includes(f.operator)
}
function valueType(columnId) {
  const type = schema.value.columns.find((c) => c.id === columnId)?.type
  if (['date', 'created_time', 'last_edited_time'].includes(type)) return 'date'
  if (['number', 'unique_id'].includes(type)) return 'number'
  return 'text'
}

function setConjunction(conj) {
  patchConfig({ filters: { conjunction: conj, list: filtersList.value } })
}
function addFilter() {
  const first = schema.value.columns[0]
  if (!first) return
  setFilters([...filtersList.value, { columnId: first.id, operator: opsFor(first.id)[0], value: '' }])
}

function setSorts(list) {
  patchConfig({ sorts: list })
}
function setSort(index, patch) {
  setSorts(sortsList.value.map((s, i) => (i === index ? { ...s, ...patch } : s)))
}
function removeSort(index) {
  setSorts(sortsList.value.filter((_, i) => i !== index))
}
function addSort() {
  const first = schema.value.columns[0]
  if (!first) return
  setSorts([...sortsList.value, { columnId: first.id, direction: 'asc' }])
}

const t = computed(() => translations.value.database || {})

function renameSchema() {
  dialog.prompt({
    title: t.value.renameDatabase || 'Rename database',
    defaultValue: schema.value.title,
    allowedEmpty: false,
    okText: t.value.save || 'Save',
    onConfirm: (title) => {
      const name = String(title).trim()
      if (name && name !== schema.value.title) store.updateSchema(schema.value.id, { title })
    },
  })
}
function deleteSchema() {
  dialog.confirm({
    title: t.value.deleteConfirmTitle || 'Delete this database?',
    body:
      t.value.deleteConfirmBody ||
      'All of its rows will be permanently deleted. This action cannot be undone.',
    icon: 'riDeleteBin6Line',
    okVariant: 'danger',
    onConfirm: async () => {
      store.deleteDatabase(schema.value.id)
      router.replace({ name: 'Home' })
    },
  })
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <template v-if="schema && ready && view">
      <database-toolbar
        :schema="schema"
        :view="view"
        @switch-view="(id) => store.setLastView(schema.id, id)"
        @add-view="store.createView(schema.id, 'kanban')"
        @rename-schema="renameSchema"
        @delete-schema="deleteSchema"
        @toggle-filters="togglePanel('filters')"
        @toggle-sorts="togglePanel('sorts')"
      />

      <div
        v-if="panel === 'filters'"
        data-test="filters-panel"
        class="border-b border-neutral-200 px-3 py-2 dark:border-neutral-700"
      >
        <div class="mb-2 flex items-center gap-2">
          <span class="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
            {{ t.filter || 'Filter' }}
          </span>
          <div class="flex overflow-hidden rounded-lg border border-neutral-200 text-xs dark:border-neutral-700">
            <button
              v-for="conj in ['and', 'or']"
              :key="conj"
              class="px-2 py-0.5 capitalize transition-colors duration-100"
              :class="
                (view.config.filters?.conjunction || 'and') === conj
                  ? 'bg-primary/15 text-primary'
                  : 'opacity-60 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              "
              @click="setConjunction(conj)"
            >
              {{ conj }}
            </button>
          </div>
          <button
            data-test="add-filter"
            class="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-neutral-500 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            @click="addFilter"
          >
            <v-remixicon name="riAddLine" size="14" />
            <span>{{ t.addFilter || 'Add filter' }}</span>
          </button>
        </div>
        <div
          v-for="(f, i) in filtersList"
          :key="i"
          class="mb-1 flex items-center gap-1"
        >
          <select
            :aria-label="(t.filter || 'Filter') + ' column'"
            :value="f.columnId"
            class="max-w-[160px] rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700 outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            @change="setFilter(i, { columnId: $event.target.value, operator: opsFor($event.target.value)[0] })"
          >
            <option v-for="c in schema.columns" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <select
            :aria-label="(t.filter || 'Filter') + ' condition'"
            :value="f.operator"
            class="max-w-[180px] rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700 outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            @change="setFilter(i, { operator: $event.target.value })"
          >
            <option v-for="op in opsFor(f.columnId)" :key="op" :value="op">
              {{ op.replace(/([A-Z])/g, ' $1').toLowerCase() }}
            </option>
          </select>
          <input
            v-if="needsValue(f)"
            :type="valueType(f.columnId)"
            :aria-label="(t.filter || 'Filter') + ' value'"
            :value="f.value ?? ''"
            placeholder="…"
            class="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-input"
            @change="setFilter(i, { value: $event.target.value })"
          />
          <button
            :aria-label="t.delete || 'Delete'"
            class="rounded p-1.5 opacity-50 transition-colors duration-100 hover:bg-red-500/10 hover:text-red-600 hover:opacity-100"
            @click="removeFilter(i)"
          >
            <v-remixicon name="riCloseLine" size="14" />
          </button>
        </div>
      </div>

      <div
        v-if="panel === 'sorts'"
        data-test="sorts-panel"
        class="border-b border-neutral-200 px-3 py-2 dark:border-neutral-700"
      >
        <div class="mb-2 flex items-center">
          <span class="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
            {{ t.sort || 'Sort' }}
          </span>
          <button
            data-test="add-sort"
            class="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-neutral-500 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            @click="addSort"
          >
            <v-remixicon name="riAddLine" size="14" />
            <span>{{ t.addSort || 'Add sort' }}</span>
          </button>
        </div>
        <div
          v-for="(s, i) in sortsList"
          :key="i"
          class="mb-1 flex items-center gap-1"
        >
          <select
            :aria-label="(t.sort || 'Sort') + ' column'"
            :value="s.columnId"
            class="max-w-[200px] rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700 outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            @change="setSort(i, { columnId: $event.target.value })"
          >
            <option v-for="c in schema.columns" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <button
            class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm opacity-70 transition-colors duration-100 hover:bg-neutral-100 hover:opacity-100 dark:hover:bg-neutral-800"
            @click="setSort(i, { direction: s.direction === 'desc' ? 'asc' : 'desc' })"
          >
            <v-remixicon :name="s.direction === 'desc' ? 'riArrowDownLine' : 'riArrowUpLine'" size="14" />
            <span>{{ s.direction === 'desc' ? t.descending || 'Descending' : t.ascending || 'Ascending' }}</span>
          </button>
          <button
            :aria-label="t.delete || 'Delete'"
            class="ml-auto rounded p-1.5 opacity-50 transition-colors duration-100 hover:bg-red-500/10 hover:text-red-600 hover:opacity-100"
            @click="removeSort(i)"
          >
            <v-remixicon name="riCloseLine" size="14" />
          </button>
        </div>
      </div>

      <table-view
        :schema="schema"
        :rows="rows"
        :version="version"
        :view="view"
        @cell-update="onCellUpdate"
        @add-row="addRow"
      />
    </template>
    <div v-else class="flex flex-1 items-center justify-center">
      <ui-spinner />
    </div>
  </div>
</template>
