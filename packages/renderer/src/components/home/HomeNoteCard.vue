<template>
  <ui-card
    class="hover:ring-2 ring-amber-300 group note-card transition flex flex-col"
    padding="p-5"
  >
    <router-link
      :to="`/note/${note.id}`"
      class="font-semibold text-lg block line-clamp leading-tight"
    >
      {{ note.title }}
    </router-link>
    <div
      v-if="note.labels.length !== 0"
      class="text-primary dark:text-amber-400 mt-2 mb-1 line-clamp w-full"
    >
      <span
        v-for="label in note.labels"
        :key="label"
        :to="`/?label=${label}`"
        class="inline-block mr-2 hover:underline cursor-pointer"
        @click="$emit('update:label', label)"
      >
        #{{ label }}
      </span>
    </div>
    <router-link
      :to="`/note/${note.id}`"
      class="text-gray-600 block dark:text-gray-100 flex-1"
      style="min-height: 64px"
    >
      {{ truncateText(note.content, 160) || 'No content' }}
    </router-link>
    <div class="flex z-10 items-center mt-4 text-gray-600 dark:text-gray-200">
      <button
        v-if="!note.isArchived"
        v-tooltip.group="note.isBookmarked ? 'Remove bookmark' : 'Bookmark'"
        class="hover:text-gray-900 mr-2 dark:hover:text-white transition"
        @click="$emit('update', { isBookmarked: !note.isBookmarked })"
      >
        <v-remixicon
          :name="note.isBookmarked ? 'riBookmarkFill' : 'riBookmarkLine'"
        />
      </button>
      <button
        v-tooltip.group="note.isArchived ? 'Unarchive' : 'Archive'"
        class="
          hover:text-gray-900
          mr-2
          dark:hover:text-white
          transition
          invisible
          group-hover:visible
        "
        @click="$emit('update', { isArchived: !note.isArchived })"
      >
        <v-remixicon
          :name="note.isArchived ? 'riInboxUnarchiveLine' : 'riArchiveLine'"
        />
      </button>
      <button
        v-tooltip.group="'Delete'"
        class="
          hover:text-red-500
          dark:hover:text-red-400
          transition
          invisible
          group-hover:visible
        "
        @click="$emit('delete', note.id)"
      >
        <v-remixicon name="riDeleteBin6Line" />
      </button>
      <div class="flex-grow"></div>
      <p class="text-overflow">{{ formatDate(note.createdAt) }}</p>
    </div>
  </ui-card>
</template>
<script setup>
/* eslint-disable no-undef */
import dayjs from '@/lib/dayjs';
import { truncateText } from '@/utils/helper';
import { useGroupTooltip } from '@/composable/groupTooltip';

defineProps({
  note: {
    type: Object,
    default: () => ({}),
  },
});
defineEmits(['update', 'delete', 'update:label']);

useGroupTooltip();

function formatDate(date) {
  return dayjs(date).fromNow();
}
</script>
<style>
.note-card.active-note .group-hover\:visible {
  visibility: visible;
}
</style>