<!-- src/components/FolderTreeItem.vue -->
<template>
  <div>
    <div
      class="flex items-center p-1 rounded hover:bg- cursor-pointer transition"
      :class="{
        'bg-primary bg-opacity-20': isSelected,
        'opacity-50': isCurrentFolder,
      }"
      :style="{ paddingLeft: level * 16 + 8 + 'px' }"
      @click="$emit('select', folder.id)"
    >
      <button
        v-if="children.length > 0"
        class="mr-1 p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded"
        @click.stop="isExpanded = !isExpanded"
      >
        <v-remixicon
          :name="isExpanded ? 'riArrowDownSLine' : 'riArrowRightSLine'"
          class="w-3 h-3"
        />
      </button>
      <div v-else class="w-4 mr-1"></div>

      <div class="mr-2">
        <span v-if="folder.icon" class="text-2xl select-none">{{
          folder.icon
        }}</span>
        <v-remixicon
          v-else
          name="riFolder5Fill"
          class="w-6 h-6"
          :style="{ color: folder.color || '#6B7280' }"
        />
      </div>
      <span class="flex-1" :class="{ 'text-neutral-400': isCurrentFolder }">
        {{ folder.name }}
        <span v-if="isCurrentFolder" class="text-xs">(current)</span>
      </span>
    </div>

    <div v-if="isExpanded && children.length > 0">
      <FolderTreeItem
        v-for="child in children"
        :key="child.id"
        :folder="child"
        :selected-id="selectedId"
        :current-note-folder="currentNoteFolder"
        :level="level + 1"
        @select="$emit('select', $event)"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useFolderStore } from '@/store/folder';

const props = defineProps({
  folder: {
    type: Object,
    default: () => ({}),
  },
  selectedId: {
    type: [String, null],
    default: null,
  },
  currentNoteFolder: {
    type: [String, null],
    default: null,
  },
  level: {
    type: Number,
    default: 0,
  },
});

defineEmits(['select']);

const folderStore = useFolderStore();
const isExpanded = ref(true);

const children = computed(() =>
  folderStore.validFolders.filter((f) => f.parentId === props.folder.id)
);

const isSelected = computed(() => props.selectedId === props.folder.id);
const isCurrentFolder = computed(
  () => props.currentNoteFolder === props.folder.id
);
</script>
