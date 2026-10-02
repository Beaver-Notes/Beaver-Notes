<template>
  <ui-modal v-model="show" content-class="max-w-md" persist>
    <template #header>
      <h3 class="text-lg font-semibold tracking-tight leading-snug">
        {{ translations.share?.importNoteDialogTitle || 'Import note' }}
      </h3>
      <p
        v-if="noteTitle"
        class="mt-1 max-w-full truncate text-xs text-neutral-500 dark:text-neutral-400"
      >
        {{ noteTitle }}
      </p>
    </template>

    <div>
      <!-- Root option -->
      <div
        role="option"
        :aria-selected="selectedId === null"
        tabindex="0"
        class="group flex min-h-[44px] cursor-pointer select-none items-center gap-2 rounded-xl px-2 py-2 transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 ring-secondary"
        :class="{
          'bg-primary/10 text-primary font-medium ring-1 ring-primary/30':
            selectedId === null,
          'hover:bg-neutral-100 dark:hover:bg-neutral-800': selectedId !== null,
        }"
        @click="selectedId = null"
        @keydown.enter.prevent="selectedId = null"
        @keydown.space.prevent="selectedId = null"
      >
        <div class="flex shrink-0 items-center justify-center">
          <v-remixicon
            name="riFolder5Fill"
            class="w-5 h-5"
            :class="selectedId === null ? 'text-primary' : 'text-neutral-400'"
          />
        </div>
        <span class="min-w-0 flex-1 truncate text-sm">
          {{ translations.folderTree.root }}
        </span>
      </div>

      <!-- Folder tree -->
      <div
        v-if="rootFolders.length > 0"
        role="tree"
        aria-label="Folders"
        class="min-h-[120px] max-h-[50dvh] mt-1 space-y-0.5 overflow-y-auto overscroll-contain"
      >
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
        v-else
        class="flex flex-col items-center px-4 py-10 text-center text-neutral-500 dark:text-neutral-400"
      >
        <div
          class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10"
        >
          <v-remixicon
            name="riFolder5Fill"
            class="text-2xl text-primary"
          />
        </div>
        <p class="text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {{ translations.folderTree.noFolders }}
        </p>
        <p class="mt-1 max-w-[26ch] text-xs">
          {{ translations.folderTree.newFolder }}
        </p>
      </div>
    </div>

    <template #actions>
      <ui-button
        class="flex-1 mobile:!min-h-[48px] mobile:w-full"
        @click="cancel"
      >
        {{ translations.dialog.cancel }}
      </ui-button>
      <ui-button
        class="flex-1 mobile:!min-h-[48px] mobile:w-full"
        variant="primary"
        @click="confirm"
      >
        {{ translations.folderTree.move || 'Import' }}
      </ui-button>
    </template>
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
  },
  { immediate: true }
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
