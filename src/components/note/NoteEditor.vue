<template>
  <div class="note-editor mb-64">
    <slot v-bind="{ editor }" />
    <drag-handle
      v-if="editor && showDragHandle"
      :editor="editor"
      :compute-position-config="computePositionConfig"
      :on-element-drag-start="onElementDragStart"
      :on-element-drag-end="onElementDragEnd"
      :on-node-change="onNodeChange"
      class="drag-handle"
      :class="{ 'opacity-0 pointer-events-none': isDragging }"
    >
      <div class="drag-handle-inner">
        <button
          class="dh-button"
          title="Add block"
          @click.prevent="addBlock"
        >
          <v-remixicon name="riAddLine" class="dh-icon" />
        </button>
        <div class="dh-grip">
          <v-remixicon name="riDraggable" class="dh-icon" />
        </div>
      </div>
    </drag-handle>
    <editor-content
      v-if="editor"
      :editor="editor"
      class="note-editor__content prose prose-stone dark:text-neutral-100 max-w-none print:cursor-none"
    />
    <note-bubble-menu v-if="editor" v-bind="{ editor, note }" />
    <table-handle v-if="editor" :editor="editor" />
    <table-selection-overlay v-if="editor" :editor="editor" />
    <table-extend-row-column-button v-if="editor" :editor="editor" />
  </div>
</template>

<script>
import {
  onMounted,
  onBeforeUnmount,
  watch,
  computed,
  ref,
  nextTick,
} from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import { isEncryptedContent } from '@/utils/crypto/encryption.js';
import { sanitizeNoteContent } from '@/utils/note/contentSecurity.js';
import { useRouter } from 'vue-router';
import {
  extensions,
  createBaseExtensions,
  CollapseHeading,
  heading,
  dropFile,
  Commands,
} from '@/lib/tiptap';
import { NodeRangeSelection } from '@tiptap/extension-node-range';
import { DragHandle } from '@tiptap/extension-drag-handle-vue-3';
import { useAppStore } from '../../store/app';
import { offset } from '@floating-ui/dom';
import Collaboration from '@tiptap/extension-collaboration';
import NoteBubbleMenu from './NoteBubbleMenu.vue';
import TableHandle from '@/lib/tiptap/exts/table/TableHandle.vue';
import TableSelectionOverlay from '@/lib/tiptap/exts/table/TableSelectionOverlay.vue';
import TableExtendRowColumnButton from '@/lib/tiptap/exts/table/TableExtendRowColumnButton.vue';

