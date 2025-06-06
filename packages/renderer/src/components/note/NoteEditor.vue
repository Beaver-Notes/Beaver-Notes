<template>
  <div class="note-editor">
    <slot v-bind="{ editor }" />
    <editor-content
      :editor="editor"
      class="prose dark:text-neutral-100 max-w-none prose-indigo print:cursor-none"
    />
    <note-bubble-menu v-if="editor && editor.isEditable" v-bind="{ editor }" />
  </div>
</template>

<script>
import { onMounted, watch, ref } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import { useRouter } from 'vue-router';
import { extensions, CollapseHeading, heading } from '@/lib/tiptap';
import NoteBubbleMenu from './NoteBubbleMenu.vue';
import '@/assets/css/one-dark.css';
import '@/assets/css/one-light.css';
import { dropFile } from '@/lib/tiptap/exts/drop-file';
import { useAppStore } from '../../store/app';

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
    const appStore = useAppStore();
    const exts = [...extensions, dropFile.configure({ id: props.id })];
    if (appStore.setting.collapsibleHeading) {
      exts.push(CollapseHeading);
    } else {
      exts.push(heading);
    }
    const editor = useEditor({
      content: props.modelValue,
      autofocus: props.cursorPosition,
      editorProps: {
        handleClick,
      },
      extensions: exts,
    });

    const selectedDarkText =
      localStorage.getItem('selected-dark-text') || 'white';
    document.documentElement.style.setProperty(
      '--selected-dark-text',
      selectedDarkText
    );

    function handleClick(view, pos, { target, altKey }) {
      const closestAnchor = target.closest('a');

      const isTiptapURL = closestAnchor?.hasAttribute('tiptap-url');
      const isMentionURL = target.hasAttribute('data-mention');

      if (isTiptapURL && altKey) {
        if (closestAnchor.href.startsWith('note://')) {
          const noteId = closestAnchor.href.slice(7);
          router.push({
            params: { id: noteId },
            query: { linked: true },
          });
        } else {
          window.open(closestAnchor.href, '_blank', 'noopener');
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
        let data = editor.value.getJSON();

        data.content = data.content?.filter(
          (node) =>
            !(
              node.type === 'paragraph' &&
              (!node.content || node.content.length === 0)
            )
        );

        emit('update', data);
        emit('update:modelValue', data);
      });
    });

    const isTyping = ref(false);
    let typingTimeout;

    watch(
      () => editor.value && editor.value.getHTML(),
      (newValue, oldValue) => {
        if (newValue !== oldValue) {
          clearTimeout(typingTimeout);

          isTyping.value = true;

          typingTimeout = setTimeout(() => {
            isTyping.value = false;
          }, 1000);
        }
      }
    );

    return {
      editor,
      isTyping,
    };
  },
};
</script>

<style src="@/assets/css/editor.css"></style>
