<template>
  <ui-modal v-model="show" content-class="max-w-md" :overlay-class="overlayClass" persist>
    <template #header>
      <h3 class="text-lg font-semibold">
        {{ moveLabel }}
      </h3>
      <p class="text-xs text-neutral-500 mt-1">
        <!-- tiny hint showing selection type/count -->
        <span v-if="props.mode === 'note'"
          >{{ notes.length }} {{ noteCountLabel }}</span
        >
        <span v-else>{{ folders.length }} {{ folderCountLabel }}</span>
      </p>
    </template>

    <div>
      <!-- Root option -->
      <div
        class="group flex items-center p-1.5 rounded-lg cursor-pointer transition-colors duration-200"
        :class="{
          'bg-primary/10 text-primary font-medium ring-1 ring-primary/30':
            selectedId === null,
          'hover:bg-neutral-100 dark:hover:bg-neutral-800': selectedId !== null,
        }"
        @click="selectedId = null"
      >
        <div class="ltr:mr-2 rtl:ml-2 flex items-center justify-center">
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
          :current-folder-ids="currentFolderIds"
          :disabled-ids="disabledTargetIds"
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
      <div class="mt-8 flex gap-2 mobile:flex-col-reverse mobile:gap-3">
        <ui-button
          class="w-6/12 mobile:w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
          @click="closeModal"
        >
          {{ translations.dialog.cancel }}
        </ui-button>
        <ui-button
          class="w-6/12 mobile:w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
          :disabled="
            isMoving ||
            isNoopTarget ||
            ((props.mode === 'folder' || props.mode === 'mixed') &&
              disabledTargetIds.has(selectedId || undefined))
          "
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
import { ref, computed, watch } from 'vue';
import { useFolderStore } from '@/store/folder';
import FolderTreeItem from './FolderTreeItem.vue';
import { useNoteStore } from '@/store/note';
import { useTranslations } from '@/composable/useTranslations';

const props = defineProps({
  notes: { type: Array, default: () => [] },
  folders: { type: Array, default: () => [] },
  modelValue: { type: Boolean, default: false },
  overlayClass: { type: String, default: 'z-50' },
  mode: {
    type: String,
    default: 'note',
    validator: (val) => ['note', 'folder', 'mixed'].includes(val),
  },
});

const { translations } = useTranslations();

const emit = defineEmits(['update:modelValue', 'moved']);

const folderStore = useFolderStore();
const noteStore = useNoteStore();

const show = ref(false);
const selectedId = ref(null);
const isMoving = ref(false);

const rootFolders = computed(() => {
  const list = Array.isArray(folderStore.validFolders)
    ? folderStore.validFolders
    : [];
  return list
    .filter((f) => !f.parentId)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
});

const currentFolderIds = computed(() => {
  if (props.mode !== 'note') return new Set();
  return new Set(props.notes.map((n) => n?.folderId ?? null));
});

const commonNoteFolderId = computed(() => {
  if (props.mode !== 'note' || props.notes.length === 0) return null;
  const s = new Set(props.notes.map((n) => n?.folderId ?? null));
  return s.size === 1 ? [...s][0] : null;
});

const commonFolderParentId = computed(() => {
  if (props.mode !== 'folder' || props.folders.length === 0) return null;
  const s = new Set(props.folders.map((f) => f?.parentId ?? null));
  return s.size === 1 ? [...s][0] : null;
});

const disabledTargetIds = computed(() => {
  if ((props.mode !== 'folder' && props.mode !== 'mixed') || props.folders.length === 0) return new Set();
  const all = Array.isArray(folderStore.validFolders)
    ? folderStore.validFolders
    : [];
  const childrenByParent = new Map();
  all.forEach((f) => {
    const arr = childrenByParent.get(f.parentId) || [];
    arr.push(f);
    childrenByParent.set(f.parentId, arr);
  });
  const out = new Set();
  const addSubtree = (id) => {
    out.add(id);
    const kids = childrenByParent.get(id) || [];
    kids.forEach((k) => addSubtree(k.id));
  };
  props.folders.forEach((f) => addSubtree(f.id));
  return out;
});

const isNoopTarget = computed(() => {
  const target = selectedId.value ?? null;
  if (props.mode === 'note') {
    if (!props.notes.length) return false;
    return props.notes.every((n) => (n?.folderId ?? null) === target);
  }
  if (props.mode === 'folder') {
    if (!props.folders.length) return false;
    return props.folders.every((f) => (f?.parentId ?? null) === target);
  }
  if (props.mode === 'mixed') {
    if (!props.notes.length && !props.folders.length) return false;
    const foldersNoop = props.folders.length
      ? props.folders.every((f) => (f?.parentId ?? null) === target)
      : true;
    const notesNoop = props.notes.length
      ? props.notes.every((n) => (n?.folderId ?? null) === target)
      : true;
    return foldersNoop && notesNoop;
  }
  return false;
});

watch(
  () => props.modelValue,
  (value) => {
    show.value = value;
    if (!value) return;
    if (props.mode === 'note') selectedId.value = commonNoteFolderId.value;
    else if (props.mode === 'folder') selectedId.value = commonFolderParentId.value;
    else selectedId.value = null;
  },
  { immediate: true }
);

function onSelect(id) {
  // block selecting invalid targets when moving folders
  if ((props.mode === 'folder' || props.mode === 'mixed') && id != null && disabledTargetIds.value.has(id))
    return;
  selectedId.value = id ?? null;
}

function closeModal() {
  show.value = false;
  emit('update:modelValue', false);
}

const moveLabel = computed(() => {
  const n = props.mode === 'mixed' ? props.notes.length + props.folders.length : props.mode === 'note' ? props.notes.length : props.folders.length;
  return n === 1
    ? translations.value.folderTree.moveToFolder
    : translations.value.folderTree.moveItemsToFolder.replace('{count}', n);
});

const noteCountLabel = computed(() =>
  props.notes.length === 1
    ? translations.value.folderTree?.noteSingular || 'note'
    : translations.value.folderTree?.notePlural || 'notes'
);

const folderCountLabel = computed(() =>
  props.folders.length === 1
    ? translations.value.folderTree?.folderSingular || 'folder'
    : translations.value.folderTree?.folderPlural || 'folders'
);

  async function handleMove() {
    if (isMoving.value) return;
    if (isNoopTarget.value) {
      show.value = false;
      emit('update:modelValue', false);
      return;
    }
    isMoving.value = true;
    const targetId = selectedId.value ?? null;
    let moved = false;
    try {
      const { useUndoStore } = await import('@/store/undo');
      const undo = useUndoStore();
      undo.startBatch();
      try {
        if (props.folders.length) {
          for (const f of props.folders) {
            if ((f?.parentId ?? null) === targetId) continue;
            if (folderStore.wouldCreateCircularReference(f.id, targetId)) continue;
            await folderStore.move(f.id, targetId);
            moved = true;
          }
        }
        if (props.notes.length) {
          const ids = props.notes
            .filter((n) => (n?.folderId ?? null) !== targetId)
            .map((n) => n.id)
            .filter(Boolean);
          if (ids.length) {
            await noteStore.moveToFolder(ids, targetId);
            moved = true;
          }
        }
      } finally {
        undo.commitBatch();
      }
      if (moved) emit('moved', { folderId: targetId, notes: [...props.notes], folders: [...props.folders] });
    } catch (error) {
      console.error('Move failed:', error);
    } finally {
      isMoving.value = false;
      show.value = false;
      emit('update:modelValue', false);
    }
  }
</script>
