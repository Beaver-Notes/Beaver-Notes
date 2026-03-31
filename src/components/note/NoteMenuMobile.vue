<template>
  <teleport to="body">
    <div
      class="fixed inset-x-0 z-50 print:hidden hidden justify-center px-4 transition-opacity duration-300 pointer-events-none mobile:flex"
      :class="
        store.inReaderMode ? 'opacity-0 hover:opacity-100' : 'opacity-100'
      "
      :style="{ bottom: 'var(--app-keyboard-inset-bottom)' }"
    >
      <div
        class="pointer-events-auto relative h-14 max-w-full overflow-hidden rounded-2xl border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-neutral-800 dark:shadow-2xl"
      >
        <div
          ref="container"
          class="relative h-full overflow-x-auto overflow-y-hidden scrollbar-hide scroll-smooth"
          style="
            -webkit-overflow-scrolling: touch;
            overscroll-behavior-x: contain;
          "
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
              v-if="isItemVisible('paragraph')"
              v-tooltip.group="translations.menu.paragraph"
              :class="tbBtn(editor.isActive('paragraph'))"
              @click="openSub('paragraph')"
            >
              <v-remixicon name="riParagraph" />
            </button>

            <button
              v-if="isItemVisible('headings')"
              v-tooltip.group="translations.menu.headings"
              :class="tbBtn(editor.isActive('heading'))"
              @click="openSub('headings')"
            >
              <v-remixicon name="riHeading" />
            </button>

            <button
              v-if="isItemVisible('fontSize')"
              v-tooltip.group="translations.menu.fontSize"
              :class="tbBtn()"
              @click="openSub('fontSize')"
            >
              <span
                class="pointer-events-none text-xs font-semibold leading-none"
                >{{ fontSize || 'Aa' }}</span
              >
            </button>

            <span
              v-if="hasTextControls && hasFormattingControls"
              class="tb-divider"
            />

            <button
              v-for="item in visibleInlineFormatItems"
              :key="item.id"
              v-tooltip.group="fmtMap[item.fmt]?.title"
              :class="tbBtn(editor.isActive(fmtMap[item.fmt]?.state))"
              @click="fmtMap[item.fmt]?.run()"
            >
              <v-remixicon :name="fmtMap[item.fmt]?.icon" />
            </button>

            <button
              v-if="isItemVisible('color')"
              v-tooltip.group="translations.menu.highlight"
              :class="
                tbBtn(
                  editor.isActive('textStyle') || editor.isActive('highlight')
                )
              "
              @click="openSub('color')"
            >
              <v-remixicon
                name="riFontColor"
                :style="{ color: currentTextColor }"
              />
            </button>

            <span
              v-if="hasFormattingControls && hasBlockControls"
              class="tb-divider"
            />

            <button
              v-if="!isTableActive && isItemVisible('lists')"
              v-tooltip.group="translations.menu.lists"
              :class="
                tbBtn(
                  editor.isActive('orderedList') ||
                    editor.isActive('bulletList') ||
                    editor.isActive('taskList')
                )
              "
              @click="openSub('lists')"
            >
              <v-remixicon name="riListOrdered" />
            </button>

            <button
              v-if="!isTableActive && isItemVisible('blockquote')"
              v-tooltip.group="translations.menu.blockQuote"
              :class="tbBtn(editor.isActive('blockquote'))"
              @click="editor.chain().focus().toggleBlockquote().run()"
            >
              <v-remixicon name="riDoubleQuotesR" />
            </button>

            <button
              v-if="!isTableActive && isItemVisible('codeBlock')"
              v-tooltip.group="translations.menu.codeBlock"
              :class="tbBtn(editor.isActive('codeBlock'))"
              @click="editor.chain().focus().toggleCodeBlock().run()"
            >
              <v-remixicon name="riCodeBoxLine" />
            </button>

            <template v-if="isTableActive">
              <button
                v-for="t in tableActions"
                :key="t.name"
                v-tooltip.group="t.label"
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

            <button
              v-if="isItemVisible('link')"
              v-tooltip.group="translations.menu.link"
              :class="tbBtn(editor.isActive('link'))"
              @click="editor.chain().focus().toggleLink({ href: '' }).run()"
            >
              <v-remixicon name="riLink" />
            </button>
            <button
              v-if="isItemVisible('image')"
              v-tooltip.group="translations.menu.image"
              :class="tbBtn()"
              @click="openSub('image')"
            >
              <v-remixicon name="riImageLine" />
            </button>
            <button
              v-if="isItemVisible('file')"
              v-tooltip.group="translations.menu.file"
              :class="tbBtn()"
              @click="openSub('file')"
            >
              <v-remixicon name="riFile2Line" />
            </button>
            <button
              v-if="isItemVisible('video')"
              v-tooltip.group="translations.menu.video"
              :class="tbBtn()"
              @click="openSub('video')"
            >
              <v-remixicon name="riMovieLine" />
            </button>
            <button
              v-if="isItemVisible('table')"
              v-tooltip.group="translations.menu.table"
              :class="tbBtn()"
              @click="
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run()
              "
            >
              <v-remixicon name="riTableLine" />
            </button>
            <button
              v-if="isItemVisible('draw')"
              v-tooltip.group="translations.menu.draw"
              :class="tbBtn(drawActions.some((action) => action.isActive))"
              @click="openSub('draw')"
            >
              <v-remixicon name="riBrushLine" />
            </button>

            <span
              v-if="hasMediaControls && isItemVisible('audio')"
              class="tb-divider"
            />

            <!-- Audio -->
            <div class="flex items-center gap-0.5">
              <template v-if="isRecording">
                <button
                  :class="tbBtn()"
                  class="!text-red-500"
                  @click="toggleRecording"
                >
                  <v-remixicon name="riStopCircleLine" />
                </button>
                <span
                  class="min-w-10 px-1 text-xs font-semibold tabular-nums text-red-500"
                  >{{ formattedTime }}</span
                >
                <button :class="tbBtn()" @click="pauseResume">
                  <v-remixicon
                    :name="isPaused ? 'riPlayFill' : 'riPauseFill'"
                  />
                </button>
              </template>
              <template v-else>
                <button
                  v-if="isItemVisible('audio')"
                  v-tooltip.group="translations.menu.record"
                  :class="tbBtn()"
                  @click="openSub('audio')"
                >
                  <v-remixicon name="riMicLine" />
                </button>
              </template>
            </div>

            <span
              v-if="
                (hasMediaControls || isItemVisible('audio')) &&
                isItemVisible('delete')
              "
              class="tb-divider"
            />

            <button
              v-if="isItemVisible('delete')"
              v-tooltip.group="translations.menu.delete"
              :class="[tbBtn(), 'hover:!text-red-500 hover:!bg-red-500/10']"
              @click="deleteNode"
            >
              <v-remixicon name="riDeleteBin6Line" />
            </button>

            <span
              v-if="isItemVisible('delete') || visibleItems.length"
              class="tb-divider"
            />

            <button
              v-tooltip.group="'Customize toolbar'"
              :class="tbBtn(showCustomizer)"
              @click="showCustomizer = true"
            >
              <v-remixicon name="riSettings3Line" />
            </button>

            <template v-for="item in visibleItems" :key="item.id">
              <component
                :is="item.meta.component"
                v-if="item.meta?.component"
                :editor="editor"
              />
            </template>
          </div>

          <!-- ── HEADINGS SUB-PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-0.5 px-2 whitespace-nowrap h-full',
              panelClass('headings'),
            ]"
          >
            <button class="tb-back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.headings }}</span>
            <button
              :class="tbChip(editor.isActive('paragraph'))"
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
            <button class="tb-back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.fontSize }}</span>
            <div
              class="flex items-center gap-0.5 border border-black/10 dark:border-white/10 rounded-xl px-1 h-[38px] shrink-0"
            >
              <button
                class="w-7 h-7 flex items-center justify-center rounded-lg text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10 hover:text-neutral-800 dark:hover:text-white transition-colors"
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
            <button class="tb-back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.textColor }}</span>
            <button
              class="w-7 h-7 shrink-0 rounded-lg border border-black/10 dark:border-white/10 flex items-center justify-center text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors bg-transparent"
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
              @click="
                editor.commands.unsetHighlight();
                closeSub();
              "
            >
              ∅
            </button>
            <button
              v-for="c in highlighterColors"
              :key="'hl-' + c"
              :class="[
                'h-6 w-6 shrink-0 rounded-full border border-black/10 dark:border-white/10 hover:scale-110 active:scale-95 transition-transform',
                c,
              ]"
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
            <button class="tb-back" @click="closeSub()">
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
            <button class="tb-back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.image }}</span>
            <input
              v-model="imgUrl"
              class="tb-input"
              :placeholder="translations.menu.imgUrl || 'Image URL'"
              @keyup.enter="
                insertImage();
                closeSub();
              "
            />
            <button :class="tbBtn()" @click="editorImage.select(true)">
              <v-remixicon name="riFolderOpenLine" />
            </button>
            <button
              :class="tbBtn()"
              @click="
                insertImage();
                closeSub();
              "
            >
              <v-remixicon name="riSave3Line" />
            </button>
          </div>

          <!-- ── FILE SUB-PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-1.5 px-2 whitespace-nowrap h-full',
              panelClass('file'),
            ]"
          >
            <button class="tb-back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.file }}</span>
            <input
              v-model="fileUrl"
              class="tb-input"
              :placeholder="translations.menu.fileUrl || 'File URL'"
              @keyup.enter="
                insertFile();
                closeSub();
              "
            />
            <button :class="tbBtn()" @click="$refs.fileInput.click()">
              <v-remixicon name="riFolderOpenLine" />
            </button>
            <input
              ref="fileInput"
              type="file"
              class="hidden"
              multiple
              @change="handleFileSelect"
            />
            <button
              :class="tbBtn()"
              @click="
                insertFile();
                closeSub();
              "
            >
              <v-remixicon name="riSave3Line" />
            </button>
          </div>

          <!-- ── VIDEO SUB-PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-1.5 px-2 whitespace-nowrap h-full',
              panelClass('video'),
            ]"
          >
            <button class="tb-back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.video }}</span>
            <input
              v-model="videoUrl"
              class="tb-input"
              :placeholder="translations.menu.videoUrl || 'Video URL'"
              @keyup.enter="
                insertVideo();
                closeSub();
              "
            />
            <button :class="tbBtn()" @click="$refs.videoInput.click()">
              <v-remixicon name="riFolderOpenLine" />
            </button>
            <input
              ref="videoInput"
              type="file"
              class="hidden"
              multiple
              @change="handleVideoSelect"
            />
            <button
              :class="tbBtn()"
              @click="
                insertVideo();
                closeSub();
              "
            >
              <v-remixicon name="riSave3Line" />
            </button>
          </div>

          <!-- ── AUDIO SUB-PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-0.5 px-2 whitespace-nowrap h-full',
              panelClass('audio'),
            ]"
          >
            <button class="tb-back" @click="closeSub()">
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
                $refs.audioInput.click();
                closeSub();
              "
            >
              <v-remixicon name="riFile2Line" class="w-4 h-4" />{{
                translations.menu.upload
              }}
            </button>
            <input
              ref="audioInput"
              type="file"
              class="hidden"
              accept="audio/*"
              multiple
              @change="handleAudioSelect"
            />
          </div>

          <!-- ── DRAW SUB-PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-2 px-2 whitespace-nowrap h-full',
              panelClass('draw'),
            ]"
          >
            <button class="tb-back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">{{ translations.menu.draw }}</span>

            <button
              v-for="action in drawActions"
              :key="action.name"
              class="flex min-w-[220px] shrink-0 items-start gap-3 rounded-2xl border border-black/10 bg-white px-3 py-3 text-left transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-neutral-800 dark:hover:bg-white/10"
              @click="
                action.handler();
                closeSub();
              "
            >
              <span
                class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 dark:bg-neutral-700 dark:text-white"
              >
                <v-remixicon :name="action.icon" />
              </span>
              <span class="min-w-0">
                <span class="flex items-center gap-2">
                  <span
                    class="text-sm font-medium text-neutral-900 dark:text-white"
                  >
                    {{ action.title }}
                  </span>
                  <span
                    v-if="action.isActive"
                    class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary dark:bg-secondary/10 dark:text-secondary"
                  >
                    {{ translations.menu.active || 'Active' }}
                  </span>
                </span>
                <span
                  class="mt-1 block text-xs leading-4 text-neutral-500 dark:text-neutral-400"
                >
                  {{ action.description }}
                </span>
              </span>
            </button>

          </div>

          <!-- ── PARAGRAPH / ALIGN SUB-PANEL ── -->
          <div
            :class="[
              'tb-panel flex items-center gap-0.5 px-2 whitespace-nowrap h-full',
              panelClass('paragraph'),
            ]"
          >
            <button class="tb-back" @click="closeSub()">
              <v-remixicon name="riArrowLeftLine" />
            </button>
            <span class="tb-divider" />
            <span class="sub-label">Align</span>
            <button
              :class="tbBtn()"
              @click="
                editor.chain().focus().setTextAlign('left').run();
                closeSub();
              "
            >
              <v-remixicon name="riAlignLeft" />
            </button>
            <button
              :class="tbBtn()"
              @click="
                editor.chain().focus().setTextAlign('center').run();
                closeSub();
              "
            >
              <v-remixicon name="riAlignCenter" />
            </button>
            <button
              :class="tbBtn()"
              @click="
                editor.chain().focus().setTextAlign('right').run();
                closeSub();
              "
            >
              <v-remixicon name="riAlignRight" />
            </button>
            <button
              :class="tbBtn()"
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
    </div>
  </teleport>
</template>

<script>
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import NoteMenuHeadingsTree from './NoteMenuHeadingsTree.vue';
import ToolbarCustomizer from './ToolbarCustomizer.vue';
import { useNoteMenu } from '@/composable/useNoteMenu';

export default {
  components: { NoteMenuHeadingsTree, ToolbarCustomizer },
  props: {
    editor: { type: Object, default: () => ({}) },
    tree: { type: Boolean, default: false },
    id: { type: String, default: '' },
    note: { type: Object, required: true },
    showSearch: { type: Boolean, default: false },
  },
  emits: ['update:tree'],

  setup(props) {
    const shared = useNoteMenu(props);
    const { container } = shared;

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
        'transition-all duration-150 select-none touch-manipulation',
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
        'transition-all duration-150 select-none touch-manipulation',
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
  transition: opacity 200ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
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
  transition: opacity 160ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 160ms cubic-bezier(0.4, 0, 0.2, 1);
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
         transition-all duration-150 select-none touch-manipulation;
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
