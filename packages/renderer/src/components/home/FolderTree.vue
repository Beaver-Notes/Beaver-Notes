<template>
  <ui-modal v-model="show" content-class="max-w-md" persist>
    <template #header>
      <h3 class="text-lg font-semibold">
        {{ translations.folderTree.moveToFolder }}
      </h3>
      <p class="text-xs text-neutral-500 mt-1">
        <!-- tiny hint showing selection type/count -->
        <span v-if="props.mode === 'note'"
          >{{ notes.length }} note{{ notes.length !== 1 ? 's' : '' }}</span
        >
        <span v-else
          >{{ folders.length }} folder{{
            folders.length !== 1 ? 's' : ''
          }}</span
        >
      </p>
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
        <span>{{ translations.folderTree.root }}</span>
      </div>

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
      <div class="mt-8 flex space-x-2 rtl:space-x-0">
        <ui-button class="w-6/12 rtl:ml-2" @click="closeModal">
          {{ translations.folderTree.cancel }}
        </ui-button>
        <ui-button
          class="w-6/12"
          :disabled="
            isMoving ||
            (props.mode === 'folder' &&
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
import { ref, computed, watch, onMounted } from 'vue';
import { useFolderStore } from '@/store/folder';
import FolderTreeItem from './FolderTreeItem.vue';
import { useNoteStore } from '@/store/note';
import { useTranslation } from '@/composable/translations';

const props = defineProps({
  notes: { type: Array, default: () => [] },
  folders: { type: Array, default: () => [] },
  modelValue: { type: Boolean, default: false },
  mode: {
    type: String,
    default: 'note',
    validator: (val) => ['note', 'folder'].includes(val),
  },
});

const translations = ref({ folderTree: {} });
onMounted(async () => {
  const trans = await useTranslation();
  if (trans) translations.value = trans;
});

const emit = defineEmits(['update:modelValue', 'moved']);

const folderStore = useFolderStore();
const noteStore = useNoteStore();

const show = ref(false);
const selectedId = ref(null);
const isMoving = ref(false);

/** Guarded root list */
const rootFolders = computed(() => {
  const list = Array.isArray(folderStore.validFolders)
    ? folderStore.validFolders
    : [];
  return list
    .filter((f) => !f.parentId)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
});

/** If moving notes, compute a set (usually size 1 or more) of their current folderIds (null allowed). */
const currentFolderIds = computed(() => {
  if (props.mode !== 'note') return new Set();
  return new Set(props.notes.map((n) => n?.folderId ?? null));
});

/** Preselect a sensible target:
 *  - notes: common folder if all in same folder, else null
 *  - folders: common parent if all share a parent, else null
 */
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

/** Targets that must be disabled when moving folders (self or any descendant). */
const disabledTargetIds = computed(() => {
  if (props.mode !== 'folder' || props.folders.length === 0) return new Set();
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

/** Single watcher to open/initialize */
watch(
  () => props.modelValue,
  (value) => {
    show.value = value;
    if (!value) return;
    selectedId.value =
      props.mode === 'note'
        ? commonNoteFolderId.value
        : commonFolderParentId.value;
  }
);

function onSelect(id) {
  // block selecting invalid targets when moving folders
  if (props.mode === 'folder' && id != null && disabledTargetIds.value.has(id))
    return;
  selectedId.value = id ?? null;
}

function closeModal() {
  show.value = false;
  emit('update:modelValue', false);
}

async function handleMove() {
  if (isMoving.value) return;
  isMoving.value = true;
  try {
    if (props.mode === 'folder' && props.folders.length) {
      // move folders under selectedId (may be null => root)
      await Promise.all(
        props.folders.map((folder) =>
          folderStore.move(folder.id, selectedId.value)
        )
      );
    } else if (props.mode === 'note' && props.notes.length) {
      await Promise.all(
        props.notes.map((note) =>
          noteStore.moveToFolder(note.id, selectedId.value)
        )
      );
    }
    emit('moved', { folderId: selectedId.value });
    emit('update:modelValue', false);
  } catch (error) {
    console.error('Move failed:', error);
  } finally {
    isMoving.value = false;
  }
}
</script>
