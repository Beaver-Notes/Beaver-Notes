<template>
  <NodeViewWrapper class="my-3" data-database-id>
    <DatabaseSurface v-if="schema" :key="databaseId" :db-id="databaseId" />
    <div
      v-else
      class="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/60"
    >
      <p class="text-sm font-medium text-neutral-700 dark:text-neutral-300">
        {{ t.createOrLink || 'Create or link a database' }}
      </p>
      <div
        v-if="store.databases.length"
        class="mt-2 max-h-44 space-y-0.5 overflow-y-auto"
      >
        <button
          v-for="db in store.databases"
          :key="db.id"
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-neutral-200/70 dark:hover:bg-neutral-700/60"
          @click="link(db.id)"
        >
          <v-remixicon :name="db.icon || 'riLayoutGridLine'" size="16" />
          <span class="truncate">{{ db.title }}</span>
        </button>
      </div>
      <button
        type="button"
        class="mt-2 flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-sm text-white transition-colors duration-150 hover:bg-primary/90"
        @click="createAndLink"
      >
        <v-remixicon name="riAddLine" size="14" />
        {{ t.newDatabase || 'New database' }}
      </button>
    </div>
  </NodeViewWrapper>
</template>

<script setup>
import { computed } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { useDatabaseStore } from '@/store/database';
import { useTranslations } from '@/composable/useTranslations';
import DatabaseSurface from './DatabaseSurface.vue';

const props = defineProps(nodeViewProps);
const store = useDatabaseStore();
const { translations } = useTranslations();
store.hydrate();

const databaseId = computed(() => props.node.attrs.databaseId);
// Tombstoned links degrade back to the picker so the block stays recoverable.
const schema = computed(() =>
  databaseId.value ? store.getById(databaseId.value) : null
);
const t = computed(() => translations.value.database || {});

function link(id) {
  props.updateAttributes({ databaseId: id });
}
function createAndLink() {
  link(store.createDatabase());
}
</script>
