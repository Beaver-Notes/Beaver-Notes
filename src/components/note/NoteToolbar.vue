<template>
  <teleport to="body">
    <div
      class="fixed inset-x-0 z-20 print:hidden hidden justify-center px-2 transition-opacity duration-300 pointer-events-none mobile:flex"
      :class="
        store.inReaderMode ? 'opacity-0 hover:opacity-100' : 'opacity-100'
      "
      :style="{ bottom: 'var(--app-keyboard-inset-bottom)' }"
    >
      <div
        class="pointer-events-auto relative h-14 max-w-full overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-neutral-900 dark:shadow-2xl"
      >
        <div
          ref="container"
          class="relative h-full overflow-x-auto overflow-y-hidden scrollbar-hide scroll-smooth overscroll-x-contain"
          style="-webkit-overflow-scrolling: touch"
          @wheel.passive="changeWheelDirection"
        >
          <!-- All panels live inside the scroll track so the pill width
             is always driven by the active panel's natural content width -->

          <!-- ── MAIN PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-0.5 px-1.5 whitespace-nowrap h-full',
              panelClass('main'),
            ]"
          >
            <button
              v-keep-focus
              v-tooltip.group="
                translations.toolbar?.insertBlock || 'Insert block'
              "
              :aria-label="translations.toolbar?.insertBlock || 'Insert block'"
              :class="tbBtn()"
              @click="showMobileBlockPicker = true"
            >
              <v-remixicon name="riAddLine" />
            </button>

            <span class="tb-divider" />

            <toolbar-overflow
              section="text"
              :editor="editor"
              :translations="translations"
              :is-item-visible="isItemVisible"
              :is-table-active="isTableActive"
              :tb-btn="tbBtn"
              :open-sub="openSub"
              :font-size="fontSize"
            />

            <span
              v-if="hasTextControls && hasFormattingControls"
              class="tb-divider"
            />

            <toolbar-formatting
              :editor="editor"
              :translations="translations"
              :fmt-map="fmtMap"
              :visible-inline-format-items="visibleInlineFormatItems"
              :is-item-visible="isItemVisible"
              :current-text-color="currentTextColor"
              :current-highlight-hex="currentHighlightHex"
              :tb-btn="tbBtn"
              :open-sub="openSub"
            />

            <span
              v-if="hasFormattingControls && hasBlockControls"
              class="tb-divider"
            />

            <toolbar-overflow
              section="block"
              :editor="editor"
              :translations="translations"
              :is-item-visible="isItemVisible"
              :is-table-active="isTableActive"
              :tb-btn="tbBtn"
              :open-sub="openSub"
            />

            <template v-if="isTableActive">
              <button
                v-for="t in tableActions"
                :key="t.name"
                v-keep-focus
                v-tooltip.group="t.label"
                :aria-label="t.label"
                :class="tbBtn()"
                @click="t.run()"
              >
                <v-remixicon :name="t.icon" />
              </button>
            </template>

            <span
              v-if="hasBlockControls && hasMediaControls"
              class="tb-divider"
            />

            <toolbar-insert
              ref="toolbarInsertRef"
              :editor="editor"
              :translations="translations"
              :is-item-visible="isItemVisible"
              :is-table-active="isTableActive"
              :table-actions="tableActions"
              :draw-actions="drawActions"
              :toggle-recording="toggleRecording"
              :is-mobile="isMobile"
              :tb-btn="tbBtn"
              :open-sub="openSub"
              :link-input-value="linkInputValue"
              :selected-link-index="selectedLinkIndex"
              :link-suggestions="linkSuggestions"
              :link-popover-open="linkPopoverOpen"
              :on-link-popover-show="onLinkPopoverShow"
              :on-link-input-keydown="onLinkInputKeydown"
              :close-link-input="closeLinkInput"
              :save-link-input="saveLinkInput"
              :select-link-note="selectLinkNote"
              :trigger-image-input="triggerImageInput"
              :trigger-file-input="triggerFileInput"
              :trigger-video-input="triggerVideoInput"
              @update:link-input-value="linkInputValue = $event"
              @update:link-popover-open="linkPopoverOpen = $event"
            />
            <span
              v-if="
                (hasMediaControls || isItemVisible('audio')) &&
                isItemVisible('delete')
              "
              class="tb-divider"
            />

            <toolbar-overflow
              section="actions"
              :editor="editor"
              :translations="translations"
              :is-item-visible="isItemVisible"
              :is-table-active="isTableActive"
              :tb-btn="tbBtn"
              :open-sub="openSub"
              :font-size="fontSize"
              :show-customizer="showCustomizer"
              :delete-node="deleteNode"
              :visible-items="visibleItems"
              @update:show-customizer="showCustomizer = $event"
            />

            <span
              v-if="isItemVisible('delete') || visibleItems.length"
              class="tb-divider"
            />
          </div>

          <!-- ── HEADINGS SUB-PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-0.5 px-2 whitespace-nowrap h-full',
              panelClass('headings'),
            ]"
            @pointerdown="onSwipeStart"
            @pointerup="onSwipeEnd"
            @touchstart.passive="onSwipeStart"
            @touchend="onSwipeEnd"
          >
            <button
              v-keep-focus
              class="tb-back"
              aria-label="Back"
              @click="closeSub()"
            >
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.headings }}</span>
            <button
              v-keep-focus
              :class="tbChip(editor.isActive('paragraph'))"
              aria-label="Body"
              @click="
                editor.chain().focus().setParagraph().run();
                closeSub();
              "
            >
              Body
            </button>
            <button
              v-for="h in [1, 2, 3, 4]"
              :key="h"
              v-keep-focus
              :class="tbChip(editor.isActive('heading', { level: h }))"
              :aria-label="'Heading ' + h"
              @click="
                editor.chain().focus().toggleHeading({ level: h }).run();
                closeSub();
              "
            >
              H{{ h }}
            </button>
          </div>

          <!-- ── FONT SIZE SUB-PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-0.5 px-2 whitespace-nowrap h-full',
              panelClass('fontSize'),
            ]"
            @pointerdown="onSwipeStart"
            @pointerup="onSwipeEnd"
            @touchstart.passive="onSwipeStart"
            @touchend="onSwipeEnd"
          >
            <button
              v-keep-focus
              class="tb-back"
              aria-label="Back"
              @click="closeSub()"
            >
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.fontSize }}</span>
            <div
              class="flex items-center gap-0.5 border border-black/10 dark:border-white/10 rounded-xl px-1 h-[38px] shrink-0"
            >
              <button
                v-keep-focus
                class="w-7 h-7 flex items-center justify-center rounded-lg text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10 hover:text-neutral-800 dark:hover:text-white transition-colors"
                aria-label="Decrease font size"
                @click="
                  fontSize = Math.max(1, fontSize - 1);
                  updateFontSize();
                "
              >
                <v-remixicon name="riSubtractLine" class="w-3.5 h-3.5" />
              </button>
              <input
                v-model.number="fontSize"
                type="number"
                min="1"
                class="w-8 border-0 bg-transparent text-center text-sm font-medium text-neutral-800 outline-none dark:text-white no-spinner"
                @change="updateFontSize"
              />
              <button
                v-keep-focus
                class="w-7 h-7 flex items-center justify-center rounded-lg text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10 hover:text-neutral-800 dark:hover:text-white transition-colors"
                aria-label="Increase font size"
                @click="
                  fontSize += 1;
                  updateFontSize();
                "
              >
                <v-remixicon name="riAddLine" class="w-3.5 h-3.5" />
              </button>
            </div>
            <span class="tb-divider" />
            <button
              v-for="size in [10, 12, 14, 16, 18, 20, 24, 28, 32, 36]"
              :key="size"
              v-keep-focus
              :class="tbChip()"
              :aria-label="'Font size ' + size + 'pt'"
              @click="
                editor
                  .chain()
                  .focus()
                  .setFontSize(size + 'pt')
                  .run();
                fontSize = size;
                closeSub();
              "
            >
              {{ size }}
            </button>
            <button
              v-keep-focus
              :class="[tbChip(), 'opacity-60 !text-xs']"
              aria-label="Default font size"
              @click="
                editor.chain().focus().unsetFontSize().run();
                fontSize = null;
                closeSub();
              "
            >
              Default
            </button>
          </div>

          <!-- ── COLOR SUB-PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-1.5 px-2 whitespace-nowrap h-full',
              panelClass('color'),
            ]"
            @pointerdown="onSwipeStart"
            @pointerup="onSwipeEnd"
            @touchstart.passive="onSwipeStart"
            @touchend="onSwipeEnd"
          >
            <button
              v-keep-focus
              class="tb-back"
              aria-label="Back"
              @click="closeSub()"
            >
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.textColor }}</span>
            <button
              v-keep-focus
              class="w-7 h-7 shrink-0 rounded-lg border border-black/10 dark:border-white/10 flex items-center justify-center text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors bg-transparent"
              aria-label="Remove text color"
              @click="
                editor.chain().focus().unsetColor().run();
                closeSub();
              "
            >
              <v-remixicon name="riFontColor" class="w-3.5 h-3.5" />
            </button>
            <button
              v-for="c in textColors"
              :key="'tc-' + c"
              v-keep-focus
              class="h-6 w-6 shrink-0 rounded-full border border-black/10 dark:border-white/10 flex items-center justify-center hover:scale-110 active:scale-95 transition-transform"
              :style="{ background: c + '33' }"
              :aria-label="'Text color ' + c"
              @click="
                setTextColor(c);
                closeSub();
              "
            >
              <v-remixicon
                name="riFontColor"
                class="w-3 h-3"
                :style="{ color: c }"
              />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{
              translations.menu.highlighterColor
            }}</span>
            <button
              v-keep-focus
              class="w-7 h-7 shrink-0 rounded-lg border border-black/10 dark:border-white/10 flex items-center justify-center text-[12px] text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors bg-transparent"
              aria-label="Remove highlight"
              @click="
                editor.commands.unsetHighlight();
                closeSub();
              "
            >
              ∅
            </button>
            <button
              v-for="(c, i) in highlighterColors"
              :key="'hl-' + c"
              v-keep-focus
              :class="[
                'h-6 w-6 shrink-0 rounded-full border border-black/10 dark:border-white/10 hover:scale-110 active:scale-95 transition-transform',
                c,
              ]"
              :aria-label="'Highlight color ' + (i + 1)"
              @click="
                setHighlightColor(c);
                closeSub();
              "
            />
          </div>

          <!-- ── LISTS SUB-PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-0.5 px-2 whitespace-nowrap h-full',
              panelClass('lists'),
            ]"
            @pointerdown="onSwipeStart"
            @pointerup="onSwipeEnd"
            @touchstart.passive="onSwipeStart"
            @touchend="onSwipeEnd"
          >
            <button
              v-keep-focus
              class="tb-back"
              aria-label="Back"
              @click="closeSub()"
            >
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.lists }}</span>
            <button
              v-for="l in lists"
              :key="l.name"
              v-keep-focus
              :class="[tbChip(editor.isActive(l.state)), 'gap-1.5']"
              @click="
                l.run();
                closeSub();
              "
            >
              <v-remixicon :name="l.icon" class="w-4 h-4" />{{ l.title }}
            </button>
          </div>

          <!-- ── IMAGE SUB-PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-1.5 px-2 whitespace-nowrap h-full',
              panelClass('image'),
            ]"
            @pointerdown="onSwipeStart"
            @pointerup="onSwipeEnd"
            @touchstart.passive="onSwipeStart"
            @touchend="onSwipeEnd"
          >
            <button
              v-keep-focus
              class="tb-back"
              aria-label="Back"
              @click="closeSub()"
            >
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.image }}</span>
            <button
              v-keep-focus
              :class="tbBtn()"
              aria-label="Upload image"
              @click="
                triggerImageInput();
                closeSub();
              "
            >
              <v-remixicon name="riFolderOpenLine" />
            </button>
          </div>

          <!-- ── FILE SUB-PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-1.5 px-2 whitespace-nowrap h-full',
              panelClass('file'),
            ]"
            @pointerdown="onSwipeStart"
            @pointerup="onSwipeEnd"
            @touchstart.passive="onSwipeStart"
            @touchend="onSwipeEnd"
          >
            <button
              v-keep-focus
              class="tb-back"
              aria-label="Back"
              @click="closeSub()"
            >
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.file }}</span>
            <button
              v-keep-focus
              :class="tbBtn()"
              aria-label="Upload file"
              @click="
                triggerFileInput();
                closeSub();
              "
            >
              <v-remixicon name="riFolderOpenLine" />
            </button>
          </div>

          <!-- ── VIDEO SUB-PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-1.5 px-2 whitespace-nowrap h-full',
              panelClass('video'),
            ]"
            @pointerdown="onSwipeStart"
            @pointerup="onSwipeEnd"
            @touchstart.passive="onSwipeStart"
            @touchend="onSwipeEnd"
          >
            <button
              v-keep-focus
              class="tb-back"
              aria-label="Back"
              @click="closeSub()"
            >
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.video }}</span>
            <button
              v-keep-focus
              :class="tbBtn()"
              aria-label="Upload video"
              @click="
                triggerVideoInput();
                closeSub();
              "
            >
              <v-remixicon name="riFolderOpenLine" />
            </button>
          </div>

          <!-- ── AUDIO SUB-PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-0.5 px-2 whitespace-nowrap h-full',
              panelClass('audio'),
            ]"
            @pointerdown="onSwipeStart"
            @pointerup="onSwipeEnd"
            @touchstart.passive="onSwipeStart"
            @touchend="onSwipeEnd"
          >
            <button
              v-keep-focus
              class="tb-back"
              aria-label="Back"
              @click="closeSub()"
            >
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.record }}</span>
            <button
              v-keep-focus
              :class="[tbChip(), 'gap-1.5']"
              @click="
                toggleRecording();
                closeSub();
              "
            >
              <v-remixicon name="riMicLine" class="w-4 h-4" />{{
                translations.menu.record
              }}
            </button>
            <button
              v-keep-focus
              :class="[tbChip(), 'gap-1.5']"
              @click="
                triggerAudioInput();
                closeSub();
              "
            >
              <v-remixicon name="riFile2Line" class="w-4 h-4" />{{
                translations.menu.upload
              }}
            </button>
          </div>

          <!-- ── PARAGRAPH / ALIGN SUB-PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-0.5 px-2 whitespace-nowrap h-full',
              panelClass('paragraph'),
            ]"
            @pointerdown="onSwipeStart"
            @pointerup="onSwipeEnd"
            @touchstart.passive="onSwipeStart"
            @touchend="onSwipeEnd"
          >
            <button
              v-keep-focus
              class="tb-back"
              aria-label="Back"
              @click="closeSub()"
            >
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">Align</span>
            <button
              v-keep-focus
              :class="tbBtn()"
              aria-label="Align left"
              @click="
                editor.chain().focus().setTextAlign('left').run();
                closeSub();
              "
            >
              <v-remixicon name="riAlignLeft" />
            </button>
            <button
              v-keep-focus
              :class="tbBtn()"
              aria-label="Align center"
              @click="
                editor.chain().focus().setTextAlign('center').run();
                closeSub();
              "
            >
              <v-remixicon name="riAlignCenter" />
            </button>
            <button
              v-keep-focus
              :class="tbBtn()"
              aria-label="Align right"
              @click="
                editor.chain().focus().setTextAlign('right').run();
                closeSub();
              "
            >
              <v-remixicon name="riAlignRight" />
            </button>
            <button
              v-keep-focus
              :class="tbBtn()"
              aria-label="Align justify"
              @click="
                editor.chain().focus().setTextAlign('justify').run();
                closeSub();
              "
            >
              <v-remixicon name="riAlignJustify" />
            </button>
          </div>
        </div>
        <!-- /scroll track -->

        <!-- Left fade edge — hidden when fully scrolled left -->
        <div
          class="pointer-events-none absolute left-0 inset-y-0 w-8 bg-gradient-to-r from-white dark:from-neutral-900 to-transparent rounded-2xl transition-opacity duration-150"
          :class="scrolledLeft ? 'opacity-0' : 'opacity-100'"
        />
        <!-- Right fade edge — hidden when fully scrolled right -->
        <div
          class="pointer-events-none absolute right-0 inset-y-0 w-8 bg-gradient-to-l from-white dark:from-neutral-900 to-transparent rounded-2xl transition-opacity duration-150"
          :class="scrolledRight ? 'opacity-0' : 'opacity-100'"
        />
      </div>

      <toolbar-customizer
        v-model="showCustomizer"
        @close="showCustomizer = false"
      />

      <mobile-block-picker
        :id="id"
        v-model="showMobileBlockPicker"
        :editor="editor"
      />
    </div>
  </teleport>
