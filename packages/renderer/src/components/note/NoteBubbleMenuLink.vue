<template>
  <div class="p-2">
    <!-- View Mode -->
    <div v-if="!isEditing" class="flex items-center gap-2">
      <button
        class="flex-1 min-w-10 text-left text-secondary hover:text-primary hover:underline truncate px-2 py-1 rounded transition-colors"
        @click="handleClick"
      >
        {{ displayLink }}
      </button>
      <button
        class="w-10 h-10 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 dark:text-neutral-300 transition-colors"
        title="Edit link"
        @click="startEditing"
      >
        <v-remixicon name="riPencilLine" class="size-5" />
      </button>
      <button
        class="w-10 h-10 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 dark:text-neutral-300 transition-colors"
        title="Remove link"
        @click="editor.chain().focus().unsetLink().run()"
      >
        <v-remixicon name="riLinkUnlinkM" class="size-5" />
      </button>
    </div>

    <!-- Edit Mode -->
    <div v-else class="space-y-2">
      <div class="flex items-center gap-2">
        <input
          ref="inputRef"
          v-model="currentLinkVal"
          type="url"
          :placeholder="
            translations.editor.linkPlaceholder || 'Enter URL or @note'
          "
          class="flex-1 min-w-0 px-2 py-1 rounded-md bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 transition-shadow"
          @keydown="keydownHandler"
          @keydown.esc="cancelEditing"
          @keyup.enter="saveAndClose"
        />
        <button
          class="w-10 h-10 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 dark:text-neutral-300 transition-colors"
          title="Cancel"
          @click="cancelEditing"
        >
          <v-remixicon name="riCloseLine" class="size-5" />
        </button>
        <button
          class="w-10 h-10 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 dark:text-neutral-300 transition-colors"
          title="Save"
          :disabled="!currentLinkVal.trim()"
          @click="saveAndClose"
        >
          <v-remixicon name="riCheckLine" class="size-5" />
        </button>
      </div>

      <expand-transition>
        <div
          v-if="currentLinkVal.startsWith('@') && notes.length > 0"
          class="overflow-hidden"
        >
          <ui-list class="cursor-pointer space-y-1">
            <ui-list-item
              v-for="(note, index) in notes"
              :key="note.id"
              :active="index === selectedNoteIndex"
              class="label-item w-full truncate"
              @click="selectNote(note.id)"
            >
              {{
                note.title ||
                translations.editor.untitledNote ||
                'Untitled Note'
              }}
            </ui-list-item>
          </ui-list>
        </div>
        <div
          v-else-if="currentLinkVal.startsWith('@') && notes.length === 0"
          class="px-3 py-2 text-sm text-neutral-500 dark:text-neutral-400 italic"
        >
          No matching notes found
        </div>
      </expand-transition>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { useTranslation } from '@/composable/translations';
import { useNoteStore } from '@/store/note';
import { useRoute, useRouter } from 'vue-router';

export default {
  props: {
    editor: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props) {
    const route = useRoute();
    const router = useRouter();
    const noteStore = useNoteStore();

    const isEditing = ref(false);
    const selectedNoteIndex = ref(0);
    const currentLinkVal = ref('');
    const originalLinkVal = ref('');
    const inputRef = ref(null);

    const notes = computed(() => {
      if (!currentLinkVal.value.startsWith('@')) return [];

      const query = currentLinkVal.value.substring(1).toLowerCase();

      return noteStore.notes
        .filter(
          (note) =>
            note.id !== route.params.id &&
            (note.title.toLowerCase().includes(query) ||
              note.id.toLowerCase().includes(query))
        )
        .slice(0, 6);
    });

    const displayLink = computed(() => {
      const href = props.editor.getAttributes('link')?.href;
      if (!href) return '';

      if (href.startsWith('note://')) {
        const noteId = href.slice(7);
        const note = noteStore.notes.find((n) => n.id === noteId);
        return note?.title || noteId;
      }

      return href;
    });

    function startEditing() {
      isEditing.value = true;
      originalLinkVal.value = currentLinkVal.value;
      nextTick(() => {
        inputRef.value?.focus();
        inputRef.value?.select();
      });
    }

    function cancelEditing() {
      if (originalLinkVal.value === '') {
        props.editor.chain().focus().unsetLink().run();
      } else {
        currentLinkVal.value = originalLinkVal.value;
      }
      isEditing.value = false;
      props.editor.commands.focus();
    }

    function saveAndClose() {
      if (!currentLinkVal.value.trim()) {
        cancelEditing();
        return;
      }

      updateLink();
      isEditing.value = false;
      props.editor.commands.focus();
    }

    function updateLink(id) {
      let value = currentLinkVal.value.trim();

      if (currentLinkVal.value.startsWith('@') || typeof id === 'string') {
        const noteId =
          typeof id === 'string'
            ? id
            : notes.value[selectedNoteIndex.value]?.id;

        if (!noteId) return;
        value = `note://${noteId}`;
      }

      props.editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: value })
        .run();
    }

    function selectNote(id) {
      updateLink(id);
      isEditing.value = false;
      props.editor.commands.focus();
    }

    function handleClick() {
      const href = props.editor.getAttributes('link')?.href;

      if (!href) return;

      if (href.startsWith('note://')) {
        const noteId = href.slice(7);
        router.push({
          params: { id: noteId },
          query: { linked: true },
        });
      } else {
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    }

    function keydownHandler(event) {
      if (!currentLinkVal.value.startsWith('@') || notes.value.length === 0)
        return;

      const notesLength = notes.value.length;

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedNoteIndex.value =
          (selectedNoteIndex.value + notesLength - 1) % notesLength;
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedNoteIndex.value = (selectedNoteIndex.value + 1) % notesLength;
      } else if (
        event.key === 'Enter' &&
        currentLinkVal.value.startsWith('@')
      ) {
        event.preventDefault();
        if (notes.value[selectedNoteIndex.value]) {
          selectNote(notes.value[selectedNoteIndex.value].id);
        }
      }
    }

    watch(currentLinkVal, (value) => {
      if (value.startsWith('@')) selectedNoteIndex.value = 0;
    });

    watch(
      () => props.editor.getAttributes('link')?.href,
      (newHref) => {
        const href = newHref ?? '';
        currentLinkVal.value = href.replace('note://', '@');
        originalLinkVal.value = currentLinkVal.value;

        // Auto-open edit mode when href is empty
        if (href === '') {
          isEditing.value = true;
          nextTick(() => {
            inputRef.value?.focus();
          });
        }
      },
      { immediate: true }
    );

    const translations = ref({
      editor: {},
    });

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    return {
      notes,
      translations,
      isEditing,
      inputRef,
      displayLink,
      keydownHandler,
      currentLinkVal,
      selectedNoteIndex,
      startEditing,
      cancelEditing,
      saveAndClose,
      selectNote,
      handleClick,
    };
  },
};
</script>
