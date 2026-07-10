<template>
  <ui-card v-if="backlinks.length">
    <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
      {{
        translations.editor?.backlinks ||
        translations.editor?.linkedReferences ||
        'Backlinks'
      }}
      <span class="text-neutral-400 dark:text-neutral-500 font-normal">
        ({{ backlinks.length }})
      </span>
    </p>
    <ul class="space-y-2">
      <li v-for="source in backlinks" :key="source.id" class="text-sm">
        <router-link
          :to="{
            name: 'Note',
            params: { id: source.id },
            query: { linked: true, from: route.params.id },
          }"
          class="text-primary hover:underline truncate inline-flex items-center gap-1"
        >
          <v-remixicon name="riLink" class="size-3.5 flex-shrink-0" />
          <span class="truncate">
            {{
              source.title ||
              translations.editor?.untitledNote ||
              'Untitled note'
            }}
          </span>
        </router-link>
      </li>
    </ul>
  </ui-card>
</template>

<script>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useNoteStore } from '@/store/note';
import { useTranslations } from '@/composable/useTranslations';

export default {
  setup() {
    const route = useRoute();
    const noteStore = useNoteStore();
    const { translations } = useTranslations();

    const backlinks = computed(() => {
      const id = route.params.id;
      if (!id) return [];
      return noteStore.getBacklinks(id).filter((n) => !n?.isArchived);
    });

    return { backlinks, route, translations };
  },
};
</script>
