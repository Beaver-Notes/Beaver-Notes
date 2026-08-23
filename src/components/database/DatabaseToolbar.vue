<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useTranslations } from '@/composable/useTranslations'
import UiPopover from '@/components/ui/Popover.vue'
import { VIEW_TYPES, VIEW_ICONS, VIEW_NAMES } from '@/lib/database/schema'

const props = defineProps({ schema: Object, view: Object })
const emit = defineEmits(['switch-view', 'add-view', 'rename-schema', 'delete-schema', 'toggle-filters', 'toggle-sorts'])

const { translations } = useTranslations()
const t = computed(() => translations.value.database || {})

const bar = ref(null)
const underline = ref({ left: 0, width: 0 })
async function moveUnderline() {
  await nextTick()
  const el = bar.value?.querySelector('[data-active=true]')
  if (el) underline.value = { left: el.offsetLeft, width: el.offsetWidth }
}
onMounted(moveUnderline)
watch(() => props.view.id, moveUnderline)

const filterCount = computed(() => props.view?.config?.filters?.list?.length || 0)
const sortCount = computed(() => props.view?.config?.sorts?.length || 0)
</script>

<template>
  <div class="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 transition-colors duration-100 dark:border-neutral-700">
    <h2 class="mr-2 flex min-w-0 items-center gap-1 truncate text-sm font-semibold">
      <v-remixicon
        v-if="/^ri/.test(schema.icon || '')"
        :name="schema.icon"
        size="16"
        class="shrink-0"
      />
      <span v-else-if="schema.icon" class="select-none">{{ schema.icon }}</span>
      <span class="truncate">{{ schema.title }}</span>
    </h2>
    <div ref="bar" class="relative flex gap-1">
      <button
        v-for="v in schema.views"
        :key="v.id"
        :data-test="`tab-${v.id}`"
        :data-active="v.id === view.id"
        class="rounded px-2 py-1 text-sm transition-colors duration-100"
        :class="v.id === view.id ? 'font-medium text-neutral-900 dark:text-neutral-100' : 'opacity-60 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'"
        @click="emit('switch-view', v.id)"
      >
        {{ v.name }}
      </button>
      <span
        aria-hidden="true"
        class="absolute bottom-0 h-0.5 rounded bg-primary transition-all duration-150 ease-out"
        :style="{ left: underline.left + 'px', width: underline.width + 'px' }"
      />
    </div>
    <ui-popover placement="bottom-end">
      <template #trigger>
        <button
          data-test="add-view"
          :title="t.newView || 'New view'"
          :aria-label="t.newView || 'New view'"
            class="ml-1 rounded p-1 text-sm opacity-50 transition-opacity duration-100 hover:bg-neutral-100 hover:opacity-100 dark:hover:bg-neutral-800"
          >
          <v-remixicon name="riAddLine" size="16" />
        </button>
      </template>
      <div class="min-w-[140px]">
        <button
          v-for="vt in VIEW_TYPES"
          :key="vt"
          :data-test="`add-view-${vt}`"
          class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-sm capitalize transition-colors duration-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          @click="emit('add-view', vt)"
        >
          <v-remixicon :name="VIEW_ICONS[vt]" size="16" />
          <span>{{ VIEW_NAMES[vt] || vt }}</span>
        </button>
      </div>
    </ui-popover>
    <div class="ml-auto flex items-center gap-1">
      <button
        data-test="filters-btn"
        class="flex items-center gap-1 rounded px-2 py-1 text-sm opacity-60 transition-colors duration-100 hover:bg-neutral-100 hover:opacity-100 dark:hover:bg-neutral-800"
        @click="emit('toggle-filters')"
      >
        <v-remixicon name="riFilter3Line" size="14" />
        <span>{{ t.filter || 'Filter' }}</span>
        <span
          v-if="filterCount"
          data-test="filters-badge"
          class="rounded-full bg-primary/15 px-1.5 text-xs tabular-nums text-primary"
        >{{ filterCount }}</span>
      </button>
      <button
        data-test="sorts-btn"
        class="flex items-center gap-1 rounded px-2 py-1 text-sm opacity-60 transition-colors duration-100 hover:bg-neutral-100 hover:opacity-100 dark:hover:bg-neutral-800"
        @click="emit('toggle-sorts')"
      >
        <v-remixicon name="riSortAsc" size="14" />
        <span>{{ t.sort || 'Sort' }}</span>
        <span
          v-if="sortCount"
          data-test="sorts-badge"
          class="rounded-full bg-primary/15 px-1.5 text-xs tabular-nums text-primary"
        >{{ sortCount }}</span>
      </button>
      <ui-popover placement="bottom-end">
        <template #trigger>
          <button
            data-test="db-menu-btn"
            :aria-label="t.options || 'Options'"
            class="rounded p-1 opacity-60 transition-colors duration-100 hover:bg-neutral-100 hover:opacity-100 dark:hover:bg-neutral-800"
          >
            <v-remixicon name="riMore2Fill" size="16" />
          </button>
        </template>
        <div class="min-w-[160px]">
          <button
            data-test="menu-rename-db"
            class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-sm transition-colors duration-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            @click="emit('rename-schema')"
          >
            <v-remixicon name="riEditLine" size="16" />
            <span>{{ t.renameDatabase || 'Rename database' }}</span>
          </button>
          <hr class="my-1 border-t border-neutral-200 dark:border-neutral-700" />
          <button
            data-test="menu-delete-db"
            class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-sm text-red-600 transition-colors duration-100 hover:bg-red-500/10 dark:text-red-400"
            @click="emit('delete-schema')"
          >
            <v-remixicon name="riDeleteBin6Line" size="16" />
            <span>{{ t.deleteDatabase || 'Delete database' }}</span>
          </button>
        </div>
      </ui-popover>
    </div>
  </div>
</template>
