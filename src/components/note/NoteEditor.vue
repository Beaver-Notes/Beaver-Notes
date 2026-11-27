<template>
  <div class="note-editor mb-64" :class="{ 'is-ipad': isIpad }">
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
          :title="translations.menu?.insertBlock || 'Add block'"
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
      ref="editorContentRef"
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
import { isSafeOpenUrl, sanitizeNoteContent } from '@/utils/note/contentSecurity.js';
import { useRouter } from 'vue-router';
import {
  extensions,
  createBaseExtensions,
  CollapseHeading,
  heading,
  dropFile,
  Commands,
} from '@/lib/tiptap';
import { canEdit } from '@/utils/permissions';
import VersionPreview from '@/lib/tiptap/exts/version-preview';
import LiveCollab from '@/lib/tiptap/exts/live-collab';
import { NodeRangeSelection } from '@tiptap/extension-node-range';
import { DragHandle } from '@tiptap/extension-drag-handle-vue-3';
import { useAppStore } from '../../store/app';
import { offset } from '@floating-ui/dom';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationSeed from '@/lib/tiptap/exts/collaboration-seed';
import CollaborationCursor from '@tiptap/extension-collaboration-caret';
import { CommentExtension } from '@sereneinserenade/tiptap-comment-extension';
import { isIPadRuntime } from '@/lib/tauri/runtime';
import { useBlockDrag } from '@/composable/useBlockDrag';
import NoteBubbleMenu from './NoteBubbleMenu.vue';
import TableHandle from '@/lib/tiptap/exts/table/TableHandle.vue';
import TableSelectionOverlay from '@/lib/tiptap/exts/table/TableSelectionOverlay.vue';
import TableExtendRowColumnButton from '@/lib/tiptap/exts/table/TableExtendRowColumnButton.vue';
import { useTranslations } from '@/composable/useTranslations';
import { getColorFromId } from '@/composable/usePresence';

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
    awareness: { type: Object, default: null },
    userName: { type: String, default: 'Anonymous' },
    userId: { type: String, default: '' },
    role: { type: String, default: 'editor' },
  },
  emits: [
    'init',
    'update',
    'update:modelValue',
    'comment-activated',
    'activity',
  ],
  setup(props, { emit }) {
    const router = useRouter();
    const appStore = useAppStore();
    const { translations } = useTranslations();

    const isYjs = computed(() => !!props.ydoc);
    const isRtl = document.documentElement.getAttribute('dir') === 'rtl';

    const isIpad = isIPadRuntime();
    const showDragHandle = ref(
      typeof window !== 'undefined' ? window.innerWidth >= 768 && !isIpad : true,
    );
    const isDragging = ref(false);
    const currentNodePos = ref(-1);
    const editorContentRef = ref(null);

    function updateDragHandleVisibility() {
      showDragHandle.value = window.innerWidth >= 768 && !isIpad;
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

    let blockDragUnbind = null;

    onMounted(() => {
      window.addEventListener('resize', updateDragHandleVisibility);
      window.addEventListener('dragover', onDragOver);
      window.addEventListener('dragend', onDragEnd);
      window.addEventListener('drop', onDrop);

      // Bind long-press block drag on the editor content DOM element.
      nextTick(() => {
        const el = editorContentRef.value?.$el;
        if (el) {
          blockDragUnbind = bindBlockDrag(el);
        }
      });
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
      if (blockDragUnbind) {
        blockDragUnbind();
        blockDragUnbind = null;
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
      ...(isYjs.value && props.ydoc
        ? createBaseExtensions({ yjs: true })
        : extensions),
      dropFile.configure({ id: props.id }),
      NodeRangeSelection,
    ];
    // Always registered (mobile keeps its block picker as an extra affordance).
    exts.push(Commands.configure({ id: props.id }));
    exts.push(appStore.setting.collapsibleHeading ? CollapseHeading : heading);
    exts.push(VersionPreview);
    // Live (Google-Docs-style) attribution for remote websocket edits. Stays
    // editable and does NOT touch the async review/banner path.
    exts.push(
      LiveCollab.configure({
        awareness: props.awareness,
        noteId: props.id,
        onActivity: (payload) => emit('activity', payload),
      })
    );

    if (isYjs.value && props.ydoc) {
      exts.push(
        Collaboration.configure({
          document: props.ydoc,
          field: 'content',
        }),
      );
      exts.push(CollaborationSeed);
      if (props.awareness && canEdit(props.role)) {
        try {
          exts.push(
            CollaborationCursor.configure({
              provider: { awareness: props.awareness },
              user: {
                // The cursor extension replaces the whole awareness `user`
                // field with this object: the id must travel along or
                // presence self-exclusion and ghost dedup stop working.
                // Color is derived from the account id (not the name) so the
                // inline caret matches the toolbar avatar.
                id: props.userId || 'anonymous',
                name: props.userName || 'Anonymous',
                color: getColorFromId(props.userId || 'anon'),
              },
            }),
          );
        } catch (e) {
          console.warn('[editor] cursor init skipped:', e?.message);
        }
      }
      exts.push(
        CommentExtension.configure({
          HTMLAttributes: {
            class: 'comment-highlight',
          },
          onCommentActivated: (commentId) => {
            emit('comment-activated', commentId);
          },
        }),
      );
    }

    let _lastContent = null;
    let _lastSanitized = null;
    const safeContent = computed(() => {
      if (isYjs.value) return '';
      if (isEncryptedContent(props.modelValue)) return '';
      if (props.modelValue === _lastContent) return _lastSanitized;
      _lastContent = props.modelValue;
      _lastSanitized = sanitizeNoteContent(props.modelValue);
      return _lastSanitized;
    });

    const hasUserEdited = ref(false);
    let pendingProgrammaticUpdates = 0;

    const editor = useEditor({
      content: isYjs.value ? undefined : safeContent.value,
      editable: canEdit(props.role),
      autofocus: props.cursorPosition,
      extensions: exts,
      // The app ships its own Paste + TextDirection; drop tiptap's core
      // duplicates (they'd otherwise collide by name).
      enableCoreExtensions: { paste: false, textDirection: false },
      editorProps: {
        virtualizeTopLevel: { threshold: 500, overscanPx: 800 },
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
      // Perf recorder attribution: one cheap log entry per transaction, so
      // every recorded stall knows what the editor did just before it. The
      // recorder also keeps the live editor handle for generic sweeps.
      onTransaction: ({ editor: ed, transaction }) => {
        window.__beaverPerf?.tx(transaction, ed);
      },
    });

    // Long-press to move any block (touch devices). Only active when the
    // drag-handle gutter is hidden (iPad, phones, foldables).
    const {
      isDragging: blockDragDragging,
      bindBlockDrag,
    } = useBlockDrag({
      editor,
      enabled: computed(() => isIpad || window.innerWidth < 768),
      onBlockMoved: (fromPos, toPos) => {
        // Block moved — editor emits update via its 'update' observer.
      },
      onDragStart: (pos) => {
        isDragging.value = true;
      },
      onDragEnd: () => {
        isDragging.value = false;
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

        // Note-controlled URL: only web/mailto schemes may reach the opener
        // (SC-4-08); anything else is swallowed.
        if (!isSafeOpenUrl(href)) return true;
        window.open(href, '_blank', 'noopener');
        return true;
      }
    }

    // Yjs owns persistence — content is saved via binary updates
    // (useNoteYjs.js: enqueueUpdate → flushPendingUpdates → appendUpdate),
    // which is incremental and does not block the main thread. We deliberately
    // do NOT call editor.getJSON() on every transaction: that walks the entire
    // ProseMirror tree (O(document), ~200-500ms on large notes) and causes
    // editor lag. The Pinia store and derived data (card preview, search text,
    // link index) are synced once on route leave / pagehide via
    // persistCurrentNote + flushDerivedUpdates.
    onMounted(() => {
      if (!editor.value) return;
      emit('init', editor.value);

      if (!isYjs.value && safeContent.value) {
        editor.value.commands.setContent(safeContent.value);
      }

      if (props.cursorPosition) {
        const { state, view } = editor.value;
        const pos = Math.min(props.cursorPosition, state.doc.content.size);
        const tr = state.tr.setSelection(
          state.selection.constructor.near(state.doc.resolve(pos)),
        );
        view.dispatch(tr);
      }

      editor.value.on('update', () => {
        if (isYjs.value) return;
        if (pendingProgrammaticUpdates > 0) {
          pendingProgrammaticUpdates--;
          return;
        }
        hasUserEdited.value = true;
      });
    });

    if (!isYjs.value) {
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
      },
    );

    watch(
      () => props.role,
      (role) => {
        if (editor.value && !editor.value.isDestroyed) {
          editor.value.setEditable(canEdit(role), false);
        }
      },
    );

    return {
      translations,
      editor,
      computePositionConfig,
      showDragHandle,
      isDragging,
      currentNodePos,
      isIpad,
      onElementDragStart,
      onElementDragEnd,
      onNodeChange,
      addBlock,
    };
  },
};
</script>

<style src="@/assets/css/editor.css"></style>

<style>
.comment-highlight {
  background: rgba(254, 240, 138, 0.42);
  border-bottom: 1.5px solid hsl(var(--twc-primary));
  padding: 0 1px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  cursor: pointer;
  position: relative;
  transition:
    background 140ms var(--ease-standard),
    outline-color 140ms var(--ease-standard);
}
.comment-highlight:hover {
  background: rgba(254, 240, 138, 0.62);
  outline-offset: 2px;
}

.comment-highlight.is-active,
.comment-highlight[data-active='true'] {
  background: rgba(254, 249, 195, 0.95);
  border-bottom-color: #eab308;
  outline: 2px solid hsl(var(--twc-primary) / 0.6);
  outline-offset: 2px;
}
:root.dark .comment-highlight {
  background: rgba(202, 138, 4, 0.22);
  border-bottom-color: rgba(250, 204, 21, 0.55);
}
:root.dark .comment-highlight:hover {
  background: rgba(202, 138, 4, 0.32);
  outline-color: hsl(var(--twc-primary) / 0.35);
}
:root.dark .comment-highlight.is-active,
:root.dark .comment-highlight[data-active='true'] {
  outline-color: hsl(var(--twc-primary) / 0.6);
}

/* Version preview marks: added tint, dashed attr outline, removed ghosts. */
.version-preview-added {
  background: rgba(34, 197, 94, 0.18);
  border-radius: 3px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
/* Whole added block (list, paragraph, …) as a soft green pill. */
.version-preview-added-block {
  position: relative;
  background: rgba(34, 197, 94, 0.14);
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.3);
}
/* Format/attribute-only delta: dashed inline marker. */
.version-preview-attr {
  outline: 1.5px dashed rgba(168, 162, 158, 0.7);
  outline-offset: 1px;
  border-radius: 3px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
/* Ghost preview of deleted structured content (image, block, …). */
.version-preview-ghost {
  display: block;
  margin: 4px 0;
  padding: 4px 8px;
  border: 1.5px dashed rgba(239, 68, 68, 0.5);
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.06);
  opacity: 0.75;
  max-width: 100%;
  overflow: hidden;
  cursor: progress;
  transition: opacity var(--motion-base) var(--ease-standard);
}
.version-preview-ghost > * {
  pointer-events: none;
  max-width: 100%;
}
.version-preview-removed {
  background: rgba(239, 68, 68, 0.14);
  color: #b91c1c;
  text-decoration: line-through;
  border-radius: 3px;
  padding: 0 2px;
}
:root.dark .version-preview-attr {
  outline-color: rgba(120, 113, 108, 0.9);
}
:root.dark .version-preview-ghost {
  border-color: rgba(248, 113, 113, 0.55);
  background: rgba(248, 113, 113, 0.08);
}
:root.dark .version-preview-added-block {
  background: rgba(34, 197, 94, 0.18);
  box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.35);
}
:root.dark .version-preview-removed {
  color: #fca5a5;
}
/* Removed-block ghost carries its own "Removed" chip above the slice. */
.version-preview-ghost__label {
  display: block;
  width: fit-content;
  margin: 0 0 4px;
  padding: 0 6px;
  border-radius: 3px;
  background: rgba(239, 68, 68, 0.14);
  color: #b91c1c;
  font-size: 0.6rem;
  font-weight: 600;
  line-height: 1.6;
  pointer-events: none;
}
:root.dark .version-preview-ghost__label {
  background: rgba(248, 113, 113, 0.14);
  color: #fca5a5;
}

/* Added file cards (node views) use opaque neutral backgrounds that would
   hide the added pill entirely; cut through so the tint shows. */
.version-preview-added-block div[class*='bg-neutral'] {
  background-color: transparent !important;
}
/* Ghosted removed file blocks serialize to a bare span with the file's data
   attributes; give it the same dashed red ghost shape as other structured
   deleted content, named by its data-file-name. */
.version-preview-ghost span[data-src] {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  max-width: 100%;
  margin: 4px 0;
  padding: 8px 12px;
  border: 1px dashed rgba(239, 68, 68, 0.5);
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.08);
  color: #b91c1c;
  font-size: 0.85rem;
  font-weight: 500;
}
.version-preview-ghost span[data-src]::before {
  content: '📄';
}
.version-preview-ghost span[data-src]::after {
  content: attr(data-file-name);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root.dark .version-preview-ghost span[data-src] {
  border-color: rgba(248, 113, 113, 0.55);
  background: rgba(248, 113, 113, 0.1);
  color: #fca5a5;
}

/* Live collaboration attribution: translucent author tint + inline chip. */
.live-collab-added {
  background-color: color-mix(
    in srgb,
    var(--live-collab-color, #9ca3af) 20%,
    transparent
  );
  border-radius: 3px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  animation: live-collab-fade 4s ease forwards;
}
.live-collab-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0 4px;
  padding: 0 6px;
  vertical-align: baseline;
  border-radius: 9999px;
  border: 1px solid
    color-mix(in srgb, var(--live-collab-color, #9ca3af) 55%, transparent);
  background: color-mix(
    in srgb,
    var(--live-collab-color, #9ca3af) 14%,
    transparent
  );
  color: color-mix(
    in srgb,
    var(--live-collab-color, #6b7280) 65%,
    rgb(55 65 81)
  );
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.6;
  white-space: nowrap;
  user-select: none;
  cursor: default;
  animation: live-collab-fade 4s ease forwards;
}
.live-collab-chip__undo {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  font: inherit;
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
}
.live-collab-chip__undo:hover {
  text-decoration: none;
}
@keyframes live-collab-fade {
  0%,
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .live-collab-added,
  .live-collab-chip {
    animation: none;
  }
}
</style>
