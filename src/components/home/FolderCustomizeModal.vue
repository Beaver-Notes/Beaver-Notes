<template>
  <ui-modal
    :model-value="modelValue"
    content-class="max-w-sm"
    @close="$emit('update:modelValue', false)"
  >
    <template #header>
      <span class="font-semibold text-lg mb-3">
        {{ isEdit ? (translations.card?.rename || 'Edit folder') : (translations.sidebar?.newFolder || 'New folder') }}
      </span>
    </template>

    <template #actions>
      <div class="flex justify-end gap-2 pb-2 pt-3 border-t border-neutral-200 dark:border-neutral-700">
        <ui-button @click="$emit('update:modelValue', false)">
          {{ translations.dialog?.cancel || 'Cancel' }}
        </ui-button>
        <ui-button
          variant="primary"
          :disabled="!name.trim()"
          :loading="saving"
          @click="save"
        >
          {{ isEdit ? (translations.card?.rename || 'Save') : (translations.card?.create || 'Create') }}
        </ui-button>
      </div>
    </template>

    <div class="space-y-4">
      <ui-input
        v-model="name"
        :placeholder="translations.card?.untitledFolder || 'Folder name'"
        autofocus
        @keydown.enter="save"
      />

      <!-- Color swatches (token colors) -->
      <div>
        <p class="text-[11px] font-semibold text-neutral-500 mb-2">
          {{ translations.card?.colors || 'Colors' }}
        </p>
        <div class="grid grid-cols-7 gap-2">
          <button
            v-for="color in FOLDER_ICON_COLORS"
            :key="color"
            class="p-1.5 rounded-xl transition-colors"
            :class="{
              'ring-2 ring-primary ring-inset bg-neutral-100 dark:bg-neutral-900': isColorSelected(color),
              'hover:bg-neutral-100 dark:hover:bg-neutral-800': !isColorSelected(color),
            }"
            @click="selectedColor = color"
          >
            <v-remixicon
              name="riFolder5Fill"
              class="w-6 h-6 mx-auto"
              :style="{ color }"
            />
          </button>
        </div>
      </div>

      <!-- Emoji picker (lazy-mounted when the modal opens) -->
      <ui-emoji-picker
        v-if="modelValue"
        :current="selectedIcon"
        @select="selectedIcon = $event"
      />

      <!-- Actions (edit mode only) -->
      <div
        v-if="isEdit"
        class="border-t border-neutral-200 dark:border-neutral-700 pt-3"
      >
        <p class="text-[11px] font-semibold text-neutral-500 mb-2">
          {{ translations.card?.actions || 'Actions' }}
        </p>
        <div class="flex flex-col gap-1">
          <button
            class="flex w-full items-center gap-2 rounded-lg p-2.5 text-left text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            @click="toggleArchive"
          >
            <v-remixicon
              :name="folder?.isArchived ? 'riInboxUnarchiveLine' : 'riArchiveLine'"
            />
            <span>{{
              folder?.isArchived
                ? (translations.card?.unarchive || 'Unarchive')
                : (translations.card?.archive || 'Archive')
            }}</span>
          </button>
          <button
            class="flex w-full items-center gap-2 rounded-lg p-2.5 text-left text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            @click="showMoveModal = true"
          >
            <v-remixicon name="riFolderTransferLine" />
            <span>{{ translations.card?.moveToFolder || 'Move to folder' }}</span>
          </button>
          <button
            class="flex w-full items-center gap-2 rounded-lg p-2.5 text-left text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
            @click="deleteFolder"
          >
            <v-remixicon name="riDeleteBin6Line" />
            <span>{{ translations.card?.delete || 'Delete' }}</span>
          </button>
        </div>
      </div>
    </div>

    <folder-tree
      v-model="showMoveModal"
      :folders="folder ? [folder] : []"
      mode="folder"
    />
  </ui-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useFolderStore } from '@/store/folder';
import { useDialog } from '@/lib/dialog';
import { useTranslations } from '@/composable/useTranslations';
import FolderTree from './FolderTree.vue';
import {
  FOLDER_ICON_COLORS,
  DEFAULT_FOLDER_COLOR,
} from '@/lib/folder-styles';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  folder: { type: Object, default: null },
  parentId: { type: String, default: null },
});

const emit = defineEmits(['update:modelValue', 'saved']);

const folderStore = useFolderStore();
const dialog = useDialog();
const { translations } = useTranslations();

const name = ref('');
const selectedColor = ref(null);
const selectedIcon = ref('');
const saving = ref(false);
const showMoveModal = ref(false);

const isEdit = computed(() => !!props.folder);

function syncForm() {
  name.value = props.folder?.name || '';
  selectedColor.value = props.folder?.color || null;
  selectedIcon.value = props.folder?.icon || '';
}

watch(
  () => [props.modelValue, props.folder],
  () => {
    if (props.modelValue) syncForm();
  },
  { immediate: true }
);

function isColorSelected(color) {
  return selectedColor.value === color || (!selectedColor.value && color === DEFAULT_FOLDER_COLOR);
}

function toggleArchive() {
  if (!props.folder) return;
  if (props.folder.isArchived) {
    folderStore.unarchive(props.folder.id);
  } else {
    folderStore.archive(props.folder.id);
  }
}

function deleteFolder() {
  if (!props.folder) return;
  dialog.confirm({
    title: translations.value?.card?.confirmPromptFolder || 'Are you sure you want to delete this folder?',
    body: translations.value?.card?.deleteAction || 'This action cannot be undone',
    icon: 'riDeleteBin6Line',
    okVariant: 'danger',
    onConfirm: async () => {
      await folderStore.delete(props.folder.id, { deleteContents: true });
      emit('update:modelValue', false);
      emit('saved', props.folder.id);
    },
  });
}

async function save() {
  if (!name.value.trim() || saving.value) return;
  saving.value = true;
  try {
    const payload = {
      name: name.value.trim(),
      color: selectedColor.value || DEFAULT_FOLDER_COLOR,
      icon: selectedIcon.value || '',
    };
    let id = props.folder?.id || null;
    if (props.folder) {
      await folderStore.update(props.folder.id, payload);
      id = props.folder.id;
    } else {
      const created = await folderStore.add({ ...payload, parentId: props.parentId });
      id = created?.id || null;
    }
    emit('update:modelValue', false);
    emit('saved', id);
  } finally {
    saving.value = false;
  }
}
</script>
