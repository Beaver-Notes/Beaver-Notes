<template>
  <div
    class="bg-white dark:bg-neutral-900 border z-20 w-fit mx-auto p-1.5 rounded-xl shadow-md no-print"
    @click.stop
  >
    <!-- View Mode -->
    <div v-if="!isEditing" class="flex items-center gap-2">
      <button
        class="flex-1 min-w-10 text-left text-secondary hover:text-primary hover:underline truncate px-2 py-1 rounded transition-colors"
        @click="handleClick"
      >
        {{ displayLink }}
      </button>
      <button
        class="h-8 w-8 rounded-lg hoverable transition-colors flex items-center justify-center"
        :title="translations.editor?.editLink || 'Edit link'"
        @click="startEditing"
      >
        <v-remixicon name="riPencilLine" class="size-5" />
      </button>
      <button
        class="h-8 w-8 rounded-lg hoverable transition-colors flex items-center justify-center"
        :title="translations.editor?.removeLink || 'Remove link'"
        @click="removeLink"
      >
        <v-remixicon name="riLinkUnlinkM" class="size-5" />
      </button>
    </div>

    <!-- Edit Mode -->
    <div v-else class="space-y-2">
      <div class="flex items-center gap-2">
        <input
          id="bubble-input"
          ref="inputRef"
          v-model="currentLinkVal"
          type="text"
          :placeholder="
            translations.editor?.linkPlaceholder || 'Enter URL or @note'
          "
          class="flex-1 min-w-0 px-1 py-1 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 transition-shadow"
          @keydown="keydownHandler"
          @keydown.esc="cancelEditing"
          @keyup.enter="saveAndClose"
        />
        <button
          class="h-8 w-8 rounded-lg hoverable transition-colors flex items-center justify-center"
          :title="translations.common?.cancel || 'Cancel'"
          @click="cancelEditing"
        >
          <v-remixicon name="riCloseLine" class="size-5" />
        </button>
        <button
          class="h-8 w-8 rounded-lg hoverable transition-colors flex items-center justify-center"
          :title="translations.common?.save || 'Save'"
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
          <ui-list class="space-y-1">
            <ui-list-item
              v-for="(note, index) in notes"
              :key="note.id"
              :active="index === selectedNoteIndex"
              class="label-item w-full truncate"
              @click="selectNote(note.id)"
            >
              {{
                note.title ||
                translations.editor?.untitledNote ||
                'Untitled Note'
              }}
            </ui-list-item>
          </ui-list>
        </div>
        <div
          v-else-if="currentLinkVal.startsWith('@') && notes.length === 0"
          class="p-1.5 text-sm text-neutral-500 dark:text-neutral-400 italic"
        >
          {{
            translations.editor?.noMatchingNotes || 'No matching notes found'
          }}
        </div>
      </expand-transition>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, nextTick } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { useNoteStore } from '@/store/note';
import { useRoute, useRouter } from 'vue-router';
import { TextSelection } from 'prosemirror-state';

