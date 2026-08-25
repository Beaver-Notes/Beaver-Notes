<template>
  <div class="general mb-14 w-full max-w-2xl">
    <settings-group
      :title="translations.labels?.title || 'Labels'"
      :badge="`${sortedLabels.length} ${translations.labels?.total || 'total'}`"
    >
      <template #description>
        <p
          v-if="labelStore.data.length > 0"
          class="px-1 -mt-1 mb-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
        >
          {{ translations.labels?.hint || 'Tap a name to rename it, tap a color to recolor it.' }}
        </p>
      </template>

      <div v-if="labelStore.data.length === 0" class="px-4 py-8 text-center">
        <p class="text-sm text-neutral-500 dark:text-neutral-400">
          {{ translations.labels?.emptyPrefix || 'No labels yet. Type' }}
          <code
            class="bg-neutral-100 dark:bg-neutral-800 px-1 rounded text-primary"
            >#label</code
          >
          {{ translations.labels?.emptySuffix || 'to start.' }}
        </p>
      </div>

      <template v-else>
        <div
          class="flex flex-col sm:flex-row gap-2 px-3 py-2.5 border-b border-neutral-200 dark:border-neutral-800"
        >
          <div class="relative flex-1">
            <v-remixicon
              name="riSearchLine"
              size="15"
              class="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
            />
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="translations.labels?.search || 'Search labels'"
              class="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border bg-white dark:bg-neutral-950 dark:border-neutral-700 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-neutral-400"
            />
          </div>
          <ui-select v-model="sortMode" class="sm:w-40">
            <option value="alpha">
              {{ translations.labels?.sortAlpha || 'A to Z' }}
            </option>
            <option value="count">
              {{ translations.labels?.sortCount || 'Most used' }}
            </option>
          </ui-select>
        </div>

        <p
          v-if="filteredSortedLabels.length === 0"
          class="text-sm text-neutral-400 px-4 py-8 text-center"
        >
          {{ translations.labels?.noResults || 'No labels match your search.' }}
        </p>

        <div
          v-for="name in filteredSortedLabels"
          :key="name"
          class="flex items-center gap-2.5 px-3 py-2 border-b last:border-b-0 border-neutral-200 dark:border-neutral-800"
        >
          <div class="relative shrink-0">
            <button
              class="w-5 h-5 rounded-full focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary dark:focus:ring-offset-neutral-900"
              :style="{ backgroundColor: labelStore.getColor(name) || primaryColor }"
              :aria-label="`Change color for ${name}`"
              :aria-expanded="openPopoverFor === name"
              @click.stop="togglePopover(name)"
            />
            <div
              v-if="openPopoverFor === name"
              class="absolute z-10 top-7 left-0 flex items-center gap-1.5 p-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg"
              @click.stop
            >
              <button
                v-for="c in labelPalette"
                :key="c.key"
                class="w-5 h-5 rounded-full shrink-0 ring-offset-2 ring-offset-white dark:ring-offset-neutral-800"
                :class="[
                  c.class,
                  (labelStore.getColor(name) || primaryColor).toLowerCase() ===
                  c.hex.toLowerCase()
                    ? 'ring-2 ring-current'
                    : '',
                ]"
                :style="{ backgroundColor: c.hex }"
                :aria-label="c.label"
                @click="setLabelColor(name, c.hex)"
              />
              <label
                class="relative w-5 h-5 rounded-full shrink-0 flex items-center justify-center ring-offset-2 ring-offset-white dark:ring-offset-neutral-800 overflow-hidden cursor-pointer"
                :class="isCustomLabelColor(name) ? 'ring-2 ring-primary' : 'ring-1 ring-black/10 dark:ring-white/10'"
                style="background: conic-gradient(from 0deg, #ef4444, #fbbf24, #84cc16, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)"
                aria-label="Custom color"
              >
                <v-remixicon v-if="!isCustomLabelColor(name)" name="riPaletteLine" size="10" class="text-white drop-shadow pointer-events-none relative z-10" />
                <input
                  type="color"
                  class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  :value="labelStore.getColor(name) || primaryColor"
                  @input="onLabelCustomPickFor(name, $event)"
                  tabindex="-1"
                />
              </label>
            </div>
          </div>

          <input
            type="text"
            :value="name"
            class="flex-1 min-w-0 text-sm font-medium text-neutral-700 dark:text-neutral-200 bg-transparent border-none rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary focus:bg-white dark:focus:bg-neutral-950"
            :aria-label="`Rename label ${name}`"
            @keydown.enter="$event.target.blur()"
            @blur="commitRename(name, $event.target.value)"
          />

          <span
            class="shrink-0 text-[11px] font-medium text-neutral-400 bg-neutral-100 dark:bg-neutral-900 tabular-nums px-2 py-0.5 rounded-full"
          >
            {{ noteCountFor(name) }}
          </span>

          <button
            class="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            :aria-label="`Delete label ${name}`"
            @click="deleteLabel(name)"
          >
            <v-remixicon name="riDeleteBin6Line" size="15" />
          </button>
        </div>

      </template>
    </settings-group>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
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
const searchQuery = ref('');
const sortMode = ref('alpha');
const openPopoverFor = ref(null);

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

