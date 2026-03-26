<template>
  <div class="note-editor">
    <slot v-bind="{ editor }" />
    <editor-content
      v-if="editor"
      :editor="editor"
      class="prose dark:text-neutral-100 max-w-none prose-indigo print:cursor-none overflow-hidden"
    />
    <note-bubble-menu v-if="editor" v-bind="{ editor }" />
  </div>
</template>

<script>
import { onMounted, onBeforeUnmount, watch, computed } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import { isAppEncryptedContent } from '@/utils/appCrypto.js';
import { sanitizeNoteContent } from '@/utils/contentSecurity';
import { useRouter } from 'vue-router';
import { extensions, CollapseHeading, heading, dropFile } from '@/lib/tiptap';
import NoteBubbleMenu from './NoteBubbleMenu.vue';
import { useAppStore } from '../../store/app';

export default {
  components: { EditorContent, NoteBubbleMenu },
  props: {
    modelValue: { type: [String, Object], default: '' },
    id: { type: String, default: '' },
    cursorPosition: { type: Number, default: 0 },
  },
  emits: ['init', 'update', 'update:modelValue'],
  setup(props, { emit }) {
    const router = useRouter();
    const appStore = useAppStore();

    const exts = [...extensions, dropFile.configure({ id: props.id })];
    exts.push(appStore.setting.collapsibleHeading ? CollapseHeading : heading);

    const safeContent = computed(() =>
      isAppEncryptedContent(props.modelValue)
        ? ''
        : sanitizeNoteContent(props.modelValue)
    );

    const editor = useEditor({
      content: safeContent.value,
      autofocus: props.cursorPosition,
      extensions: exts,
      editorProps: {
        handleClick,
        attributes: {
          'data-testid': 'note-body-editor',
        },
      },
    });

    function handleClick(view, pos, { target, altKey }) {
      const closestAnchor = target.closest('a');
      if (closestAnchor?.hasAttribute('tiptap-url') && altKey) {
        if (closestAnchor.href.startsWith('note://')) {
          const noteId = closestAnchor.href.slice(7);
          router.push({
            name: 'Note',
            params: { id: noteId },
            query: { linked: true },
          });
        } else {
          window.open(closestAnchor.href, '_blank', 'noopener');
        }
      }
    }

    onMounted(() => {
      if (!editor.value) return;
      emit('init', editor.value);

      if (safeContent.value) {
        editor.value.commands.setContent(safeContent.value);
      }

      if (props.cursorPosition) {
        const { state, view } = editor.value;
        const pos = Math.min(props.cursorPosition, state.doc.content.size);
        const tr = state.tr.setSelection(
          state.selection.constructor.near(state.doc.resolve(pos))
        );
        view.dispatch(tr);
      }

      editor.value.on('update', () => {
        const data = editor.value.getJSON();
        emit('update', data);
        emit('update:modelValue', data);
      });
    });

    watch(safeContent, (val) => {
      if (!editor.value || !val) return;
      const isEmpty = editor.value.isEmpty;
      if (isEmpty) {
        editor.value.commands.setContent(val);
      }
    });

    function destroyEditor({ defer = false } = {}) {
      const instance = editor.value;
      if (!instance) return;

      editor.value = null;

      const teardown = () => {
        try {
          instance.destroy();
        } catch {
          //do nothing
        }
      };

      if (defer) {
        if (typeof window !== 'undefined' && window.requestIdleCallback) {
          window.requestIdleCallback(teardown, { timeout: 250 });
          return;
        }

        setTimeout(teardown, 0);
        return;
      }

      teardown();
    }

    onBeforeUnmount(() => {
      destroyEditor({ defer: true });
    });

    watch(
      () => props.id,
      () => {
        destroyEditor();
      }
    );

    return { editor };
  },
};
</script>

<style src="@/assets/css/editor.css"></style>