export default {
  props: {
    editor: {
      type: Object,
      default: null,
    },
    hoverLinkAttrs: {
      type: Object,
      default: null,
    },
    hoverLinkEl: {
      type: Object,
      default: null,
    },
  },
  emits: ['close', 'action'],
  setup(props, { emit }) {
    const route = useRoute();
    const router = useRouter();
    const noteStore = useNoteStore();
    const { translations } = useTranslations();
    const isEditing = ref(false);
    const selectedNoteIndex = ref(0);
    const currentLinkVal = ref('');
    const originalLinkVal = ref('');
    const inputRef = ref(null);

    // ── Helper: check if a link href is a note:// URL ──────────────
    function isNoteUrl(href) {
      return typeof href === 'string' && href.startsWith('note://');
    }

    // ── Position the editor's cursor on the hovered link ──────────
    function positionCursorOnLink() {
      if (!props.editor || !props.hoverLinkEl) return false;
      try {
        const { view } = props.editor;
        const el = props.hoverLinkEl;
        // Use TreeWalker to find the first text node inside any descendant
        // This handles both new-style <a> (text child) and old-style
        // <a data-link-note><span data-mention>@Title</span></a>
        const walker = document.createTreeWalker(
          el,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );
        const textNode = walker.nextNode();
        if (!textNode) return false;
        const text = textNode.textContent || '';
        if (!text) return false;
        const from = view.posAtDOM(textNode, 0);
        const to = view.posAtDOM(textNode, text.length);
        if (from === null || to === null || from === to) return false;
        const { state } = view;
        const tr = state.tr.setSelection(
          new TextSelection(state.doc.resolve(from), state.doc.resolve(to))
        );
        view.dispatch(tr);
        return true;
      } catch {
        return false;
      }
    }

    // ── Active link type detection ───────────────────────────────────
    const activeType = computed(() => {
      if (!props.editor) return null;
      if (props.hoverLinkAttrs) return props.hoverLinkAttrs.type;
      if (props.editor.isActive('linkNote')) return 'linkNote';
      if (props.editor.isActive('link')) {
        const attrs = props.editor.getAttributes('link');
        if (attrs.href && isNoteUrl(attrs.href)) return 'linkNote';
        return 'link';
      }
      return null;
    });

    // ── Active link attributes (normalized) ──────────────────────────
    const activeAttrs = computed(() => {
      if (!props.editor) return null;
      if (props.hoverLinkAttrs) return props.hoverLinkAttrs;

      if (activeType.value === 'linkNote') {
        // Try old-style linkNote node first
        const noteNodeAttrs = props.editor.getAttributes('linkNote');
        if (noteNodeAttrs && noteNodeAttrs.id) {
          return {
            type: 'linkNote',
            id: noteNodeAttrs.id,
            label: noteNodeAttrs.label || noteNodeAttrs.id,
            href: noteNodeAttrs.href || `note://${noteNodeAttrs.id}`,
          };
        }
        // Fall back to note:// URL via link mark
        const linkAttrs = props.editor.getAttributes('link');
        if (linkAttrs && linkAttrs.href && isNoteUrl(linkAttrs.href)) {
          const noteId = linkAttrs.href.slice('note://'.length);
          return {
            type: 'linkNote',
            id: noteId,
            label: noteId,
            href: linkAttrs.href,
          };
        }
        return null;
      }

      return props.editor.getAttributes('link') || null;
    });

    // ── Notes matching @ query ──────────────────────────────────────
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

    // ── Display text for the link ────────────────────────────────────
    const displayLink = computed(() => {
      const type = activeType.value;
      const attrs = activeAttrs.value;
      if (!type || !attrs) return '';

      if (type === 'linkNote') {
        const id = attrs.id;
        const note = noteStore.notes.find((n) => n.id === id);
        return note?.title || attrs.label || id || '';
      }

      return attrs.href || '';
    });

    // ── Actions ──────────────────────────────────────────────────────
    function startEditing() {
      isEditing.value = true;
      originalLinkVal.value = currentLinkVal.value;
      nextTick(() => {
        inputRef.value?.focus();
        inputRef.value?.select();
      });
    }

    function cancelEditing() {
      if (
        originalLinkVal.value === '' &&
        (!activeAttrs.value || activeAttrs.value.href === '')
      ) {
        removeLink();
      } else {
        currentLinkVal.value = originalLinkVal.value;
      }
      isEditing.value = false;
      emit('close');
    }

    // ── Helper: update an existing link with a new href ────────────
    // Handles both old-style linkNote nodes (converts to mark) and
    // new-style link marks (updates href in place).
    function updateLinkHref(href) {
      if (!props.editor) return;
      const { editor } = props;

      // Position cursor on the link first
      positionCursorOnLink();

      if (editor.isActive('linkNote')) {
        // Old-style linkNote node: remove it (replaces with its label text),
        // then apply a link mark with the new href on that same text.
        const attrs = editor.getAttributes('linkNote');
        const text = attrs.label || attrs.id || '';
        editor
          .chain()
          .focus()
          .removeLinkNote()
          .insertContent([
            {
              type: 'text',
              text,
              marks: [{ type: 'link', attrs: { href } }],
            },
          ])
          .run();
      } else {
        // New-style link mark: extend the mark range to cover the full
        // link, then update the href.
        editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
      }
    }

    function saveAndClose() {
      const value = currentLinkVal.value.trim();
      if (!value) {
        removeLink();
        isEditing.value = false;
        return;
      }

      if (value.startsWith('@')) {
        const note = resolveNoteFromInput(value);
        if (note) {
          updateLinkHref(`note://${note.id}`);
        }
      } else {
        // Position cursor first, then update the external URL
        positionCursorOnLink();
        props.editor
          .chain()
          .focus()
          .extendMarkRange('link')
          .setLink({ href: value })
          .run();
      }

      isEditing.value = false;
      emit('close');
    }

    function resolveNoteFromInput(value) {
      const query = value.substring(1).trim();
      if (!query) return null;
      return (
        noteStore.notes.find(
          (n) => n.title.toLowerCase() === query.toLowerCase()
        ) || noteStore.notes.find((n) => n.id === query)
      );
    }

    function applyLink(value) {
      if (!props.editor) return;

      if (value.startsWith('@')) {
        const note = resolveNoteFromInput(value);
        if (!note) return;
        updateLinkHref(`note://${note.id}`);
        return;
      }

      // External URL
      positionCursorOnLink();
      props.editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: value })
        .run();
    }

    function selectNote(id) {
      if (!props.editor) return;
      updateLinkHref(`note://${id}`);
      isEditing.value = false;
      emit('close');
    }

    function removeLink() {
      if (!props.editor) return;
      const { editor } = props;

      // Position cursor on the link so isActive / unsetLink work
      positionCursorOnLink();

      if (editor.isActive('linkNote')) {
        editor.chain().focus().removeLinkNote().run();
      } else {
        // For link marks (both note:// and external URLs), extend the
        // mark range to ensure full coverage, then unset.
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
      }

      emit('close');
    }

    function handleClick() {
      const type = activeType.value;
      const attrs = activeAttrs.value;
      if (!type || !attrs) return;

      emit('action');

      if (type === 'linkNote' && attrs.id) {
        router.push({
          name: 'Note',
          params: { id: attrs.id },
          query: { linked: true, from: route.params.id },
        });
        return;
      }

      if (attrs.href) {
        window.open(attrs.href, '_blank', 'noopener,noreferrer');
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

    // ── Watchers ──────────────────────────────────────────────────────
    watch(currentLinkVal, (value) => {
      if (value.startsWith('@')) selectedNoteIndex.value = 0;
    });

    watch(
      activeAttrs,
      (attrs) => {
        const type = activeType.value;
        if (!type || !attrs) {
          currentLinkVal.value = '';
          originalLinkVal.value = '';
          if (!isEditing.value) {
            isEditing.value = true;
            nextTick(() => inputRef.value?.focus());
          }
          return;
        }

        if (type === 'linkNote') {
          const note = noteStore.notes.find((n) => n.id === attrs.id);
          currentLinkVal.value = note ? `@${note.title}` : `@${attrs.id}`;
        } else {
          currentLinkVal.value = attrs.href || '';
        }
        originalLinkVal.value = currentLinkVal.value;

        // If it's a new link with an empty href, enter edit mode right away
        if (type === 'link' && !attrs.href) {
          isEditing.value = true;
          nextTick(() => inputRef.value?.focus());
          return;
        }

        isEditing.value = false;
      },
      { immediate: true }
    );

    return {
      notes,
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
      removeLink,
      handleClick,
      translations,
    };
  },
};
</script>
