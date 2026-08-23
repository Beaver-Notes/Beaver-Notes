<template>
  <div
    class="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700"
  >
    <div
      class="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-700"
    >
      <v-remixicon :name="schema.icon || 'riLayoutGridLine'" size="16" />
      <router-link
        class="truncate text-sm font-medium text-neutral-700 hover:underline dark:text-neutral-300"
        :to="{ name: 'Database', params: { id: dbId } }"
      >
        {{ schema.title }}
      </router-link>
      <div class="ml-auto flex items-center gap-1 overflow-x-auto">
        <button
          v-for="v in schema.views"
          :key="v.id"
          type="button"
          class="flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors duration-100"
          :class="
            v.id === view?.id
              ? 'bg-primary/15 text-primary'
              : 'opacity-60 hover:bg-neutral-100 dark:hover:bg-neutral-800'
          "
          @click="store.setLastView(dbId, v.id)"
        >
          <v-remixicon :name="v.icon" size="12" />
          <span>{{ v.name }}</span>
        </button>
      </div>
    </div>
    <div v-if="view && ready" class="max-h-[480px] overflow-auto">
      <table-view
        :schema="schema"
        :rows="rows"
        :version="version"
        :view="view"
        @cell-update="onCellUpdate"
        @add-row="addRow"
        @open-row="openRow"
      />
    </div>
    <div v-else class="flex justify-center py-6">
      <ui-spinner />
    </div>

    <row-detail
      v-if="schema"
      :schema="schema"
      :row="detailRow"
      :open="detailRow != null"
      @close="closeRow"
      @update="onDetailUpdate"
      @open-page="openRowPage"
      @delete-row="removeRow"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useDatabaseStore } from '@/store/database';
import { useDatabaseYjs } from '@/composable/useDatabaseYjs';
import { useRowNotes } from '@/composable/useRowNotes';
import TableView from '@/lib/views/TableView.vue';
import RowDetail from '@/components/database/RowDetail.vue';

const props = defineProps({ dbId: { type: String, required: true } });
const store = useDatabaseStore();
store.hydrate();

const schema = computed(() => store.getById(props.dbId));
const dbApi = useDatabaseYjs(props.dbId);
const { rows, ready, version } = dbApi;
const {
  detailRow,
  openRow,
  closeRow,
  openRowPage,
  removeRow,
  onDetailUpdate,
} = useRowNotes(schema, dbApi);

// Linked views single-source-of-truth: same rule as /db/:id.
const view = computed(
  () =>
    schema.value?.views.find((v) => v.id === schema.value.lastViewId) ||
    schema.value?.views[0]
);

function onCellUpdate({ rowId, columnId, value }) {
  dbApi.updateCells(rowId, { [columnId]: value });
}
function addRow() {
  dbApi.createRow({});
}
</script>
