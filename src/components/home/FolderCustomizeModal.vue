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
      <ui-button
        class="w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
        @click="$emit('update:modelValue', false)"
      >
        {{ translations.dialog?.cancel || 'Cancel' }}
      </ui-button>
      <ui-button
        variant="primary"
        class="w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
        :disabled="!name.trim()"
        :loading="saving"
        @click="save"
      >
        {{ isEdit ? (translations.dialog?.done || 'Done') : (translations.card?.create || 'Create') }}
      </ui-button>
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
        <div class="flex flex-wrap gap-2.5">
          <button
            v-for="color in FOLDER_ICON_COLORS"
            :key="color"
            type="button"
            class="w-8 h-8 rounded-full shrink-0 ring-offset-2 ring-offset-white dark:ring-offset-neutral-900 transition focus:outline-none"
            :class="isColorSelected(color) ? 'ring-2 ring-primary' : 'ring-1 ring-black/10 dark:ring-white/10 hover:ring-black/20'"
            :style="{ backgroundColor: color }"
            :aria-label="color"
            :aria-pressed="isColorSelected(color)"
            @click="selectedColor = color"
          />
          <label
            class="relative w-8 h-8 rounded-full shrink-0 flex items-center justify-center ring-offset-2 ring-offset-white dark:ring-offset-neutral-900 overflow-hidden cursor-pointer"
            :class="isCustomSelected ? 'ring-2 ring-primary' : 'ring-1 ring-black/10 dark:ring-white/10 hover:ring-black/20'"
            style="background: conic-gradient(from 0deg, #ef4444, #fbbf24, #84cc16, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)"
            aria-label="Custom color"
          >
            <v-remixicon v-if="!isCustomSelected" name="riPaletteLine" size="14" class="text-white drop-shadow pointer-events-none relative z-10" />
            <input
              type="color"
              class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              :value="selectedColor || DEFAULT_FOLDER_COLOR"
              @input="onCustomPick($event)"
              tabindex="-1"
            />
          </label>
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

const isCustomSelected = computed(() => {
  if (!selectedColor.value) return false;
  return !FOLDER_ICON_COLORS.includes(selectedColor.value);
});

function onCustomPick(e) {
  const v = e.target.value;
  if (v) selectedColor.value = v;
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
