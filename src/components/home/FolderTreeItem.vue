<template>
  <div>
    <div
      role="treeitem"
      :aria-selected="isSelected"
      :aria-disabled="isDisabled || undefined"
      :tabindex="isDisabled ? -1 : 0"
      class="flex min-h-[44px] cursor-pointer select-none items-center gap-1 rounded-xl px-2 py-2 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 ring-secondary group"
      :class="{
        'font-medium': isSelected,
        'hover:bg-neutral-100 dark:hover:bg-neutral-800':
          !isSelected && !isDisabled,
        'opacity-40 grayscale pointer-events-none': isDisabled,
      }"
      :style="{
        paddingInlineStart: level * 8 + 8 + 'px',
        backgroundColor: isSelected
          ? `${folder.color || '#6366f1'}1A`
          : 'transparent',
        boxShadow: isSelected
          ? `inset 0 0 0 1px ${folder.color || '#6366f1'}4D`
          : 'none',
        color: isSelected ? folder.color || '#6366f1' : 'inherit',
      }"
      @click="!isDisabled && $emit('select', folder.id)"
      @keydown.enter.prevent="!isDisabled && $emit('select', folder.id)"
      @keydown.space.prevent="!isDisabled && $emit('select', folder.id)"
    >
      <button
        v-if="sortedChildren.length > 0"
        type="button"
        :aria-label="isExpanded ? 'Collapse' : 'Expand'"
        :aria-expanded="isExpanded"
        class="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition hover:bg-neutral-200 dark:hover:bg-neutral-700"
        @click.stop="isExpanded = !isExpanded"
      >
        <v-remixicon
          :name="isExpanded ? 'riArrowDownSLine' : 'riArrowRightSLine'"
          class="w-4 h-4"
          :class="{ 'rtl:rotate-180': !isExpanded }"
          :style="{ color: isSelected ? folder.color || '#6366f1' : '#9CA3AF' }"
        />
      </button>
      <div v-else class="w-8 shrink-0 ltr:-mr-1 rtl:-ml-1"></div>

      <div class="flex shrink-0 items-center justify-center">
        <span v-if="folder.icon" class="text-lg leading-none">{{
          folder.icon
        }}</span>
        <v-remixicon
          v-else
          :name="isExpanded ? 'riFolderOpenFill' : 'riFolder5Fill'"
          class="w-5 h-5"
          :style="{ color: isSelected ? 'inherit' : folder.color || '#6366f1' }"
        />
      </div>

      <span class="min-w-0 flex-1 truncate text-sm">
        {{ folder.name || translations.folderTree.untitledFolder }}
      </span>

      <v-remixicon
        v-if="folder.isArchived"
        name="riArchiveLine"
        class="w-3.5 h-3.5 shrink-0 text-neutral-400"
        title="Archived"
      />

      <span
        v-if="isCurrentFolder"
        class="shrink-0 rounded-full bg-neutral-200/70 px-2 py-0.5 text-[11px] font-semibold tracking-wide opacity-70 dark:bg-neutral-700/70"
      >
        Current
      </span>
    </div>

    <div
      v-if="isExpanded && sortedChildren.length > 0 && level < 20"
      role="group"
      class="mt-0.5 space-y-0.5"
    >
      <FolderTreeItem
        v-for="child in sortedChildren"
        :key="child.id"
        :folder="child"
        :selected-id="selectedId"
        :current-folder-ids="currentFolderIds"
        :disabled-ids="disabledIds"
        :level="level + 1"
        @select="$emit('select', $event)"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useFolderStore } from '@/store/folder';
import { useTranslations } from '@/composable/useTranslations';

defineOptions({ name: 'FolderTreeItem' });

const props = defineProps({
  folder: { type: Object, default: () => ({}) },
  selectedId: { type: [String, null], default: null },
  currentFolderIds: { type: Object, default: () => new Set() }, // Set<string|null>
  disabledIds: { type: Object, default: () => new Set() }, // Set<string>
  level: { type: Number, default: 0 },
});

defineEmits(['select']);

const folderStore = useFolderStore();
const { translations } = useTranslations();
const isExpanded = ref(true);

const sortedChildren = computed(() => {
  const list = folderStore.getByParent(props.folder.id) || [];
  return [...list]
    .filter(Boolean)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
});

const isSelected = computed(() => props.selectedId === props.folder.id);
const isCurrentFolder = computed(() =>
  props.currentFolderIds.has(props.folder.id)
);
const isDisabled = computed(() => props.disabledIds.has(props.folder.id));
</script>
