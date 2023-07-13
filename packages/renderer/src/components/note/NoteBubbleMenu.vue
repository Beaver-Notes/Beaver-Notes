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
import { onMounted, onUnmounted } from 'vue';
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
    onMounted(() => {
      Mousetrap.bind('mod+l', () => {
        if (props.editor.isActive('image') || props.editor.isActive('link')) {
          const input = document.getElementById('bubble-input');

          input?.focus();
        }
      });
    });
    onUnmounted(() => {
      Mousetrap.unbind('mod+l');
    });
  },
};
</script>