// Same key/label set as the accent-color picker in Appearance.vue, so
// recoloring a label and picking an accent feel like the same control in two places.
const labelPalette = [
  { key: 'red', label: 'Red', hex: '#ef4444', class: 'text-red-500' },
  { key: 'amber', label: 'Amber', hex: '#fbbf24', class: 'text-amber-500' },
  { key: 'green', label: 'Green', hex: '#10b981', class: 'text-emerald-500' },
  { key: 'blue', label: 'Blue', hex: '#3b82f6', class: 'text-blue-500' },
  { key: 'purple', label: 'Purple', hex: '#8b5cf6', class: 'text-purple-500' },
  { key: 'pink', label: 'Pink', hex: '#ec4899', class: 'text-pink-500' },
  { key: 'neutral', label: 'Neutral', hex: '#a3a3a3', class: 'text-neutral-500' },
];

const sortedLabels = computed(() =>
  [...new Set(labelStore.data)].sort((a, b) => a.localeCompare(b))
);

const filteredSortedLabels = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  let list = query
    ? sortedLabels.value.filter((name) => name.toLowerCase().includes(query))
    : sortedLabels.value;

  if (sortMode.value === 'count') {
    list = [...list].sort((a, b) => noteCountFor(b) - noteCountFor(a));
  }

  return list;
});

function noteCountFor(name) {
  return noteStore.notes.filter((n) => n.labels?.includes(name)).length;
}

function togglePopover(name) {
  openPopoverFor.value = openPopoverFor.value === name ? null : name;
}

function closePopover() {
  openPopoverFor.value = null;
}

function handleDocumentClick() {
  if (openPopoverFor.value !== null) closePopover();
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
});

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick);
});

function setLabelColor(name, hex) {
  labelStore.setColor(name, hex);
  openPopoverFor.value = null;
}

function isCustomLabelColor(name) {
  const explicit = labelStore.getColor(name);
  if (!explicit) return false;
  return !labelPalette.some((c) => c.hex.toLowerCase() === explicit.toLowerCase());
}

function onLabelCustomPickFor(name, e) {
  const v = e.target.value;
  if (v) setLabelColor(name, v);
}

function commitRename(oldName, rawValue) {
  const newName = rawValue.trim();

  if (!newName || newName === oldName) return;

  if (sortedLabels.value.includes(newName)) {
    dialog.confirm({
      title: (
        translations.value.labels?.duplicateTitle || 'A label named "#{name}" already exists'
      ).replace('{name}', newName),
      body:
        translations.value.labels?.duplicateBody ||
        'Rename cancelled to avoid merging two labels by accident.',
      okText: translations.value.dialog?.ok || 'OK',
      cancelText: '',
    });
    return;
  }

  // NOTE: this calls labelStore.rename(oldName, newName), which isn't in
  // the store file included in this export. It should update every note's
  // labels array plus the label's stored color under the new key. If the
  // store doesn't have this method yet, it needs to be added there.
  labelStore.rename(oldName, newName);
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
