<template>
  <ui-modal v-model="show" content-class="max-w-md" persist>
    <template #header>
      <h3 class="text-lg font-semibold">
        {{ translations.folderTree.moveToFolder }}
      </h3>
    </template>

    <div>
      <!-- Root option -->
      <div
        class="flex items-center p-2 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer transition"
        :class="{ 'bg-primary bg-opacity-20': selectedId === null }"
        @click="selectedId = null"
      >
        <v-remixicon
          name="riHomeLine"
          class="mr-2 text-neutral-500"
          :class="{ 'text-primary': selectedId === null }"
        />
        <span> {{ translations.folderTree.root }} </span>
      </div>

      <!-- Folder tree -->
      <div class="max-h-64 overflow-y-auto p-1">
        <folder-tree-item
          v-for="rootFolder in rootFolders"
          :key="rootFolder.id"
          :folder="rootFolder"
          :selected-id="selectedId"
          :current-note-folder="note?.folderId"
          @select="selectedId = $event"
        />
      </div>

      <!-- No folders message -->
      <div
        v-if="rootFolders.length === 0"
        class="text-center py-8 text-neutral-500"
      >
        <v-remixicon name="riFolder5Fill" class="text-4xl mb-2 text-primary" />
        <p>{{ translations.folderTree.noFolders }}</p>
        <p class="text-sm">{{ translations.folderTree.newFolder }}</p>
      </div>

      <!-- Action buttons -->

      <div class="mt-8 flex space-x-2 rtl:space-x-0">
        <ui-button class="w-6/12 rtl:ml-2" @click="closeModal">{{
          translations.folderTree.cancel
        }}</ui-button>
        <ui-button
          class="w-6/12"
          :disabled="isMoving"
          :variant="'primary'"
          @click="handleMove"
        >
          {{ translations.folderTree.move }}
        </ui-button>
      </div>
    </div>
  </ui-modal>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useFolderStore } from '@/store/folder';
import FolderTreeItem from './FolderTreeItem.vue';
import { useNoteStore } from '@/store/note';
import { useTranslation } from '@/composable/translations';

const props = defineProps({
  note: {
    type: Object,
    default: null,
  },
  folder: {
    type: Object,
    default: null,
  },
  modelValue: {
    type: Boolean,
    default: false,
  },
  mode: {
    type: String,
    default: 'note',
    validator: (val) => ['note', 'folder'].includes(val),
  },
});

const translations = ref({
  folderTree: {},
});

onMounted(async () => {
  await useTranslation().then((trans) => {
    if (trans) {
      translations.value = trans;
    }
  });
});

const emit = defineEmits(['update:modelValue', 'moved']);

const folderStore = useFolderStore();
const noteStore = useNoteStore();

const show = ref(false);
const selectedId = ref(null);
const isMoving = ref(false);

const rootFolders = computed(() => {
  return folderStore.validFolders
    .filter((f) => !f.parentId || f.parentId === null)
    .sort((a, b) => a.name.localeCompare(b.name));
});

watch(
  () => props.modelValue,
  (value) => {
    show.value = value;
    if (value && props.note) {
      selectedId.value = props.note.folderId || null;
    }
  }
);

watch(show, (value) => {
  emit('update:modelValue', value);
  if (!value) {
    selectedId.value = null;
    isMoving.value = false;
  }
});

function closeModal() {
  show.value = false;
}

async function handleMove() {
  if (
    selectedId.value === props.note?.folderId ||
    selectedId.value === props.folder?.parentId
  ) {
    return;
  }

  try {
    if (props.mode === 'folder' && props.folder) {
      await folderStore.move(props.folder.id, selectedId.value);
      emit('moved', {
        folderId: selectedId.value,
      });
    } else if (props.mode === 'note' && props.note) {
      await noteStore.moveToFolder(props.note.id, selectedId.value);
      emit('moved', {
        folderId: selectedId.value,
      });
    }

    emit('update:modelValue', false);
  } catch (error) {
    console.error('Move failed:', error);
  }
}
</script>