export default {
  components: {
    EditorContent,
    DragHandle,
    NoteBubbleMenu,
    TableHandle,
    TableSelectionOverlay,
    TableExtendRowColumnButton,
  },
  props: {
    modelValue: { type: [String, Object], default: '' },
    id: { type: String, default: '' },
    cursorPosition: { type: Number, default: 0 },
    note: { type: Object, default: () => ({}) },
    ydoc: { type: Object, default: null },
  },
  emits: ['init', 'update', 'update:modelValue'],
  setup(props, { emit }) {
    const router = useRouter();
    const appStore = useAppStore();

    const isYjs = !!props.ydoc;
    const isRtl = document.documentElement.getAttribute('dir') === 'rtl';

    const showDragHandle = ref(
      typeof window !== 'undefined' ? window.innerWidth >= 768 : true
    );
    const isDragging = ref(false);
    const currentNodePos = ref(-1);

    function updateDragHandleVisibility() {
      showDragHandle.value = window.innerWidth >= 768;
    }

    function onElementDragStart() {
      isDragging.value = true;
    }

    function onElementDragEnd() {
      isDragging.value = false;
      nextTick(() => {
        if (editor.value && !editor.value.isDestroyed) {
          editor.value.view.dom.blur();
          editor.value.view.focus();
        }
      });
    }

    function onNodeChange({ pos }) {
      currentNodePos.value = pos;
    }

    function addBlock() {
      if (!editor.value) return;
      const pos =
        currentNodePos.value >= 0
          ? currentNodePos.value
          : editor.value.state.selection.from;
      const node = editor.value.state.doc.nodeAt(pos);
      if (!node) return;
      const isEmptyParagraph =
        node.type.name === 'paragraph' && node.childCount === 0;
      const insertPos = isEmptyParagraph ? pos : pos + node.nodeSize;
      editor.value
        .chain()
        .focus()
        .insertContentAt(insertPos, [
          { type: 'paragraph', content: [{ type: 'text', text: '/' }] },
        ])
        .run();
    }

    const SCROLL_ZONE = 40;
    const SCROLL_SPEED = 8;
    let dragScrollRafId = null;
    let lastClientY = 0;

    function isOverEditor(x, y) {
      if (!editor.value) return false;
      const rect = editor.value.view.dom.getBoundingClientRect();
      return (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      );
    }

    function tickDragScroll() {
      dragScrollRafId = null;
      const viewportHeight = window.innerHeight;
      let deltaY = 0;
      if (lastClientY < SCROLL_ZONE) {
        deltaY = -SCROLL_SPEED;
      } else if (lastClientY > viewportHeight - SCROLL_ZONE) {
        deltaY = SCROLL_SPEED;
      }
      if (deltaY !== 0) {
        const before = window.scrollY;
        window.scrollBy(0, deltaY);
        if (window.scrollY !== before + deltaY) {
          window.scrollTo(0, before + deltaY);
        }
        dragScrollRafId = requestAnimationFrame(tickDragScroll);
      }
    }

    function onDragOver(e) {
      if (!editor.value) return;
      if (!isOverEditor(e.clientX, e.clientY)) return;
      lastClientY = e.clientY;
      if (!dragScrollRafId) {
        dragScrollRafId = requestAnimationFrame(tickDragScroll);
      }
    }

    function onDragEnd() {
      if (dragScrollRafId) {
        cancelAnimationFrame(dragScrollRafId);
        dragScrollRafId = null;
      }
    }

    function onDrop() {
      onDragEnd();
    }

    onMounted(() => {
      window.addEventListener('resize', updateDragHandleVisibility);
      window.addEventListener('dragover', onDragOver);
      window.addEventListener('dragend', onDragEnd);
      window.addEventListener('drop', onDrop);
    });

    onBeforeUnmount(() => {
      window.removeEventListener('resize', updateDragHandleVisibility);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragend', onDragEnd);
      window.removeEventListener('drop', onDrop);
      if (dragScrollRafId) {
        cancelAnimationFrame(dragScrollRafId);
        dragScrollRafId = null;
      }
    });

    const fixedGutterMiddleware = {
      name: 'fixedGutter',
      fn({ elements }) {
        const editorElement = editor.value?.view?.dom;
        const contentElement = editorElement?.parentElement;

        if (!editorElement || !contentElement) return {};

        const rootElement =
          contentElement.closest?.('.note-editor') || contentElement;
        const gutterValue = getComputedStyle(rootElement)
          .getPropertyValue('--drag-handle-gutter')
          .trim();
        const gutterWidth = Number.parseFloat(gutterValue) || 48;
        const handleWidth =
          elements.floating.getBoundingClientRect().width || 20;
        const gutterOffset = Math.max((gutterWidth - handleWidth) / 2, 0);

        return {
          x: isRtl
            ? contentElement.clientWidth - gutterWidth + gutterOffset
            : gutterOffset,
        };
      },
    };

    const computePositionConfig = computed(() => {
      return {
        placement: isRtl ? 'right-start' : 'left-start',
        strategy: 'absolute',
        middleware: [
          offset(({ rects }) => {
            const nodeHeight = rects.reference.height;
            const handleHeight = rects.floating.height;
            const crossAxis =
              nodeHeight > 40 ? 0 : nodeHeight / 2 - handleHeight / 2;
            return { crossAxis };
          }),
          fixedGutterMiddleware,
        ],
      };
    });

    const exts = [
      ...(isYjs && props.ydoc ? createBaseExtensions({ yjs: true }) : extensions),
      dropFile.configure({ id: props.id }),
      NodeRangeSelection,
    ];
    if (typeof window === 'undefined' || window.innerWidth >= 768) {
      exts.push(Commands);
    }
    exts.push(appStore.setting.collapsibleHeading ? CollapseHeading : heading);

    if (isYjs && props.ydoc) {
      exts.push(
        Collaboration.configure({
          document: props.ydoc,
          field: 'content',
        })
      );
    }

    let _lastContent = null;
    let _lastSanitized = null;
    const safeContent = computed(() => {
      if (isYjs) return '';
      if (isEncryptedContent(props.modelValue)) return '';
      if (props.modelValue === _lastContent) return _lastSanitized;
      _lastContent = props.modelValue;
      _lastSanitized = sanitizeNoteContent(props.modelValue);
      return _lastSanitized;
    });

    const hasUserEdited = ref(false);
    let pendingProgrammaticUpdates = 0;

    const editorTimerLabel = `[perf] editor ${props.id}`;
    console.time(editorTimerLabel);
    const editor = useEditor({
      content: isYjs ? undefined : safeContent.value,
      autofocus: props.cursorPosition,
      extensions: exts,
      editorProps: {
        handleClick,
        handleDOMEvents: {
          drop: (view) => {
            const scrollY = window.scrollY;
            const origDispatch = view.dispatch.bind(view);
            view.dispatch = function (tr) {
              origDispatch(tr);
              window.scrollTo(0, scrollY);
            };
            setTimeout(() => {
              view.dispatch = origDispatch;
            }, 0);
            return false;
          },
        },
        attributes: {
          'data-testid': 'note-body-editor',
        },
      },
    });

    function handleClick(view, pos, { target }) {
      const noteLinkEl = target.closest('a[data-link-note]');
      if (noteLinkEl) {
        const noteId = noteLinkEl.getAttribute('data-id');
        if (!noteId) return true;
        router.push({
          name: 'Note',
          params: { id: noteId },
          query: { linked: true, from: props.id },
        });
        return true;
      }

      const externalAnchor = target.closest('a[tiptap-url]');
      if (externalAnchor) {
        const href =
          externalAnchor.href || externalAnchor.getAttribute('href') || '';

        if (href.startsWith('note://')) {
          const noteId = href.slice('note://'.length);
          if (noteId) {
            router.push({
              name: 'Note',
              params: { id: noteId },
              query: { linked: true, from: props.id },
            });
          }
          return true;
        }

        window.open(href, '_blank', 'noopener');
        return true;
      }
    }

    onMounted(() => {
      if (!editor.value) return;
      emit('init', editor.value);
      console.timeEnd(editorTimerLabel);

      if (!isYjs && safeContent.value) {
        editor.value.commands.setContent(safeContent.value);
      }

      if (props.cursorPosition) {
        const { state, view } = editor.value;
        const pos = Math.min(props.cursorPosition, state.doc.content.size);
        const tr = state.tr.setSelection(
          state.selection.constructor.near(state.doc.resolve(pos))
        );
        view.dispatch(tr);
      }

      editor.value.on('update', () => {
        if (isYjs) {
          emit('update', null);
          return;
        }
        if (pendingProgrammaticUpdates > 0) {
          pendingProgrammaticUpdates--;
          return;
        }
        hasUserEdited.value = true;
        const data = editor.value.getJSON();
        emit('update', data);
        emit('update:modelValue', data);
      });
    });

    if (!isYjs) {
      watch(safeContent, (val) => {
        if (!editor.value || !val) return;
        if (!hasUserEdited.value) {
          pendingProgrammaticUpdates++;
          editor.value.commands.setContent(val);
        }
      });
    }

    function destroyEditor({ defer = false } = {}) {
      const instance = editor.value;
      if (!instance) return;

      editor.value = null;

      const teardown = () => {
        try {
          instance.destroy();
        } catch {
          //do nothing
        }
      };

      if (defer) {
        if (typeof window !== 'undefined' && window.requestIdleCallback) {
          window.requestIdleCallback(teardown, { timeout: 250 });
          return;
        }

        setTimeout(teardown, 0);
        return;
      }

      teardown();
    }

    onBeforeUnmount(() => {
      destroyEditor({ defer: true });
    });

    watch(
      () => props.id,
      () => {
        destroyEditor();
      }
    );

    return {
      editor,
      computePositionConfig,
      showDragHandle,
      isDragging,
      currentNodePos,
      onElementDragStart,
      onElementDragEnd,
      onNodeChange,
      addBlock,
    };
  },
};
</script>

<style src="@/assets/css/editor.css"></style>
