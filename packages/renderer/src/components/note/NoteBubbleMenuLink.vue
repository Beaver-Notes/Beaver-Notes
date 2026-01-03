<template>
  <div class="p-2">
    <!-- View Mode -->
    <div v-if="!isEditing" class="flex items-center space-x-2">
      <button
        class="flex-1 min-w-0 text-left text-primary hover:underline truncate"
        @click="handleClick"
      >
        {{ displayLink }}
      </button>
      <button
        icon
        class="flex-shrink-0 text-neutral-600 dark:text-neutral-200"
        title="Edit link"
        @click="startEditing"
      >
        <v-remixicon name="riPencilLine" />
      </button>
      <button
        icon
        class="flex-shrink-0 text-neutral-600 dark:text-neutral-200"
        title="Remove link"
        @click="editor.chain().focus().unsetLink().run()"
      >
        <v-remixicon name="riLinkUnlinkM" />
      </button>
    </div>

    <!-- Edit Mode -->
    <div v-else class="space-y-2">
      <div class="flex items-center space-x-2">
        <input
          ref="inputRef"
          v-model="currentLinkVal"
          type="url"
          :placeholder="translations.editor.linkPlaceholder"
          class="flex-1 min-w-0 bg-transparent"
          @keydown="keydownHandler"
          @keydown.esc="cancelEditing"
          @keyup.enter="saveAndClose"
        />
        <button
          icon
          class="flex-shrink-0 text-neutral-600 dark:text-neutral-200"
          title="Cancel"
          @click="cancelEditing"
        >
          <v-remixicon name="riCloseLine" />
        </button>
        <button
          icon
          class="flex-shrink-0 text-primary"
          title="Done"
          @click="saveAndClose"
        >
          <v-remixicon name="riCheckLine" />
        </button>
      </div>
    </div>

    <!-- Note Suggestions -->
    <expand-transition>
      <ui-list
        v-if="isEditing && currentLinkVal.startsWith('@')"
        class="p-2 space-y-1 border-t mt-2"
      >
        <ui-list-item
          v-for="(note, index) in notes"
          :key="note.id"
          :active="index === selectedNoteIndex"
          class="cursor-pointer line-clamp leading-tight"
          @click="selectNote(note.id)"
        >
          <p class="text-overflow w-full">
            {{ note.title || translations.editor.untitledNote }}
          </p>
        </ui-list-item>
      </ui-list>
    </expand-transition>
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

      const query = currentLinkVal.value.substr(1).toLocaleLowerCase();

      return noteStore.notes
        .filter(
          (note) =>
            note.id !== route.params.id &&
            (note.title.toLocaleLowerCase().includes(query) ||
              note.id.toLocaleLowerCase().includes(query))
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
        props.editor.commands.focus();
      }
      isEditing.value = false;
    }

    function saveAndClose() {
      updateLink();
      isEditing.value = false;
      props.editor.commands.focus();
    }

    function updateLink(id) {
      let value = currentLinkVal.value;

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
        window.open(href, '_blank', 'noopener');
      }
    }

    function keydownHandler(event) {
      if (!currentLinkVal.value.startsWith('@')) return;

      const notesLength = notes.value.length;

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedNoteIndex.value =
          (selectedNoteIndex.value + notesLength - 1) % notesLength;
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedNoteIndex.value = (selectedNoteIndex.value + 1) % notesLength;
      }
    }

    watch(currentLinkVal, (value) => {
      if (value.startsWith('@')) selectedNoteIndex.value = 0;
    });

    let previousHref = null;

    watch(
      () => props.editor.getAttributes('link'),
      (value) => {
        const href = value?.href ?? '';
        currentLinkVal.value = href.replace('note://', '@');
        originalLinkVal.value = currentLinkVal.value;

        // Only auto-open if link changed from non-empty to empty
        if (href === '' && previousHref !== null && previousHref !== '') {
          isEditing.value = true;
          nextTick(() => {
            inputRef.value?.focus();
          });
        }

        previousHref = href;
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