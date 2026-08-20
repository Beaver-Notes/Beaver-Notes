<template>
  <div class="general mb-14 w-full max-w-2xl">
    <settings-group
      :title="translations.labels?.title || 'Labels'"
      :badge="`${sortedLabels.length} ${translations.labels?.total || 'total'}`"
    >
      <p
        v-if="labelStore.data.length === 0"
        class="text-sm text-neutral-500 dark:text-neutral-400 px-4 py-8 text-center"
      >
        {{ translations.labels?.emptyPrefix || 'No labels yet. Type' }}
        <code
          class="bg-neutral-100 dark:bg-neutral-800 px-1 rounded text-primary"
          >#label</code
        >
        {{ translations.labels?.emptySuffix || 'to start.' }}
      </p>

      <div v-else class="p-3 flex flex-wrap gap-2">
        <div
          v-for="name in sortedLabels"
          :key="name"
          class="group relative flex items-center gap-2 pl-2 pr-2 py-1.5 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-all duration-200 rounded-lg cursor-default"
        >
          <div class="relative flex-shrink-0 flex items-center">
            <div
              class="w-2 h-2 rounded-full transition-transform duration-200 label-dot"
              :style="{
                backgroundColor: labelStore.getColor(name) || primaryColor,
              }"
            />
            <input
              type="color"
              class="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              :value="labelStore.getColor(name) || primaryColor"
              :aria-label="`Color for #${name}`"
              @input="onColorInput(name, $event.target.value)"
            />
          </div>

          <span
            class="text-sm font-medium text-neutral-700 dark:text-neutral-200 whitespace-nowrap"
          >
            {{ name }}
          </span>

          <div
            class="relative w-6 h-5 overflow-hidden flex items-center justify-center"
          >
            <span
              class="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-neutral-400 tabular-nums transition-all duration-300 ease-out transform label-count"
            >
              {{ noteCountFor(name) }}
            </span>

            <div
              class="absolute inset-0 flex items-center justify-center opacity-0 translate-y-full transition-all duration-300 ease-out label-delete"
            >
              <button
                class="p-1 hover:bg-red-50 dark:hover:bg-red-950/30 rounded text-neutral-400 hover:text-red-500 transition-colors"
                :aria-label="`Delete label ${name}`"
                @click.stop="deleteLabel(name)"
              >
                <v-remixicon name="riDeleteBin6Line" size="14" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </settings-group>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import { useLabelStore } from '@/store/label';
import { useNoteStore } from '@/store/note';
import { useDialog } from '@/lib/dialog';
import { useTranslations } from '@/composable/useTranslations';
import SettingsGroup from '@/components/settings/SettingsGroup.vue';

const labelStore = useLabelStore();
const noteStore = useNoteStore();
const dialog = useDialog();
const { translations } = useTranslations();

const primaryColor = ref('#6366f1');

onMounted(() => {
  const el = document.createElement('span');
  el.className = 'text-primary';
  el.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  document.body.appendChild(el);
  const rgb = getComputedStyle(el).color;
  document.body.removeChild(el);
  const match = rgb.match(/\d+/g);
  if (match) {
    const [r, g, b] = match.map(Number);
    primaryColor.value =
      '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
});

const sortedLabels = computed(() =>
  [...new Set(labelStore.data)].sort((a, b) => a.localeCompare(b))
);

function noteCountFor(name) {
  return noteStore.notes.filter((n) => n.labels?.includes(name)).length;
}

function onColorInput(name, value) {
  labelStore.setColor(name, value);
}

function deleteLabel(name) {
  const title = (
    translations.value.labels?.deleteConfirm || 'Delete label "#{name}"?'
  ).replace('{name}', name);

  dialog.confirm({
    title,
    body: translations.value.card?.deleteAction || 'This action cannot be undone',
    icon: 'riDeleteBin6Line',
    okVariant: 'danger',
    okText: translations.value.card?.delete || 'Delete',
    cancelText: translations.value.dialog?.cancel || 'Cancel',
    onConfirm: () => labelStore.delete(name),
  });
}
</script>

<style scoped>
section .ui-list {
  @apply bg-neutral-800 bg-opacity-5 dark:bg-neutral-200 dark:bg-opacity-5;
}
@media (hover: hover) and (pointer: fine) {
  .group:hover .label-dot {
    transform: scale(1.25);
  }
  .group:hover .label-count {
    transform: translateY(-100%);
    opacity: 0;
  }
  .group:hover .label-delete {
    transform: translateY(0);
    opacity: 1;
  }
}
</style>
