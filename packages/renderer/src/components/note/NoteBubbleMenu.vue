<template>
  <bubble-menu
    v-show="editor.isActive('image') || editor.isActive('link')"
    v-bind="{ editor, shouldShow: () => true }"
    class="bg-white dark:bg-gray-800 rounded-lg max-w-xs border shadow-xl"
  >
    <component
      :is="
        editor.isActive('image')
          ? 'note-bubble-menu-image'
          : 'note-bubble-menu-link'
      "
      v-bind="{ editor }"
    />
  </bubble-menu>
</template>

<script>
import { onMounted, onUnmounted, watch } from 'vue';
import { BubbleMenu } from '@tiptap/vue-3';
import Mousetrap from '@/lib/mousetrap';
import NoteBubbleMenuLink from './NoteBubbleMenuLink.vue';
import NoteBubbleMenuImage from './NoteBubbleMenuImage.vue';

export default {
  components: { BubbleMenu, NoteBubbleMenuLink, NoteBubbleMenuImage },
  props: {
    editor: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props) {
    const focusInput = () => {
      const input = document.getElementById('bubble-input');
      input?.focus();
    };

    onMounted(() => {
      Mousetrap.bind('mod+l', focusInput);
    });

    onUnmounted(() => {
      Mousetrap.unbind('mod+l');
    });

    // Watch for changes in the active mode of the editor
    watch(
      () => [props.editor.isActive('image'), props.editor.isActive('link')],
      ([isImageActive, isLinkActive]) => {
        if (isImageActive || isLinkActive) {
          focusInput();
        }
      }
    );

    return {
      focusInput,
    };
  },
};
</script>
