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
              :is-recording="isRecording"
              :formatted-time="formattedTime"
              :is-paused="isPaused"
              :toggle-recording="toggleRecording"
              :pause-resume="pauseResume"
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
          >
            <button class="tb-back" aria-label="Back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.headings }}</span>
            <button
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
          >
            <button class="tb-back" aria-label="Back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.fontSize }}</span>
            <div
              class="flex items-center gap-0.5 border border-black/10 dark:border-white/10 rounded-xl px-1 h-[38px] shrink-0"
            >
              <button
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
          >
            <button class="tb-back" aria-label="Back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.textColor }}</span>
            <button
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
          >
            <button class="tb-back" aria-label="Back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.lists }}</span>
            <button
              v-for="l in lists"
              :key="l.name"
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
          >
            <button class="tb-back" aria-label="Back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.image }}</span>
            <button
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
          >
            <button class="tb-back" aria-label="Back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.file }}</span>
            <button
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
          >
            <button class="tb-back" aria-label="Back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.video }}</span>
            <button
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
          >
            <button class="tb-back" aria-label="Back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.record }}</span>
            <button
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
          >
            <button class="tb-back" aria-label="Back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">Align</span>
            <button
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
          class="pointer-events-none absolute left-0 inset-y-0 w-8 bg-gradient-to-r from-white dark:from-neutral-800 to-transparent rounded-l-[18px] transition-opacity duration-150"
          :class="scrolledLeft ? 'opacity-0' : 'opacity-100'"
        />
        <!-- Right fade edge — hidden when fully scrolled right -->
        <div
          class="pointer-events-none absolute right-0 inset-y-0 w-8 bg-gradient-to-l from-white dark:from-neutral-800 to-transparent rounded-r-[18px] transition-opacity duration-150"
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
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
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
  components: { ToolbarCustomizer, MobileBlockPicker, ToolbarFormatting, ToolbarInsert, ToolbarOverflow },
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

    const linkSuggestions = computed(() => {
      if (!linkInputValue.value.startsWith('@')) return [];
      const query = linkInputValue.value.substring(1).toLowerCase();
      if (!query) return [];
      const candidates = noteStore.notes.length > 200
        ? noteStore.notes.slice(0, 200)
        : noteStore.notes;
      return candidates
        .filter(
          (n) =>
            n.id !== route.params.id &&
            (n.title.toLowerCase().includes(query) ||
              n.id.toLowerCase().includes(query))
        )
        .slice(0, 6);
    });

    function resolveNoteFromQuery(value) {
      const query = value.substring(1).trim();
      if (!query) return null;
      return (
        noteStore.notes.find(
          (n) => n.title.toLowerCase() === query.toLowerCase()
        ) || noteStore.notes.find((n) => n.id === query)
      );
    }

    function saveLinkInput() {
      const value = linkInputValue.value.trim();
      if (!value || !props.editor) return;

      const chain = props.editor.chain().focus();

      if (value.startsWith('@')) {
        const note = resolveNoteFromQuery(value);
        if (note) {
          chain.insertLinkNote(note.id).run();
        }
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
      // Reset input state when popover opens
      linkInputValue.value = '';
      selectedLinkIndex.value = 0;
      nextTick(() => toolbarInsertRef.value?.linkInputRef?.focus());
    }

    function onLinkInputKeydown(event) {
      if (
        !linkInputValue.value.startsWith('@') ||
        linkSuggestions.value.length === 0
      )
        return;

      const len = linkSuggestions.value.length;

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedLinkIndex.value = (selectedLinkIndex.value + len - 1) % len;
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedLinkIndex.value = (selectedLinkIndex.value + 1) % len;
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const note = linkSuggestions.value[selectedLinkIndex.value];
        if (note) selectLinkNote(note.id);
      }
    }

    watch(linkInputValue, (val) => {
      if (val.startsWith('@')) selectedLinkIndex.value = 0;
    });

    function getCursorPos() {
      return props.editor?.state?.selection?.from ?? 0;
    }

    function insertAtPos(pos, nodeType, attrs) {
      props.editor.commands.setTextSelection(pos);
      props.editor.commands.focus();
      const node = props.editor.state.schema.nodes[nodeType]?.create(attrs);
      if (!node) return;
      const tr = props.editor.state.tr.replaceSelectionWith(node);
      if (tr) props.editor.view.dispatch(tr);
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
          insertAtPos(pos, 'fileEmbed', { src: `${relativePath}`, fileName });
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
                  extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma'],
                },
              ],
        });
        if (canceled || filePaths.length === 0) return;
        for (const filePath of filePaths) {
          const { fileName, relativePath } = await saveFile(filePath, props.id);
          insertAtPos(pos, 'Audio', { src: `${relativePath}`, fileName });
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
          insertAtPos(pos, 'Video', { src: `${relativePath}` });
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
        const imgPath = `assets://${route.params.id}/${fileName}`;
        props.editor.chain().focus().setImage({ src: imgPath }).run();
      } catch (error) {
        console.error('triggerImageInput failed:', error);
      }
    }

    // ── Sub-panel morph ───────────────────────────────────────────
    const activePanel = ref('main');
    const prevPanel = ref(null);

    function openSub(name) {
      if (activePanel.value === name) return;
      prevPanel.value = activePanel.value;
      activePanel.value = name;
      // scroll track back to start whenever a sub-panel opens
      nextTick(() => {
        if (container.value) container.value.scrollLeft = 0;
      });
    }

    function closeSub() {
      prevPanel.value = activePanel.value;
      activePanel.value = 'main';
      setTimeout(() => {
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

    // ── Scroll-edge fade indicators ───────────────────────────────
    const scrolledLeft = ref(true);
    const scrolledRight = ref(false);

    function updateScrollEdges() {
      const el = container.value;
      if (!el) return;
      scrolledLeft.value = el.scrollLeft <= 2;
      scrolledRight.value =
        el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    }

    onMounted(() => {
      nextTick(() => {
        const el = container.value;
        if (!el) return;
        el.addEventListener('scroll', updateScrollEdges, { passive: true });
        updateScrollEdges();
      });
    });

    onUnmounted(() => {
      container.value?.removeEventListener('scroll', updateScrollEdges);
    });

    // ── Class helpers (keeps template tidy) ───────────────────────
    function tbBtn(active = false) {
      return [
        // 44 px tap target per HIG / Material guidelines
        'shrink-0 w-11 h-11 rounded-xl border-0 bg-transparent cursor-pointer',
        'flex items-center justify-center',
        'text-neutral-500 dark:text-neutral-400',
        'hover:bg-black/[0.06] dark:hover:bg-white/[0.08]',
        'hover:text-neutral-800 dark:hover:text-white',
        'active:scale-[0.88] active:bg-black/[0.08] dark:active:bg-white/[0.10]',
        'transition-[transform,background-color] duration-150 select-none touch-manipulation',
        active ? 'is-active' : '',
      ];
    }

    function tbChip(active = false) {
      return [
        'shrink-0 h-[38px] px-3 rounded-xl border-0 bg-transparent cursor-pointer',
        'text-[13px] font-medium flex items-center',
        'text-neutral-500 dark:text-neutral-400',
        'hover:bg-black/[0.06] dark:hover:bg-white/[0.08]',
        'hover:text-neutral-800 dark:hover:text-white',
        'active:scale-[0.93] active:bg-black/[0.08]',
        'transition-[transform,background-color] duration-150 select-none touch-manipulation',
        active ? 'is-active' : '',
      ];
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
  transition: opacity 200ms var(--ease-standard),
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
  transition: opacity 160ms var(--ease-standard),
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
