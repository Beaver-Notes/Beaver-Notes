<template>
  <div class="note-editor mb-64">
    <div
      v-if="erroredActivePlugins.length"
      class="mb-3 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800"
    >
      <p class="text-sm text-yellow-800 dark:text-yellow-200">
        {{
          erroredActivePlugins.length === 1
            ? 'A plugin failed to load and was disabled:'
            : `${erroredActivePlugins.length} plugins failed to load and were disabled:`
        }}
      </p>
      <ul
        class="mt-1 text-xs text-yellow-700 dark:text-yellow-300 list-disc list-inside"
      >
        <li v-for="p in erroredActivePlugins" :key="p.id">
          <router-link
            :to="`/settings/plugins/${p.id}`"
            class="underline hover:no-underline"
          >
            {{ p.manifest?.name || p.id }}
          </router-link>
          — {{ p.error }}
        </li>
      </ul>
    </div>
    <div
      v-if="editorError"
      class="mb-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
    >
      <p class="text-sm text-red-700 dark:text-red-300">
        Failed to load editor. A plugin extension may be broken.
      </p>
      <p class="mt-1 text-xs text-red-600 dark:text-red-400 font-mono">
        {{ editorError }}
      </p>
      <div class="mt-2 flex gap-2">
        <ui-button variant="primary" size="sm" @click="reloadEditor">
          Reload Editor
        </ui-button>
        <ui-button variant="default" size="sm" :to="'/settings/plugins'">
          Manage Plugins
        </ui-button>
      </div>
    </div>
    <slot v-bind="{ editor }" />
    <drag-handle
      v-if="editor && showDragHandle"
      :editor="editor"
      :compute-position-config="computePositionConfig"
      class="drag-handle w-auto h-auto flex items-center rounded-lg bg-input shadow-sm p-1"
    >
      <v-remixicon name="riDraggable" class="size-5 cursor-grab" />
    </drag-handle>
    <editor-content
      v-if="editor"
      :editor="editor"
      class="note-editor__content prose prose-stone dark:text-neutral-100 max-w-none print:cursor-none"
    />
    <note-bubble-menu v-if="editor" v-bind="{ editor, note }" />
    <table-floating-menu v-if="editor" :editor="editor" />
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
import { Node } from '@tiptap/core';
import { isEncryptedContent } from '@/utils/crypto/encryption.js';
import { sanitizeNoteContent } from '@/utils/note/contentSecurity.js';
import { useRouter } from 'vue-router';
import {
  extensions,
  CollapseHeading,
  heading,
  dropFile,
  Commands,
} from '@/lib/tiptap';
import { NodeRangeSelection } from '@tiptap/extension-node-range';
import { DragHandle } from '@tiptap/extension-drag-handle-vue-3';
import { useAppStore } from '../../store/app';
import { usePluginStore } from '@/store/plugins';
import { offset } from '@floating-ui/dom';
import NoteBubbleMenu from './NoteBubbleMenu.vue';
import TableFloatingMenu from '@/lib/tiptap/exts/table/TableFloatingMenu.vue';

export default {
  components: { EditorContent, DragHandle, NoteBubbleMenu, TableFloatingMenu },
  props: {
    modelValue: { type: [String, Object], default: '' },
    id: { type: String, default: '' },
    cursorPosition: { type: Number, default: 0 },
    note: { type: Object, default: () => ({}) },
  },
  emits: ['init', 'update', 'update:modelValue'],
  setup(props, { emit }) {
    const router = useRouter();
    const appStore = useAppStore();
    const pluginStore = usePluginStore();

    const isRtl = document.documentElement.getAttribute('dir') === 'rtl';

    const showDragHandle = ref(
      typeof window !== 'undefined' ? window.innerWidth >= 768 : true
    );

    function updateDragHandleVisibility() {
      showDragHandle.value = window.innerWidth >= 768;
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
        middleware: [offset(0), fixedGutterMiddleware],
      };
    });

    const erroredActivePlugins = computed(() =>
      pluginStore.installedPlugins.filter((p) => p.state === 'error')
    );

    const safePluginExtensions = computed(() => {
      const erroredIds = new Set(erroredActivePlugins.value.map((p) => p.id));
      return pluginStore.pluginExtensions.filter(
        (ext) => !erroredIds.has(ext._pluginId)
      );
    });

    const exts = [
      ...extensions,
      dropFile.configure({ id: props.id }),
      NodeRangeSelection,
      ...safePluginExtensions.value,
    ];
    if (typeof window !== 'undefined') {
      exts.push(Commands);
    }
    exts.push(appStore.setting.collapsibleHeading ? CollapseHeading : heading);

    function collectNodeTypes(content) {
      const types = new Set();
      if (!content || typeof content !== 'object') return types;
      if (Array.isArray(content)) {
        for (const item of content) {
          for (const t of collectNodeTypes(item)) types.add(t);
        }
        return types;
      }
      if (content.type) types.add(content.type);
      if (content.content) {
        for (const t of collectNodeTypes(content.content)) types.add(t);
      }
      return types;
    }

    (function addCatchalls() {
      const registered = new Set();
      for (const ext of exts) {
        const name = ext?.name || ext?.options?.name;
        if (name) registered.add(name);
        // Recursively collect from nested extensions
        if (Array.isArray(ext?.extensions)) {
          for (const sub of ext.extensions) {
            if (sub?.name) registered.add(sub.name);
          }
        }
      }

      const raw = isEncryptedContent(props.modelValue)
        ? null
        : props.modelValue;
      if (!raw || typeof raw !== 'object') return;

      const contentTypes = collectNodeTypes(raw);
      for (const t of contentTypes) {
        if (t === 'doc' || t === 'text') continue;
        if (registered.has(t)) continue;

        exts.push(
          Node.create({
            name: t,
            group: 'block',
            atom: true,
            parseHTML() {
              return [{ tag: 'div' }];
            },
            renderHTML() {
              return [
                'div',
                [
                  'div',
                  {
                    class:
                      'p-3 rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-800 my-1',
                  },
                  [
                    'span',
                    {
                      class:
                        'text-xs font-mono text-yellow-700 dark:text-yellow-300',
                    },
                    `Missing extension: ${t}`,
                  ],
                ],
              ];
            },
          })
        );
      }
    })();

    const safeContent = computed(() =>
      isEncryptedContent(props.modelValue)
        ? ''
        : sanitizeNoteContent(props.modelValue)
    );

    const editorError = ref(null);
    const editor = useEditor({
      content: safeContent.value,
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

    function handleClick(view, pos, { target, altKey }) {
      const closestAnchor = target.closest('a');
      if (closestAnchor?.hasAttribute('tiptap-url') && altKey) {
        if (closestAnchor.href.startsWith('note://')) {
          const noteId = closestAnchor.href.slice(7);
          router.push({
            name: 'Note',
            params: { id: noteId },
            query: { linked: true },
          });
        } else {
          window.open(closestAnchor.href, '_blank', 'noopener');
        }
      }
    }

    onMounted(() => {
      if (!editor.value) return;
      emit('init', editor.value);

      if (safeContent.value) {
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
        const data = editor.value.getJSON();
        emit('update', data);
        emit('update:modelValue', data);
      });
    });

    watch(safeContent, (val) => {
      if (!editor.value || !val) return;
      const isEmpty = editor.value.isEmpty;
      if (isEmpty) {
        editor.value.commands.setContent(val);
      }
    });

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
      editorError,
      computePositionConfig,
      showDragHandle,
      erroredActivePlugins,
    };
  },
};
</script>

<style src="@/assets/css/editor.css"></style>
