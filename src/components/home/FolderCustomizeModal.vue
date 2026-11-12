<template>
  <ui-customize-editor
    :model-value="modelValue"
    kind="folder"
    :title="
      isEdit
        ? translations.card?.customize || 'Customize'
        : translations.sidebar?.newFolder || 'New folder'
    "
    :primary-label="
      isEdit
        ? translations.dialog?.done || 'Done'
        : translations.card?.create || 'Create'
    "
    :name-placeholder="translations.card?.untitledFolder || 'Folder name'"
    :initial-name="initialName"
    :initial-color="initialColor"
    :initial-icon="initialIcon"
    :quick-icons="FOLDER_QUICK_ICONS"
    :saving="saving"
    :autofocus-name="!isEdit"
    :disable-primary-when-empty="true"
    :show-use-default="true"
    @update:model-value="$emit('update:modelValue', $event)"
    @close="$emit('update:modelValue', false)"
    @save="save"
  />
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useFolderStore } from '@/store/folder';
import { useTranslations } from '@/composable/useTranslations';
import { CUSTOMIZE_DEFAULT_COLOR, FOLDER_QUICK_ICONS } from '@/lib/customize';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  folder: { type: Object, default: null },
  parentId: { type: String, default: null },
});

const emit = defineEmits(['update:modelValue', 'saved']);

const folderStore = useFolderStore();
const { translations } = useTranslations();

const initialName = ref('');
const initialColor = ref(CUSTOMIZE_DEFAULT_COLOR);
const initialIcon = ref('');
const saving = ref(false);

const isEdit = computed(() => !!props.folder);

function syncForm() {
  initialName.value = props.folder?.name || '';
  initialColor.value = props.folder?.color || CUSTOMIZE_DEFAULT_COLOR;
  initialIcon.value = props.folder?.icon || '';
}

watch(
  () => [props.modelValue, props.folder],
  () => {
    if (props.modelValue) syncForm();
  },
  { immediate: true },
);

async function save({ name, color, icon }) {
  if (!name || saving.value) return;
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
}
</script>