</template>

<script>
import {
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  nextTick,
  shallowRef,
} from 'vue';
import ToolbarCustomizer from './ToolbarCustomizer.vue';
import MobileBlockPicker from './MobileBlockPicker.vue';
import ToolbarFormatting from './toolbar/ToolbarFormatting.vue';
import ToolbarInsert from './toolbar/ToolbarInsert.vue';
import ToolbarOverflow from './toolbar/ToolbarOverflow.vue';
import { useNoteMenu } from '@/composable/useNoteMenu';
import { openDialog } from '@/lib/native/dialog';
import { backend } from '@/lib/tauri-bridge';
import { useRoute } from 'vue-router';
import { useNoteStore } from '@/store/note';
import copyImage from '@/utils/assets/storage.js';
import { saveFile } from '@/utils/assets/storage.js';

export default {
  components: {
    ToolbarCustomizer,
    MobileBlockPicker,
    ToolbarFormatting,
    ToolbarInsert,
    ToolbarOverflow,
  },
  props: {
    editor: { type: Object, default: () => ({}) },
    id: { type: String, default: '' },
    note: { type: Object, required: true },
    showSearch: { type: Boolean, default: false },
  },

  setup(props) {
    const route = useRoute();
    const shared = useNoteMenu(props);
    const { container } = shared;

    const showMobileBlockPicker = ref(false);
    const isMobile = backend.isMobileRuntime();
    const toolbarInsertRef = ref(null);

    // ── Link input state ────────────────────────────────────────────
    const linkInputValue = ref('');
    const selectedLinkIndex = ref(0);
    const linkPopoverOpen = ref(false);
    const noteStore = useNoteStore();

    // Only recompute the candidate pool when the notes list itself changes,
    // not on every keystroke — filtering below is the cheap part.
    const linkCandidates = computed(() => {
      const notes = noteStore.notes;
      const currentId = route.params.id;
      const pool = notes.length > 200 ? notes.slice(0, 200) : notes;
      return currentId ? pool.filter((n) => n.id !== currentId) : pool;
    });

    const linkSuggestions = computed(() => {
      const raw = linkInputValue.value;
      if (raw.charCodeAt(0) !== 64 /* '@' */) return [];
      const query = raw.slice(1).trim().toLowerCase();
      if (!query) return [];
      const out = [];
      const pool = linkCandidates.value;
      for (let i = 0; i < pool.length && out.length < 6; i++) {
        const n = pool[i];
        if (
          n.title.toLowerCase().includes(query) ||
          n.id.toLowerCase().includes(query)
        ) {
          out.push(n);
        }
      }
      return out;
    });

    function resolveNoteFromQuery(value) {
      const query = value.slice(1).trim();
      if (!query) return null;
      const lower = query.toLowerCase();
      const notes = noteStore.notes;
      for (let i = 0; i < notes.length; i++) {
        if (notes[i].title.toLowerCase() === lower) return notes[i];
      }
      return notes.find((n) => n.id === query) || null;
    }

    function saveLinkInput() {
      const value = linkInputValue.value.trim();
      if (!value || !props.editor) return;

      const chain = props.editor.chain().focus();

      if (value.charCodeAt(0) === 64) {
        const note = resolveNoteFromQuery(value);
        if (note) chain.insertLinkNote(note.id).run();
      } else {
        chain.setLink({ href: value }).run();
      }

      linkInputValue.value = '';
      linkPopoverOpen.value = false;
    }

    function closeLinkInput() {
      linkInputValue.value = '';
      linkPopoverOpen.value = false;
      props.editor?.commands?.focus();
    }

    function selectLinkNote(id) {
      if (!props.editor) return;
      props.editor.chain().focus().insertLinkNote(id).run();
      linkInputValue.value = '';
      linkPopoverOpen.value = false;
    }

    function onLinkPopoverShow() {
      linkInputValue.value = '';
      selectedLinkIndex.value = 0;
      nextTick(() => toolbarInsertRef.value?.linkInputRef?.focus());
    }

    function onLinkInputKeydown(event) {
      if (linkInputValue.value.charCodeAt(0) !== 64) return;
      const suggestions = linkSuggestions.value;
      const len = suggestions.length;
      if (len === 0) return;

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedLinkIndex.value = (selectedLinkIndex.value + len - 1) % len;
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedLinkIndex.value = (selectedLinkIndex.value + 1) % len;
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const note = suggestions[selectedLinkIndex.value];
        if (note) selectLinkNote(note.id);
      }
    }

    watch(linkInputValue, (val) => {
      if (val.charCodeAt(0) === 64) selectedLinkIndex.value = 0;
    });

    function getCursorPos() {
      return props.editor?.state?.selection?.from ?? 0;
    }

    function insertAtPos(pos, nodeType, attrs) {
      const editor = props.editor;
      editor.commands.setTextSelection(pos);
      editor.commands.focus();
      const node = editor.state.schema.nodes[nodeType]?.create(attrs);
      if (!node) return;
      const tr = editor.state.tr.replaceSelectionWith(node);
      if (tr) editor.view.dispatch(tr);
    }

    async function triggerFileInput() {
      try {
        const pos = getCursorPos();
        const { canceled, filePaths } = await openDialog({
          properties: ['openFile', 'multiSelections'],
        });
        if (canceled || filePaths.length === 0) return;
        for (const filePath of filePaths) {
          const { fileName, relativePath } = await saveFile(filePath, props.id);
          insertAtPos(pos, 'fileEmbed', { src: relativePath, fileName });
        }
      } catch (error) {
        console.error('triggerFileInput failed:', error);
      }
    }

    async function triggerAudioInput() {
      try {
        const pos = getCursorPos();
        const { canceled, filePaths } = await openDialog({
          properties: ['openFile', 'multiSelections'],
          filters: isMobile
            ? [{ name: 'Audio', extensions: ['audio/*'] }]
            : [
                {
                  name: 'Audio',
                  extensions: [
                    'mp3',
                    'wav',
                    'ogg',
                    'm4a',
                    'flac',
                    'aac',
                    'wma',
                  ],
                },
              ],
        });
        if (canceled || filePaths.length === 0) return;
        for (const filePath of filePaths) {
          const { fileName, relativePath } = await saveFile(filePath, props.id);
          insertAtPos(pos, 'Audio', { src: relativePath, fileName });
        }
      } catch (error) {
        console.error('triggerAudioInput failed:', error);
      }
    }

    async function triggerVideoInput() {
      try {
        const pos = getCursorPos();
        const { canceled, filePaths } = await openDialog({
          properties: ['openFile', 'multiSelections'],
          filters: isMobile
            ? [{ name: 'Video', extensions: ['video/*'] }]
            : [
                {
                  name: 'Video',
                  extensions: ['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv'],
                },
              ],
        });
        if (canceled || filePaths.length === 0) return;
        for (const filePath of filePaths) {
          const { relativePath } = await saveFile(filePath, props.id);
          insertAtPos(pos, 'Video', { src: relativePath });
        }
      } catch (error) {
        console.error('triggerVideoInput failed:', error);
      }
    }

    async function triggerImageInput() {
      try {
        const { canceled, filePaths } = await openDialog({
          properties: ['openFile'],
          filters: isMobile
            ? [{ name: 'Images', extensions: ['image/*'] }]
            : [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
        });
        if (canceled || filePaths.length === 0) return;
        const { fileName } = await copyImage(filePaths[0], route.params.id);
        props.editor
          .chain()
          .focus()
          .setImage({ src: `assets://${route.params.id}/${fileName}` })
          .run();
      } catch (error) {
        console.error('triggerImageInput failed:', error);
      }
    }

    // ── Sub-panel morph ───────────────────────────────────────────
    const activePanel = ref('main');
    const prevPanel = shallowRef(null);
    let exitTimer = null;

    function openSub(name) {
      if (activePanel.value === name) return;
      prevPanel.value = activePanel.value;
      activePanel.value = name;
      nextTick(() => {
        if (container.value) container.value.scrollLeft = 0;
      });
    }

    function closeSub() {
      prevPanel.value = activePanel.value;
      activePanel.value = 'main';
      clearTimeout(exitTimer);
      exitTimer = setTimeout(() => {
        prevPanel.value = null;
      }, 220);
      nextTick(() => {
        if (container.value) container.value.scrollLeft = 0;
      });
    }

    function panelClass(name) {
      if (activePanel.value === name) return 'panel-active';
      if (prevPanel.value === name) return 'panel-exit';
      return 'panel-hidden';
    }

    // ── Swipe-to-dismiss (edge swipe only) ─────────────────────────
    let swipeX = 0;
    let swipeY = 0;
    let swipeEdge = false;

    function onSwipeStart(e) {
      const t = e.touches ? e.touches[0] : e;
      if (!t) return;
      swipeX = t.clientX;
      swipeY = t.clientY;
      const target = e.currentTarget;
      swipeEdge = target?.getBoundingClientRect
        ? swipeX - target.getBoundingClientRect().left < 32
        : true;
    }

    function onSwipeEnd(e) {
      if (activePanel.value === 'main' || !swipeEdge) return;
      const t = (e.changedTouches && e.changedTouches[0]) || e;
      if (!t) return;
      const dx = t.clientX - swipeX;
      const dy = t.clientY - swipeY;
      if (container.value) container.value.scrollLeft = 0;
      if (dx > 64 && Math.abs(dx) > Math.abs(dy) * 1.6) closeSub();
      swipeEdge = false;
    }

    // ── Scroll-edge fade indicators ────────────────────────────────
    // rAF-throttled + ResizeObserver-driven so we never recompute more
    // than once per frame, and we catch width changes (sub-panel swaps,
    // overflow items appearing) without manually calling this everywhere.
    const scrolledLeft = ref(true);
    const scrolledRight = ref(false);

    let rafId = null;
    function updateScrollEdges() {
      const el = container.value;
      if (!el) return;
      const left = el.scrollLeft <= 2;
      const right = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      // avoid triggering reactivity/render when nothing actually changed
      if (scrolledLeft.value !== left) scrolledLeft.value = left;
      if (scrolledRight.value !== right) scrolledRight.value = right;
    }

    function scheduleUpdateScrollEdges() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateScrollEdges();
      });
    }

    let resizeObserver = null;

    onMounted(() => {
      nextTick(() => {
        const el = container.value;
        if (!el) return;
        el.addEventListener('scroll', scheduleUpdateScrollEdges, {
          passive: true,
        });
        resizeObserver = new ResizeObserver(scheduleUpdateScrollEdges);
        resizeObserver.observe(el);
        updateScrollEdges();
      });
    });

    onUnmounted(() => {
      container.value?.removeEventListener('scroll', scheduleUpdateScrollEdges);
      resizeObserver?.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
      clearTimeout(exitTimer);
    });

    // ── Class helpers (static parts hoisted out of the function body) ──
    const TB_BTN_BASE =
      'shrink-0 w-11 h-11 rounded-xl border-0 bg-transparent cursor-pointer ' +
      'flex items-center justify-center ' +
      'text-neutral-500 dark:text-neutral-400 ' +
      'hover:bg-black/[0.06] dark:hover:bg-white/[0.08] ' +
      'hover:text-neutral-800 dark:hover:text-white ' +
      'active:scale-[0.88] active:bg-black/[0.08] dark:active:bg-white/[0.10] ' +
      'transition-[transform,background-color] duration-150 select-none touch-manipulation';

    const TB_CHIP_BASE =
      'shrink-0 h-[38px] px-3 rounded-xl border-0 bg-transparent cursor-pointer ' +
      'text-[13px] font-medium flex items-center ' +
      'text-neutral-500 dark:text-neutral-400 ' +
      'hover:bg-black/[0.06] dark:hover:bg-white/[0.08] ' +
      'hover:text-neutral-800 dark:hover:text-white ' +
      'active:scale-[0.93] active:bg-black/[0.08] ' +
      'transition-[transform,background-color] duration-150 select-none touch-manipulation';

    function tbBtn(active = false) {
      return active ? TB_BTN_BASE + ' is-active' : TB_BTN_BASE;
    }

    function tbChip(active = false) {
      return active ? TB_CHIP_BASE + ' is-active' : TB_CHIP_BASE;
    }

    return {
      ...shared,
      activePanel,
      openSub,
      closeSub,
      panelClass,
      tbBtn,
      tbChip,
      scrolledLeft,
      scrolledRight,
      onSwipeStart,
      onSwipeEnd,
      triggerFileInput,
      triggerAudioInput,
      triggerVideoInput,
      triggerImageInput,
      showMobileBlockPicker,
      isMobile,
      // Link input
      linkInputValue,
      toolbarInsertRef,
      selectedLinkIndex,
      linkSuggestions,
      linkPopoverOpen,
      onLinkPopoverShow,
      onLinkInputKeydown,
      closeLinkInput,
      saveLinkInput,
      selectLinkNote,
    };
  },
};
</script>

