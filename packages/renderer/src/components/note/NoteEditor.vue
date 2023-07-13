<template>
  <div class="note-editor">
    <slot v-bind="{ editor }" />
    <editor-content
      :editor="editor"
      class="prose dark:text-gray-100 max-w-none prose-indigo"
    />
    <note-bubble-menu v-if="editor" v-bind="{ editor }" />
  </div>
</template>

<script>
import { onMounted } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import { useRouter } from 'vue-router';
import { extensions } from '@/lib/tiptap';
import NoteBubbleMenu from './NoteBubbleMenu.vue';
import '@/assets/css/one-dark.css';
import '@/assets/css/one-light.css';

export default {
  components: {
    EditorContent,
    NoteBubbleMenu,
  },
  props: {
    modelValue: {
      type: [String, Object],
      default: '',
    },
    id: {
      type: String,
      default: '',
    },
    cursorPosition: {
      type: Number,
      default: 0,
    },
  },
  emits: ['init', 'update', 'update:modelValue'],
  setup(props, { emit }) {
    const router = useRouter();
    const editor = useEditor({
      content: props.modelValue,
      autofocus: props.cursorPosition,
      editorProps: {
        handleClick,
      },
      extensions,
    });

    function handleClick(view, pos, { target, ctrlKey, cmdKey }) {
      const closestAnchor = target.closest('a');
      const isTiptapURL = closestAnchor?.hasAttribute('tiptap-url');

      const isMentionURL = target.hasAttribute('data-mention');

      if (isTiptapURL && (ctrlKey || cmdKey)) {
        if (closestAnchor.href.startsWith('note://')) {
          const noteId = closestAnchor.href.slice(7);

          router.push({
            params: { id: noteId },
            query: { linked: true },
          });
        } else {
          window.open(target.href, '_blank', 'noopener');
        }
      } else if (isMentionURL) {
        router.push(`/?label=${encodeURIComponent(target.dataset.id)}`);
      }
    }

    onMounted(() => {
      emit('init', editor.value);

      editor.value.options.element.style.fontSize =
        (localStorage.getItem('font-size') || '16') + 'px';
      editor.value.on('update', () => {
        const data = editor.value.getJSON();

        emit('update', data);
        emit('update:modelValue', data);
      });
    });

    return {
      editor,
    };
  },
};
</script>
<style src="@/assets/css/editor.css"></style>
