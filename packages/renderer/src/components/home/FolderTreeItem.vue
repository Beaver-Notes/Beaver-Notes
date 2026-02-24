<template>
  <div
    class="relative flex items-center p-2 rounded-md cursor-pointer transition-all duration-200 group"
    :class="{
      'font-medium': isSelected,
      'hover:bg-neutral-100 dark:hover:bg-neutral-800':
        !isSelected && !isDisabled,
      'opacity-40 grayscale pointer-events-none': isDisabled,
    }"
    :style="{
      paddingLeft: level * 16 + 12 + 'px',
      backgroundColor: isSelected
        ? `${folder.color || '#6B7280'}1A`
        : 'transparent',
      boxShadow: isSelected
        ? `inset 0 0 0 1px ${folder.color || '#6B7280'}4D`
        : 'none',
      color: isSelected ? folder.color || '#6B7280' : 'inherit',
    }"
    @click="!isDisabled && $emit('select', folder.id)"
  >
    <div
      v-if="level > 0"
      class="absolute left-0 top-0 bottom-0 border-l border-neutral-200 dark:border-neutral-700"
      :style="{ left: level * 16 + 'px' }"
    ></div>

    <button
      v-if="children.length > 0"
      class="z-10 mr-1 p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition"
      @click.stop="isExpanded = !isExpanded"
    >
      <v-remixicon
        :name="isExpanded ? 'riArrowDownSLine' : 'riArrowRightSLine'"
        class="w-4 h-4"
        :style="{ color: isSelected ? folder.color || '#6B7280' : '#9CA3AF' }"
      />
    </button>
    <div v-else class="w-5 mr-1"></div>

    <div class="mr-2 flex items-center justify-center">
      <span v-if="folder.icon" class="text-lg">{{ folder.icon }}</span>
      <v-remixicon
        v-else
        :name="isExpanded ? 'riFolderOpenFill' : 'riFolder5Fill'"
        class="w-5 h-5"
        :style="{ color: isSelected ? 'inherit' : folder.color || '#6B7280' }"
      />
    </div>

    <span class="flex-1 truncate text-sm">
      {{ folder.name || translations.folderTree.untitledFolder }}
    </span>

    <span
      v-if="isCurrentFolder"
      class="text-[10px] uppercase tracking-wider opacity-60 ml-2"
    >
      Current
    </span>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useFolderStore } from '@/store/folder';
import { useTranslations } from '@/composable/useTranslations';

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

const children = computed(() =>
  folderStore.validFolders.filter((f) => f.parentId === props.folder.id)
);

const isSelected = computed(() => props.selectedId === props.folder.id);
const isCurrentFolder = computed(() =>
  props.currentFolderIds.has(props.folder.id)
);
const isDisabled = computed(() => props.disabledIds.has(props.folder.id));
</script>