<style scoped>
/* ── Hide scrollbar on all browsers while keeping scroll functionality ── */
.scrollbar-hide {
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge */
}
.scrollbar-hide::-webkit-scrollbar {
  display: none; /* Chrome/Safari/WebKit */
}

/* ── Panel morph animation states ─────────────────────────────────────── */
.tb-panel {
  max-width: min(calc(100vw - 2rem), 42rem);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  transition:
    opacity 200ms var(--ease-standard),
    transform 200ms var(--ease-standard);
  will-change: opacity, transform;
  -webkit-overflow-scrolling: touch;
}

.tb-panel::-webkit-scrollbar {
  display: none;
}

/* Hidden: shifted right, invisible, out of flow */
.panel-hidden {
  @apply absolute inset-0 opacity-0 pointer-events-none;
  transform: translateX(16px);
}

/* Exiting: shifts left and fades out */
.panel-exit {
  @apply absolute inset-0 opacity-0 pointer-events-none;
  transform: translateX(-16px);
  transition:
    opacity 160ms var(--ease-standard),
    transform 160ms var(--ease-standard);
}

/* Active: in normal flow so its width drives the pill size */
.panel-active {
  @apply relative opacity-100 pointer-events-auto;
  transform: translateX(0);
}

/* ── Active state color (uses app's --color-primary / --color-secondary) ── */
.is-active {
  @apply text-primary dark:text-secondary bg-primary/10 dark:bg-secondary/10;
}

