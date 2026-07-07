<template>
  <!-- Selection-based bubble menu for text formatting and images -->
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

  <!-- Hover-based link menu -->
  <teleport to="body">
    <div
      v-if="hoveredLinkEl"
      ref="hoverMenuRef"
      :style="hoverMenuStyles"
      class="fixed z-50"
      @mouseenter="hoverMenuVisible = true"
      @mouseleave="onHoverMenuLeave"
    >
      <note-bubble-menu-link
        :id="id"
        :editor="editor"
        :note="note"
        :hover-link-attrs="hoverLinkAttrs"
        :hover-link-el="hoveredLinkEl"
        @close="closeHoverMenu"
        @action="onLinkAction"
      />
    </div>
  </teleport>
</template>

<script>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import {
  computePosition,
  offset,
  flip,
  shift,
  autoUpdate,
} from '@floating-ui/dom';
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
    const hoveredLinkEl = ref(null);
    const hoverMenuRef = ref(null);
    const hoverMenuStyles = ref({});
    const hoverMenuVisible = ref(false);
    let hoverCleanup = null;

    // Extract link attributes from the hovered DOM element
    const hoverLinkAttrs = computed(() => {
      const el = hoveredLinkEl.value;
      if (!el) return null;

      if (el.hasAttribute('data-link-note')) {
        return {
          type: 'linkNote',
          id: el.getAttribute('data-id'),
          label: el.getAttribute('data-label') || el.textContent,
          href:
            el.getAttribute('href') || `note://${el.getAttribute('data-id')}`,
        };
      }

      if (el.hasAttribute('tiptap-url')) {
        const href = el.getAttribute('href') || '';

        // Treat note:// URLs as internal note links
        if (href.startsWith('note://')) {
          const noteId = href.slice('note://'.length);
          return {
            type: 'linkNote',
            id: noteId,
            label: el.textContent || noteId,
            href,
          };
        }

        return {
          type: 'link',
          href,
        };
      }

      return null;
    });

    function positionHoverMenu() {
      const el = hoveredLinkEl.value;
      const menu = hoverMenuRef.value;
      if (!el || !menu) return;

      if (hoverCleanup) hoverCleanup();

      hoverCleanup = autoUpdate(el, menu, () => {
        computePosition(el, menu, {
          placement: 'top',
          middleware: [offset(6), flip(), shift({ padding: 8 })],
        }).then(({ x, y }) => {
          hoverMenuStyles.value = {
            left: `${x}px`,
            top: `${y}px`,
            position: 'fixed',
          };
        });
      });
    }

    function showHoverMenu(linkEl) {
      hoveredLinkEl.value = linkEl;
      hoverMenuVisible.value = true;
      nextTick(() => positionHoverMenu());
    }

    function closeHoverMenu() {
      hoveredLinkEl.value = null;
      hoverMenuVisible.value = false;
      hoverMenuStyles.value = {};
      if (hoverCleanup) {
        hoverCleanup();
        hoverCleanup = null;
      }
    }

    function onHoverMenuLeave() {
      // Small delay so the menu doesn't flicker when moving mouse to it
      setTimeout(() => {
        if (!hoverMenuVisible.value) return;
        // Check if mouse is actually outside the menu
        const menu = hoverMenuRef.value;
        if (menu && !menu.matches(':hover')) {
          closeHoverMenu();
        }
      }, 100);
    }

    function onLinkAction() {
      // When user edits or removes a link from the hover menu, keep it open
    }

    function handleMouseOver(event) {
      const target = event.target;
      const linkEl =
        target.closest('a[data-link-note]') || target.closest('a[tiptap-url]');
      if (linkEl && linkEl !== hoveredLinkEl.value) {
        showHoverMenu(linkEl);
      }
    }

    function handleMouseOut(event) {
      const target = event.target;
      const linkEl =
        target.closest('a[data-link-note]') || target.closest('a[tiptap-url]');
      if (!linkEl && hoveredLinkEl.value) {
        // Mouse left the link – close if not hovering the menu
        setTimeout(() => {
          const menu = hoverMenuRef.value;
          if (menu && menu.matches(':hover')) return;
          closeHoverMenu();
        }, 80);
      }
    }

    const shouldShowMenuFn = ({ editor, state }) => {
      if (!editor) return false;

      const { selection } = state;
      const { empty } = selection;

      // Always show for images
      if (editor.isActive('image')) return true;

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
      if (!props.editor || !props.editor.view) return;

      const editorDom = props.editor.view.dom;
      if (!editorDom) return;

      editorDom.addEventListener('mouseover', handleMouseOver);
      editorDom.addEventListener('mouseout', handleMouseOut);

      Mousetrap.bind('mod+l', () => {
        if (props.editor.isActive('image')) {
          const input = document.getElementById('bubble-input');
          input?.focus();
        }
      });
    });

    onUnmounted(() => {
      try {
        if (props.editor && props.editor.view) {
          const editorDom = props.editor.view.dom;
          if (editorDom) {
            editorDom.removeEventListener('mouseover', handleMouseOver);
            editorDom.removeEventListener('mouseout', handleMouseOut);
          }
        }
      } catch {}
      try {
        Mousetrap.unbind('mod+l');
      } catch {}
      try {
        if (hoverCleanup) hoverCleanup();
      } catch {}
    });

    return {
      shouldShowMenuFn,
      currentMenuComponent,
      hoveredLinkEl,
      hoverMenuRef,
      hoverMenuStyles,
      hoverLinkAttrs,
      closeHoverMenu,
      onHoverMenuLeave,
      onLinkAction,
    };
  },
};
</script>
