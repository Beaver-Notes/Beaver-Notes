<template>
  <bubble-menu
    v-if="editor"
    :editor="editor"
    :update-delay="100"
    :should-show="shouldShowMenuFn"
    class="z-50"
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
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import { useUiState } from '@/composable/useUiState';
import {
  computePosition,
  offset,
  flip,
  shift,
  autoUpdate,
} from '@floating-ui/dom';
import { CellSelection } from '@tiptap/pm/tables';
import { NodeSelection } from '@tiptap/pm/state';
import Mousetrap from '@/lib/mousetrap';
import NoteBubbleMenuLink from './NoteBubbleMenuLink.vue';
import NoteBubbleMenuImage from './NoteBubbleMenuImage.vue';
import NoteBubbleMenuVideo from './NoteBubbleMenuVideo.vue';
import NoteBubbleMenuEditor from './NoteBubbleMenuEditor.vue';

export default {
  components: {
    BubbleMenu,
    NoteBubbleMenuLink,
    NoteBubbleMenuImage,
    NoteBubbleMenuVideo,
    NoteBubbleMenuEditor,
  },
  props: {
    editor: { type: Object, default: null },
    id: { type: String, default: '' },
    note: { type: Object, required: true },
  },
  setup(props) {
    const uiState = useUiState();
    const hoveredLinkEl = ref(null);
    const hoverMenuRef = ref(null);
    const hoverMenuStyles = ref({});
    const hoverMenuVisible = ref(false);
    let hoverCleanup = null;

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
        setTimeout(() => {
          const menu = hoverMenuRef.value;
          if (menu && menu.matches(':hover')) return;
          closeHoverMenu();
        }, 80);
      }
    }

    // Node types where the text-formatting bubble is irrelevant (media/atomic
    // blocks). image/Video have their own dedicated menus above; the entries
    // below show nothing. Legacy lowercase aliases included for old snapshots.
    // Single list shared by shouldShowMenuFn + currentMenuComponent so they
    // can't drift apart (mermaidBlock vs mermaidDiagram did exactly that).
    const NO_EDITOR_MENU_NODES = new Set([
      'codeBlock',
      'mathBlock',
      'mermaidBlock',
      'mermaidDiagram',
      'paper',
      'Audio',
      'audioBlock',
      'videoBlock',
      'fileEmbed',
    ]);

    // One bounded pass over the selection collecting node type names. The old
    // code called editor.isActive() up to 11 times here — each walking the
    // whole selected range — which after Cmd+A meant ~22 full-document walks
    // per menu evaluation on top of the native selection cost.
    function selectionNodeNames(state) {
      const { selection } = state;
      if (selection instanceof NodeSelection) {
        return new Set([selection.node.type.name]);
      }
      const { from, to, $from, $to, empty } = selection;
      const names = new Set();
      if (empty) {
        names.add($from.parent.type.name);
      } else if (to - from > 20000) {
        // Huge ranges (Cmd+A on big notes): skip the walk — parent types only.
        // A media node buried mid-range may then show the text menu, which is
        // cosmetic; the alternative is the multi-second stall we measured.
        names.add($from.parent.type.name);
        names.add($to.parent.type.name);
      } else {
        state.doc.nodesBetween(from, to, (node) => {
          names.add(node.type.name);
          return true;
        });
      }
      return names;
    }

    function classifySelection(state) {
      if (!state) return null;
      const { selection } = state;
      if (selection instanceof CellSelection) return null;
      const names = selectionNodeNames(state);
      if (names.has('image')) return 'image';
      if (names.has('Video')) return 'video';
      const { empty } = selection;
      if (!empty) {
        for (const name of names) {
          if (NO_EDITOR_MENU_NODES.has(name)) return null;
        }
        return 'editor';
      }
      return null;
    }

    const shouldShowMenuFn = ({ state }) =>
      !uiState.inReaderMode && classifySelection(state) !== null;

    const currentMenuComponent = computed(() => {
      if (!props.editor) return null;
      const kind = classifySelection(props.editor.state);
      if (kind === 'image') return 'note-bubble-menu-image';
      if (kind === 'video') return 'note-bubble-menu-video';
      if (kind === 'editor') return 'note-bubble-menu-editor';
      return null;
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
