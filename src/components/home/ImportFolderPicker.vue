<template>
  <ui-modal v-model="show" content-class="max-w-md" persist>
    <template #header>
      <h3 class="text-lg font-semibold">
        {{ translations.share?.importNoteDialogTitle || 'Import note' }}
      </h3>
      <p class="text-xs text-neutral-500 mt-1 truncate max-w-full">
        {{ noteTitle }}
      </p>
    </template>

    <div>
      <!-- Root option -->
      <div
        class="group flex items-center p-1.5 rounded-lg cursor-pointer transition-all duration-200"
        :class="{
          'bg-primary/10 text-primary font-medium ring-1 ring-primary/30':
            selectedId === null,
          'hover:bg-neutral-100 dark:hover:bg-neutral-800': selectedId !== null,
        }"
        @click="selectedId = null"
      >
        <div class="mr-2 flex items-center justify-center">
          <v-remixicon
            name="riFolder5Fill"
            class="w-5 h-5"
            :class="selectedId === null ? 'text-primary' : 'text-neutral-400'"
          />
        </div>
        <span class="flex-1 truncate text-sm">
          {{ translations.folderTree.root }}
        </span>
      </div>

      <hr class="my-1 border-neutral-100 dark:border-neutral-800" />

      <!-- Folder tree -->
      <div class="max-h-64 overflow-y-auto p-1">
        <folder-tree-item
          v-for="rootFolder in rootFolders"
          :key="rootFolder.id"
          :folder="rootFolder"
          :selected-id="selectedId"
          :current-folder-ids="emptySet"
          :disabled-ids="emptySet"
          @select="onSelect"
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
        <ui-button class="w-6/12 rtl:ml-2" @click="cancel">
          {{ translations.dialog.cancel }}
        </ui-button>
        <ui-button class="w-6/12" variant="primary" @click="confirm">
          {{ translations.folderTree.move || 'Import' }}
        </ui-button>
      </div>
    </div>
  </ui-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useFolderStore } from '@/store/folder';
import FolderTreeItem from './FolderTreeItem.vue';
import { useTranslations } from '@/composable/useTranslations';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  noteTitle: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel']);

const { translations } = useTranslations();
const folderStore = useFolderStore();

const show = ref(false);
const selectedId = ref(null);
const emptySet = computed(() => new Set());

const rootFolders = computed(() => {
  const list = Array.isArray(folderStore.validFolders)
    ? folderStore.validFolders
    : [];
  return list
    .filter((f) => !f.parentId)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
});

watch(
  () => props.modelValue,
  (value) => {
    show.value = value;
    if (!value) return;
    selectedId.value = null;
  }
);

function onSelect(id) {
  selectedId.value = id ?? null;
}

function cancel() {
  show.value = false;
  emit('update:modelValue', false);
  emit('cancel');
}

function confirm() {
  const folderId = selectedId.value ?? null;
  show.value = false;
  emit('update:modelValue', false);
  emit('confirm', folderId);
}
</script>