/* ── Back button ────────────────────────────────────────────────────────── */
.tb-back {
  @apply shrink-0 h-11 w-9 rounded-xl border-0 bg-transparent cursor-pointer
         flex items-center justify-center
         text-neutral-500 dark:text-neutral-400
         hover:bg-black/5 dark:hover:bg-white/10
         hover:text-neutral-800 dark:hover:text-white
         active:scale-90
         transition-[transform,background-color] duration-150 select-none touch-manipulation;
}

/* ── Divider ────────────────────────────────────────────────────────────── */
.tb-divider {
  @apply inline-block w-px h-5 rounded-sm shrink-0 mx-1
         bg-black/10 dark:bg-white/[0.12];
}

/* ── Sub-panel section label ────────────────────────────────────────────── */
.sub-label {
  @apply px-1 shrink-0 select-none text-[10px] font-semibold uppercase tracking-wider
         text-neutral-400 dark:text-neutral-500;
}

/* ── URL text input ─────────────────────────────────────────────────────── */
.tb-input {
  @apply h-10 min-w-[10rem] max-w-[14rem] px-3
         rounded-xl border border-black/10 dark:border-white/10
         bg-transparent text-sm outline-none
         text-neutral-800 dark:text-white
         placeholder:text-neutral-400 dark:placeholder:text-neutral-500
         focus:border-primary dark:focus:border-secondary
         transition-colors duration-150;
}

/* ── Remove number input spinners ────────────────────────────────────────── */
.no-spinner::-webkit-inner-spin-button,
.no-spinner::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.no-spinner {
  -moz-appearance: textfield;
}
</style>
