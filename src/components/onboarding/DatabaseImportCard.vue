<template>
  <div class="flex flex-col gap-2">
    <ui-card
      v-for="s in sources"
      :key="s.id"
      tag="button"
      padding="p-0"
      class="w-full text-left shrink-0 disabled:opacity-50"
      :disabled="!!busy"
      :data-test="`db-import-${s.id}`"
      @click="start(s.id)"
    >
      <div class="flex items-center gap-4 p-4">
        <div
          class="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
          :style="{ background: s.iconBg }"
        >
          <v-remixicon :name="s.icon" :class="s.iconColor" />
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="font-semibold text-sm text-neutral-800 dark:text-neutral-200 mb-0.5">
            {{ s.label }}
          </h3>
          <p class="text-sm text-neutral-600 dark:text-neutral-400">
            {{ s.description }}
          </p>
        </div>
        <span v-if="busy === s.id" data-test="db-import-spinner" class="shrink-0 animate-spin text-primary">
          <v-remixicon name="riLoader4Line" />
        </span>
        <v-remixicon v-else name="riArrowRightLine" class="shrink-0 opacity-30" />
      </div>
    </ui-card>
    <p
      v-if="error"
      data-test="db-import-error"
      class="text-xs text-red-500 dark:text-red-400 px-1"
    >
      {{ error }}
    </p>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useTranslations } from '@/composable/useTranslations';

const { translations } = useTranslations();
const t = computed(() => translations.value.database || {});

const emit = defineEmits(['import']);

const busy = ref(null);
const error = ref('');

const sources = computed(() => [
  {
    id: 'notion',
    icon: 'riNotionFill',
    iconColor: 'text-neutral-900 dark:text-white',
    iconBg: 'rgba(120, 120, 120, 0.12)',
    label: t.value.onboardingImportNotion || 'Notion CSV',
    description:
      t.value.onboardingImportNotionDesc ||
      'Select a Notion CSV export. Columns are detected automatically.',
  },
  {
    id: 'obsidian',
    icon: 'obsidian',
    iconColor: 'text-[#7C60D7]',
    iconBg: 'rgba(124, 96, 215, 0.12)',
    label: t.value.onboardingImportObsidian || 'Obsidian vault',
    description:
      t.value.onboardingImportObsidianDesc ||
      'Select your vault folder. Each note becomes a row.',
  },
]);

async function start(source) {
  if (busy.value) return;
  busy.value = source;
  error.value = '';
  try {
    // Parsing pulls the native dialog + fs + parser graph; load it on demand.
    const { pickDatabaseSource } = await import('./databaseImport');
    const payload = await pickDatabaseSource(source);
    if (payload) emit('import', payload);
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    busy.value = null;
  }
}
</script>
