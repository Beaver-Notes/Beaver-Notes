<template>
  <bubble-menu
    v-if="
      editor &&
      (editor.isActive('image') ||
        editor.isActive('link') ||
        editor.isActive('iframe'))
    "
    v-bind="{ editor, tippyOptions: bubbleMenuOptions }"
    class="bg-white dark:bg-neutral-800 rounded-lg max-w-xs border shadow-xl"
  >
    <component
      :is="
        editor.isActive('image')
          ? 'note-bubble-menu-image'
          : editor.isActive('iframe')
          ? 'note-bubble-menu-embed'
          : 'note-bubble-menu-link'
      "
      v-bind="{ editor }"
    />
  </bubble-menu>
</template>

<script>
import { onMounted, onUnmounted, computed } from 'vue';
import { BubbleMenu } from '@tiptap/vue-3';
import Mousetrap from '@/lib/mousetrap';
import NoteBubbleMenuLink from './NoteBubbleMenuLink.vue';
import NoteBubbleMenuImage from './NoteBubbleMenuImage.vue';
import NoteBubbleMenuEmbed from './NoteBubbleMenuEmbed.vue';

export default {
  components: {
    BubbleMenu,
    NoteBubbleMenuLink,
    NoteBubbleMenuImage,
    NoteBubbleMenuEmbed,
  },
  props: {
    editor: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props) {
    const bubbleMenuOptions = computed(() => {
      if (props.editor.isActive('link')) {
        const href = props.editor.getAttributes('link').href;
        if (href && href.startsWith('note://')) {
          return { placement: 'bottom' };
        }
      }
      return {};
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
      bubbleMenuOptions,
    };
  },
};
</script>
