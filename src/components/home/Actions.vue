<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <teleport to="body">
    <div
      v-if="selectedItems.size > 0"
      data-selection-keep
      class="pl-16 fixed inset-x-0 z-40 transition-all duration-300 ease-out mx-2 bottom-4"
    >
      <div
        class="relative bg-white dark:bg-neutral-800 border rounded-xl shadow-lg overflow-hidden w-3/4 p-2 mx-auto"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="text-sm font-medium">
              {{ selectedItems.size }} items selected
            </span>
          </div>
          <div class="flex gap-2">
            <ui-button
              v-if="selectedNotes.length > 0"
              v-tooltip.group="
                shouldArchive
                  ? translations.card.archive
                  : translations.card.unarchive
              "
              @click="handleToggleArchive"
            >
              <v-remixicon
                :name="shouldArchive ? 'riArchiveLine' : 'riInboxUnarchiveLine'"
              />
            </ui-button>

            <ui-button
              v-if="selectedNotes.length > 0"
              v-tooltip.group="
                shouldBookmark
                  ? translations.card.bookmark
                  : translations.card.removeBookmark
              "
              @click="handleToggleBookmark"
            >
              <v-remixicon
                :name="shouldBookmark ? 'riBookmarkLine' : 'riBookmarkFill'"
              />
            </ui-button>
            <ui-button
              v-tooltip.group="translations.card.moveToFolder"
              @click="$emit('move')"
            >
              <v-remixicon name="riFolderTransferLine" />
            </ui-button>
            <ui-button
              v-tooltip.group="translations.card.delete"
              class="hover:bg-red-500 hover:text-white"
              @click="$emit('delete')"
            >
              <v-remixicon name="riDeleteBin6Line" />
            </ui-button>
            <ui-button
              v-tooltip.group="translations.index.close"
              @click="$emit('clear')"
            >
              <v-remixicon name="riCloseLine" />
            </ui-button>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { computed } from 'vue';
import { useNoteStore } from '@/store/note';
import { useTranslations } from '@/composable/useTranslations';
import { parseItemId } from '@/utils/helper';

const props = defineProps({
  selectedItems: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['clear', 'delete', 'move']);

const noteStore = useNoteStore();
const { translations } = useTranslations();

const selectedNotes = computed(() => {
  return Array.from(props.selectedItems)
    .map(parseItemId)
    .filter(({ type, id }) => type === 'note' && id)
    .map(({ id }) => noteStore.getById(id))
    .filter(Boolean);
});

// Archive logic
const shouldArchive = computed(() => {
  const notes = selectedNotes.value;
  const archivedCount = notes.filter((n) => n.isArchived).length;
  return archivedCount < notes.length / 2;
});

// Bookmark logic
const shouldBookmark = computed(() => {
  const notes = selectedNotes.value;
  const bookmarkedCount = notes.filter((n) => n.isBookmarked).length;
  return bookmarkedCount < notes.length / 2;
});

async function handleToggleArchive() {
  const archive = shouldArchive.value;
  for (const note of selectedNotes.value) {
    await noteStore.update(note.id, { isArchived: archive });
  }
  emit('clear');
}

async function handleToggleBookmark() {
  const bookmark = shouldBookmark.value;
  for (const note of selectedNotes.value) {
    await noteStore.update(note.id, { isBookmarked: bookmark });
  }
  emit('clear');
}
</script>
