<template>
  <div class="note-editor">
    <slot v-bind="{ editor }" />
    <editor-content
      v-if="editor"
      :editor="editor"
      class="prose dark:text-neutral-100 max-w-none prose-indigo print:cursor-none"
    />
    <note-bubble-menu v-if="editor?.value?.isEditable" v-bind="{ editor }" />
  </div>
</template>

<script>
import { onMounted, onBeforeUnmount, watch } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
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

    const editor = useEditor({
      content: props.modelValue,
      autofocus: props.cursorPosition,
      extensions: exts,
      editorProps: { handleClick },
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

      editor.value.on('update', () => {
        const data = editor.value.getJSON();
        emit('update', data);
        emit('update:modelValue', data);
      });
    });

    onBeforeUnmount(() => {
      if (editor.value) {
        try {
          editor.value.destroy();
        } catch {
          //do nothing
        }
        editor.value = null;
      }
    });

    watch(
      () => props.id,
      () => {
        if (editor.value) {
          editor.value.destroy();
          editor.value = null;
        }
      }
    );

    return { editor };
  },
};
</script>

<style src="@/assets/css/editor.css"></style>
