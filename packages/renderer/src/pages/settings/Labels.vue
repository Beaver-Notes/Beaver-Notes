<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="general mb-14 w-full max-w-2xl">
    <section>
      <header class="flex items-center justify-between mb-4 px-1">
        <p class="text-xs font-bold uppercase tracking-widest text-neutral-500">
          {{ translations.labels?.title || 'Labels' }}
        </p>
        <span
          class="text-[10px] font-medium text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full"
        >
          {{ sortedLabels.length }} {{ translations.labels?.total || 'total' }}
        </span>
      </header>

      <p
        v-if="labelStore.data.length === 0"
        class="text-sm text-neutral-500 dark:text-neutral-400 py-6 border-2 border-dashed border-neutral-200 dark:border-neutral-800 rounded-xl text-center"
      >
        {{ translations.labels?.emptyPrefix || 'No labels yet. Type' }}
        <code
          class="bg-neutral-100 dark:bg-neutral-800 px-1 rounded text-primary"
          >#label</code
        >
        {{ translations.labels?.emptySuffix || 'to start.' }}
      </p>

      <div v-else class="flex flex-wrap gap-2">
        <div
          v-for="name in sortedLabels"
          :key="name"
          class="group relative flex items-center gap-2 pl-2 pr-2 py-1.5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-all duration-200 rounded-lg cursor-default"
        >
          <div class="relative flex-shrink-0 flex items-center">
            <div
              class="w-2 h-2 rounded-full transition-transform duration-200 group-hover:scale-125"
              :style="{
                backgroundColor: labelStore.getColor(name) || primaryColor,
              }"
            />
            <input
              type="color"
              class="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              :value="labelStore.getColor(name) || primaryColor"
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
              class="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-neutral-400 tabular-nums transition-all duration-300 ease-out transform group-hover:-translate-y-full group-hover:opacity-0"
            >
              {{ noteCountFor(name) }}
            </span>

            <div
              class="absolute inset-0 flex items-center justify-center opacity-0 translate-y-full group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 ease-out"
            >
              <button
                class="p-1 hover:bg-red-50 dark:hover:bg-red-950/30 rounded text-neutral-400 hover:text-red-500 transition-colors"
                @click.stop="deleteLabel(name)"
              >
                <v-remixicon name="riDeleteBin6Line" size="14" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import { useLabelStore } from '@/store/label';
import { useNoteStore } from '@/store/note';
import { useDialog } from '@/composable/dialog';
import { useTranslations } from '@/composable/useTranslations';

const labelStore = useLabelStore();
const noteStore = useNoteStore();
const dialog = useDialog();
const { translations } = useTranslations();

const primaryColor = ref('#6366f1');

onMounted(() => {
  // Resolve the actual primary color by reading it off a real element
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
  [...labelStore.data].sort((a, b) => a.localeCompare(b))
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
    okText: translations.value.card?.delete || 'Delete',
    cancelText: translations.value.dialog?.cancel || 'Cancel',
    destructive: true,
    onConfirm: () => labelStore.delete(name),
  });
}
</script>

<style scoped>
section .ui-list {
  @apply bg-neutral-800 bg-opacity-5 dark:bg-neutral-200 dark:bg-opacity-5;
}
</style>
