<template>
  <bubble-menu
    v-if="editor"
    :editor="editor"
    :tippy-options="currentTippyOptions"
    :should-show="shouldShowMenuFn"
    :class="menuClass"
  >
    <component
      :is="currentMenuComponent"
      v-bind="{ editor }"
      v-if="shouldShowMenu"
    />
  </bubble-menu>
</template>

<script>
import { onMounted, onUnmounted, computed } from 'vue';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import Mousetrap from '@/lib/mousetrap';
import NoteBubbleMenuLink from './NoteBubbleMenuLink.vue';
import NoteBubbleMenuImage from './NoteBubbleMenuImage.vue';

export default {
  components: {
    BubbleMenu,
    NoteBubbleMenuLink,
    NoteBubbleMenuImage,
  },
  props: {
    editor: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props) {
    const shouldShowMenuFn = ({ editor }) => {
      if (!editor) return false;

      // Check if any of the target marks/nodes are active
      return editor.isActive('image') || editor.isActive('link');
    };

    const shouldShowMenu = computed(() => {
      if (!props.editor) return false;

      return props.editor.isActive('image') || props.editor.isActive('link');
    });

    const currentMenuComponent = computed(() => {
      if (props.editor.isActive('image')) return 'note-bubble-menu-image';
      if (props.editor.isActive('link')) return 'note-bubble-menu-link';
      return null;
    });

    const currentTippyOptions = computed(() => {
      const baseOptions = {
        placement: 'bottom',
        interactive: true,
        hideOnClick: true,
        duration: [200, 150],
      };

      if (props.editor.isActive('image')) {
        return {
          ...baseOptions,
          offset: [0, 18],
        };
      }

      if (props.editor.isActive('link')) {
        const href = props.editor.getAttributes('link').href;
        if (href && href.startsWith('note://')) {
          return { ...baseOptions, placement: 'bottom' };
        }
      }

      return baseOptions;
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
      currentTippyOptions,
      menuClass,
    };
  },
};
</script>
