<template>
  <ui-modal
    :model-value="modelValue"
    content-class="max-w-sm"
    @close="$emit('update:modelValue', false)"
  >
    <template #header>
      <span class="font-semibold text-lg mb-3">
        {{ isEdit ? (translations.card?.customize || 'Customize') : (translations.sidebar?.newFolder || 'New folder') }}
      </span>
    </template>

    <template #actions>
      <div
        class="flex justify-end gap-2 pb-2 pt-3 border-t border-neutral-200 dark:border-neutral-700 mobile:flex-col-reverse mobile:gap-3"
      >
        <ui-button
          class="mobile:w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
          @click="$emit('update:modelValue', false)"
        >
          {{ translations.dialog?.cancel || 'Cancel' }}
        </ui-button>
        <ui-button
          variant="primary"
          class="mobile:w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
          :disabled="!name.trim()"
          :loading="saving"
          @click="save"
        >
          {{ isEdit ? (translations.dialog?.done || 'Done') : (translations.card?.create || 'Create') }}
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

      <!-- Color swatches -->
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

      <!-- Emoji picker (lazy) -->
      <ui-emoji-picker
        v-if="modelValue"
        :current="selectedIcon"
        @select="selectedIcon = $event"
      />
    </div>
  </ui-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useFolderStore } from '@/store/folder';
import { useTranslations } from '@/composable/useTranslations';
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
const { translations } = useTranslations();

const name = ref('');
const selectedColor = ref(null);
const selectedIcon = ref('');
const saving = ref(false);

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
