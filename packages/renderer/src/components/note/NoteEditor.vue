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
import { onMounted, watch, ref } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import { useRouter } from 'vue-router';
import { extensions, CollapseHeading } from '@/lib/tiptap';
import NoteBubbleMenu from './NoteBubbleMenu.vue';
import '@/assets/css/one-dark.css';
import '@/assets/css/one-light.css';
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
    const exts = [...extensions];
    if (appStore.setting.collapsibleHeading) {
      exts.push(CollapseHeading);
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

      // Check if the anchor has the specific attribute or is a mention
      const isTiptapURL = closestAnchor?.hasAttribute('tiptap-url');
      const isMentionURL = target.hasAttribute('data-mention');

      // If it's a Tiptap URL and Alt key is held
      if (isTiptapURL && altKey) {
        if (closestAnchor.href.startsWith('note://')) {
          // Handle internal navigation
          const noteId = closestAnchor.href.slice(7);
          router.push({
            params: { id: noteId },
            query: { linked: true },
          });
        } else {
          // Open external links in a new tab
          window.open(closestAnchor.href, '_blank', 'noopener');
        }
      } else if (isMentionURL) {
        // Handle mention links
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
