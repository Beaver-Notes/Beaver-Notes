<template>
  <ui-customize-editor
    :model-value="modelValue"
    :kind="kind"
    :title="title"
    :primary-label="primaryLabel"
    :name-placeholder="namePlaceholder"
    :initial-name="initialName"
    :initial-color="initialColor"
    :initial-icon="initialIcon"
    :saving="saving"
    :error="error"
    :autofocus-name="!isEdit"
    :disable-primary-when-empty="kind === 'folder'"
    :show-use-default="kind === 'folder'"
    :overlay-class="overlayClass"
    :persist="persist"
    @update:model-value="onEditorModelValue"
    @close="onEditorClose"
    @save="save"
  />
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useFolderStore } from '@/store/folder';
import { useTranslations } from '@/composable/useTranslations';
import {
  CUSTOMIZE_DEFAULT_COLOR,
  WORKSPACE_DEFAULT_EMOJI,
} from '@/lib/customize';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  kind: {
    type: String,
    default: 'folder',
    validator: (v) => ['folder', 'workspace'].includes(v),
  },
  // Folder mode: create under `parentId` or edit `folder`.
  folder: { type: Object, default: null },
  parentId: { type: String, default: null },
  // Workspace mode: edit `workspace`, otherwise create. Saving runs through
  // `submitHandler` when given so the caller keeps its loading/error state.
  workspace: { type: Object, default: null },
  submitHandler: { type: Function, default: null },
  overlayClass: { type: String, default: 'z-50' },
  persist: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'saved', 'close']);

const folderStore = useFolderStore();
const { translations } = useTranslations();

const initialName = ref('');
const initialColor = ref(CUSTOMIZE_DEFAULT_COLOR);
const initialIcon = ref('');
const saving = ref(false);
const error = ref('');

const isEdit = computed(() =>
  props.kind === 'folder' ? !!props.folder : !!props.workspace,
);

const title = computed(() => {
  if (props.kind === 'folder') {
    return isEdit.value
      ? translations.value.card?.customize || 'Customize'
      : translations.value.sidebar?.newFolder || 'New folder';
  }
  return isEdit.value
    ? translations.value.workspaceDialog?.editWorkspace || 'Edit Workspace'
    : translations.value.workspaceDialog?.newWorkspace || 'New Workspace';
});

const primaryLabel = computed(() => {
  if (props.kind === 'folder') {
    return isEdit.value
      ? translations.value.dialog?.done || 'Done'
      : translations.value.card?.create || 'Create';
  }
  return isEdit.value
    ? translations.value.workspaceDialog?.save || 'Save'
    : translations.value.workspaceDialog?.create || 'Create';
});

const namePlaceholder = computed(() =>
  props.kind === 'folder'
    ? translations.value.card?.untitledFolder || 'Folder name'
    : translations.value.workspaceDialog?.nameLabel || 'Workspace name',
);

function syncForm() {
  initialName.value = props.folder?.name || props.workspace?.name || '';
  initialColor.value =
    props.folder?.color || props.workspace?.color || CUSTOMIZE_DEFAULT_COLOR;
  initialIcon.value =
    props.kind === 'workspace'
      ? props.workspace?.emoji || WORKSPACE_DEFAULT_EMOJI
      : props.folder?.icon || '';
  saving.value = false;
  error.value = '';
}

watch(
  () => [props.modelValue, props.folder, props.workspace],
  () => {
    if (props.modelValue) syncForm();
  },
  { immediate: true },
);

function onEditorModelValue(value) {
  if (!value) {
    saving.value = false;
    error.value = '';
  }
  emit('update:modelValue', value);
}

function onEditorClose() {
  saving.value = false;
  error.value = '';
  emit('update:modelValue', false);
  emit('close');
}

async function save({ name, color, icon }) {
  if (saving.value) return;

  if (props.kind === 'folder') {
    if (!name) return;
    saving.value = true;
    try {
      const payload = {
        name,
        color: color || CUSTOMIZE_DEFAULT_COLOR,
        icon: icon || '',
      };
      let id = props.folder?.id || null;
      if (props.folder) {
        await folderStore.update(props.folder.id, payload);
        id = props.folder.id;
      } else {
        const created = await folderStore.add({
          ...payload,
          parentId: props.parentId,
        });
        id = created?.id || null;
      }
      emit('update:modelValue', false);
      emit('saved', id);
    } finally {
      saving.value = false;
    }
    return;
  }

  if (!name.trim()) {
    error.value =
      translations.value.workspaceDialog?.nameRequired ||
      'Workspace name is required.';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const payload = {
      name: name.trim(),
      emoji: icon || WORKSPACE_DEFAULT_EMOJI,
      color,
    };
    if (props.submitHandler) await props.submitHandler(payload);
    emit('update:modelValue', false);
    emit('close');
  } catch (err) {
    error.value =
      err?.message ||
      translations.value.workspaceDialog?.saveFailed ||
      'Failed to save workspace.';
  } finally {
    saving.value = false;
  }
}
</script>
