<template>
  <div class="note-editor">
    <slot v-bind="{ editor }" />
    <editor-content
      :editor="editor"
      class="prose dark:text-gray-100 max-w-none prose-indigo"
      @paste="handlePaste"
    />
    <note-bubble-menu v-if="editor" v-bind="{ editor }" />
    <note-bubble-menu-table v-if="editor" v-bind="{ editor, isTyping }" />
  </div>
</template>

<script>
import { onMounted, watch, ref } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import { useRouter } from 'vue-router';
import { extensions } from '@/lib/tiptap';
import NoteBubbleMenuTable from './NoteBubbleMenuTable.vue';
import NoteBubbleMenu from './NoteBubbleMenu.vue';
import '@/assets/css/one-dark.css';
import '@/assets/css/one-light.css';

export default {
  components: {
    EditorContent,
    NoteBubbleMenu,
    NoteBubbleMenuTable,
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

    function handlePaste(event) {
      event.preventDefault();

      const clipboardData = event.clipboardData || window.clipboardData;
      const pastedHTML = clipboardData.getData('text/html');
      const pastedText = clipboardData.getData('text/plain');

      let contentToInsert = '';

      // Check if HTML content is available
      if (pastedHTML) {
        // Insert HTML content if available
        const lines = pastedHTML.split(/<\/p>/i);

        lines.forEach((line, index) => {
          if (line.trim() !== '') {
            // Add a newline character between lines
            if (index !== 0) {
              contentToInsert += '\n';
            }

            contentToInsert += line.trim();
          }
        });
      } else {
        // If HTML content is not available, handle plain text content
        const lines = pastedText.split(/\r\n|\r|\n/);

        lines.forEach((line, index) => {
          if (line.trim() !== '') {
            // Add a newline character between lines
            if (index !== 0) {
              contentToInsert += '\n';
            }

            contentToInsert += `<p>${line.trim()}</p>`;
          }
        });
      }

      // Add space before and after HTML tags except for specific ones
      contentToInsert = contentToInsert.replace(
        /<(?!\s*\/?\s*(a|br|i|em|strong|b))[^>]+>/gi,
        ' $& '
      );
      // Remove spaces before punctuation signs
      contentToInsert = contentToInsert.replace(/\s+([.,;:!?])/g, '$1');
      // Remove unnecessary spaces at the beginning and end of the content
      contentToInsert = contentToInsert.trim() + ' ';

      editor.value.commands.insertContent(contentToInsert);
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
      handlePaste,
      isTyping,
    };
  },
};
</script>
<style src="@/assets/css/editor.css"></style>
