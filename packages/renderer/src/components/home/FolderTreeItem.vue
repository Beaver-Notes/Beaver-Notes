<template>
  <div>
    <div
      class="flex items-center p-2 rounded hover:bg-primary hover:bg-opacity-30 cursor-pointer transition"
      :class="{
        'bg-primary bg-opacity-20': isSelected,
        'opacity-50': isCurrentFolder || isDisabled,
        'pointer-events-none': isDisabled,
      }"
      :style="{ paddingLeft: level * 16 + 8 + 'px' }"
      @click="!isDisabled && $emit('select', folder.id)"
    >
      <button
        v-if="children.length > 0"
        class="mr-1 p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded"
        :class="{ 'hover:bg-primary hover:bg-opacity-20': isSelected }"
        @click.stop="isExpanded = !isExpanded"
      >
        <v-remixicon
          :name="isExpanded ? 'riArrowDownSLine' : 'riArrowRightSLine'"
          class="w-3 h-3"
        />
      </button>
      <div v-else class="w-4 mr-1"></div>

      <div class="mr-2">
        <span v-if="folder.icon" class="text-xl select-none">{{
          folder.icon
        }}</span>
        <v-remixicon
          v-else
          name="riFolder5Fill"
          class="w-6 h-6"
          :style="{ color: folder.color || '#6B7280' }"
        />
      </div>

      <span
        class="flex-1 truncate"
        :class="{ 'text-neutral-800 dark:text-neutral-200': isCurrentFolder }"
      >
        {{ folder.name || translations.folderTree.untitledFolder }}
      </span>
    </div>

    <div v-if="isExpanded && children.length > 0">
      <FolderTreeItem
        v-for="child in children"
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
import { ref, computed, onMounted } from 'vue';
import { useFolderStore } from '@/store/folder';
import { useTranslation } from '@/composable/translations';

const props = defineProps({
  folder: { type: Object, default: () => ({}) },
  selectedId: { type: [String, null], default: null },
  /** For notes: may contain 0/1/many folder ids; used to mark "current" */
  currentFolderIds: { type: Object, default: () => new Set() }, // Set<string|null>
  /** For folders: targets you cannot drop into (self/descendants) */
  disabledIds: { type: Object, default: () => new Set() }, // Set<string>
  level: { type: Number, default: 0 },
});

defineEmits(['select']);

const folderStore = useFolderStore();
const isExpanded = ref(true);

const children = computed(() =>
  folderStore.validFolders.filter((f) => f.parentId === props.folder.id)
);

const isSelected = computed(() => props.selectedId === props.folder.id);
const isCurrentFolder = computed(() =>
  props.currentFolderIds.has(props.folder.id)
);
const isDisabled = computed(() => props.disabledIds.has(props.folder.id));

const translations = ref({ folderTree: {} });
onMounted(async () => {
  const trans = await useTranslation();
  if (trans) translations.value = trans;
});
</script>
