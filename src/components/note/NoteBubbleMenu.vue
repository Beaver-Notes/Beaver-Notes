<template>
  <bubble-menu
    v-if="editor"
    :editor="editor"
    :update-delay="0"
    :should-show="shouldShowMenuFn"
    :class="menuClass"
  >
    <component :is="currentMenuComponent" v-bind="{ editor, id, note }" />
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
    editor: { type: Object, default: () => ({}) },
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

      // Don't show for non-editable text nodes
      if (
        !empty &&
        (editor.isActive('codeBlock') ||
          editor.isActive('mathBlock') ||
          editor.isActive('mermaidBlock'))
      )
        return false;

      return !empty;
    };

    const shouldShowMenu = computed(() => {
      if (!props.editor) return false;

      return (
        props.editor.isActive('image') ||
        props.editor.isActive('link') ||
        !props.editor.state.selection.empty
      );
    });

    const currentMenuComponent = computed(() => {
      if (props.editor.isActive('image')) return 'note-bubble-menu-image';
      if (props.editor.isActive('link')) return 'note-bubble-menu-link';

      if (props.editor.state.selection.empty) return null;

      // Don't show editor toolbar inside blocks where formatting doesn't apply
      if (
        props.editor.isActive('codeBlock') ||
        props.editor.isActive('mathBlock') ||
        props.editor.isActive('mermaidBlock')
      )
        return null;

      return 'note-bubble-menu-editor';
    });

    const menuClass = computed(() =>
      props.editor?.isActive('image')
        ? 'max-w-none border-0 bg-transparent shadow-none'
        : 'bg-white dark:bg-neutral-800 rounded-xl max-w-xs border shadow-xl'
    );

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
      shouldShowMenu,
      currentMenuComponent,
      menuClass,
    };
  },
};
</script>
