<template>
  <bubble-menu
    v-if="editor"
    :editor="editor"
    :update-delay="100"
    :should-show="shouldShowMenuFn"
  >
    <component
      :is="currentMenuComponent"
      v-if="currentMenuComponent"
      v-bind="{ editor, id, note }"
    />
  </bubble-menu>
</template>

<script>
import { onMounted, onUnmounted, computed } from 'vue';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import Mousetrap from '@/lib/mousetrap';
import NoteBubbleMenuLink from './NoteBubbleMenuLink.vue';
import NoteBubbleMenuImage from './NoteBubbleMenuImage.vue';
import NoteBubbleMenuEditor from './NoteBubbleMenuEditor.vue';

export default {
  components: {
    BubbleMenu,
    NoteBubbleMenuLink,
    NoteBubbleMenuImage,
    NoteBubbleMenuEditor,
  },
  props: {
    editor: { type: Object, default: null },
    id: { type: String, default: '' },
    note: { type: Object, required: true },
  },
  setup(props) {
    const shouldShowMenuFn = ({ editor, state }) => {
      if (!editor) return false;

      const { selection } = state;
      const { empty } = selection;

      // Always show for images and links
      if (editor.isActive('image') || editor.isActive('link')) return true;

      // Don't show for atomic / drawing blocks
      if (
        !empty &&
        (editor.isActive('codeBlock') ||
          editor.isActive('mathBlock') ||
          editor.isActive('mermaidBlock') ||
          editor.isActive('paper'))
      )
        return false;

      return !empty;
    };

    const currentMenuComponent = computed(() => {
      if (!props.editor) return null;
      if (props.editor.isActive('image')) return 'note-bubble-menu-image';
      if (props.editor.isActive('link')) return 'note-bubble-menu-link';

      if (props.editor.state.selection.empty) return null;

      if (
        props.editor.isActive('codeBlock') ||
        props.editor.isActive('mathBlock') ||
        props.editor.isActive('mermaidBlock') ||
        props.editor.isActive('paper')
      )
        return null;

      return 'note-bubble-menu-editor';
    });

    onMounted(() => {
      if (props.editor) {
        Mousetrap.bind('mod+l', () => {
          if (props.editor.isActive('image') || props.editor.isActive('link')) {
            const input = document.getElementById('bubble-input');
            input?.focus();
          }
        });
      }
    });

    onUnmounted(() => {
      if (props.editor) {
        Mousetrap.unbind('mod+l');
      }
    });

    return {
      shouldShowMenuFn,
      currentMenuComponent,
    };
  },
};
</script>
