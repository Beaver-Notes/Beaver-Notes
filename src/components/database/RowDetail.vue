<script setup>
import { computed, onUnmounted, watch } from 'vue'
import CellRenderer from '@/lib/views/cells/CellRenderer.vue'
import { useTranslations } from '@/composable/useTranslations'
import { rowTitleText } from '@/lib/database/row-notes'

const props = defineProps({
  schema: { type: Object, required: true },
  row: { type: Object, default: null },
  open: Boolean,
})
const emit = defineEmits(['close', 'update', 'open-page', 'delete-row'])

const { translations } = useTranslations()
const t = computed(() => translations.value.database || {})
const title = computed(
  () =>
    (props.row ? rowTitleText(props.schema, props.row) : '') ||
    t.value.untitled ||
    'Untitled'
)

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}
watch(
  () => props.open,
  (v) => {
    if (v) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  },
  { immediate: true }
)
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <teleport to="body">
    <transition name="row-drawer">
      <div v-if="open && row" class="fixed inset-0 z-50">
        <div
          data-test="drawer-backdrop"
          class="absolute inset-0 bg-black/20"
          @click="emit('close')"
        />
        <aside
          data-test="row-drawer"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          class="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-white shadow-lg dark:bg-neutral-900"
        >
          <header
            class="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700"
          >
            <h2 class="min-w-0 flex-1 truncate text-sm font-medium">
              {{ title }}
            </h2>
            <button
              data-test="drawer-close"
              :aria-label="t.cancel || 'Close'"
              class="rounded-lg p-1.5 text-neutral-400 transition-colors duration-100 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              @click="emit('close')"
            >
              <v-remixicon name="riCloseLine" size="18" />
            </button>
          </header>

          <div class="flex-1 overflow-y-auto px-2 py-2" data-test="drawer-properties">
            <div
              v-for="c in schema.columns"
              :key="c.id"
              :data-test="`property-${c.id}`"
              class="mb-1 flex items-start gap-2 rounded-lg px-1 py-0.5 transition-colors duration-100 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
            >
              <span
                class="w-24 shrink-0 truncate pt-2 text-xs uppercase tracking-wide opacity-60"
              >
                {{ c.name }}
              </span>
              <div class="min-w-0 flex-1">
                <cell-renderer
                  :column="c"
                  :row="row"
                  @update="(patch) => emit('update', { rowId: row.id, patch })"
                />
              </div>
            </div>
          </div>

          <footer
            class="flex items-center gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-700"
          >
            <ui-button
              variant="danger"
              data-test="drawer-delete-row"
              @click="emit('delete-row', row.id)"
            >
              <v-remixicon name="riDeleteBin6Line" size="16" class="mr-1" />
              <span>{{ t.deleteRow || 'Delete row' }}</span>
            </ui-button>
            <ui-button
              variant="primary"
              class="ml-auto"
              data-test="drawer-open-page"
              @click="emit('open-page', row.id)"
            >
              <v-remixicon name="riExternalLinkLine" size="16" class="mr-1" />
              <span>{{ t.openPage || 'Open page' }}</span>
            </ui-button>
          </footer>
        </aside>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.row-drawer-enter-active,
.row-drawer-leave-active {
  transition: opacity 200ms ease-out;
}
.row-drawer-enter-active aside,
.row-drawer-leave-active aside {
  transition: transform 200ms ease-out;
}
.row-drawer-enter-from,
.row-drawer-leave-to {
  opacity: 0;
}
.row-drawer-enter-from aside,
.row-drawer-leave-to aside {
  transform: translateX(100%);
}
@media (prefers-reduced-motion: reduce) {
  .row-drawer-enter-active,
  .row-drawer-leave-active,
  .row-drawer-enter-active aside,
  .row-drawer-leave-active aside {
    transition-duration: 0.01ms;
  }
  .row-drawer-enter-from aside,
  .row-drawer-leave-to aside {
    transform: none;
  }
}
</style>
