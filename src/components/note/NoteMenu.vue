<template>
  <div
    ref="container"
    class="bg-white dark:bg-neutral-800 border overflow-x-auto z-20 top-2 w-fit max-w-full mx-auto p-1 sticky rounded-lg shadow-lg no-print no-scrollbar"
    :class="{
      'opacity-0 hover:opacity-100 transition-opacity': store.inReaderMode,
    }"
    @wheel.passive="changeWheelDirection"
  >
    <div class="flex items-center justify-start w-max h-full gap-0.5 px-1">
      <template v-for="item in visibleItems" :key="item.id">
        <hr v-if="item.meta?.isDivider" class="border-r mx-2 h-6" />

        <button
          v-else-if="item.id === 'paragraph'"
          v-tooltip.group="translations.menu.paragraph"
          :class="{ 'is-active': editor.isActive('paragraph') }"
          class="hoverable h-8 px-1 rounded-lg transition-colors"
          @click="editor.chain().focus().setParagraph().run()"
        >
          <v-remixicon name="riParagraph" />
        </button>

        <ui-popover
          v-else-if="item.id === 'headings'"
          padding="p-2 flex flex-col"
        >
          <template #trigger>
            <button
              v-tooltip.group="translations.menu.headings"
              :class="{ 'is-active': editor.isActive('heading') }"
              class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
            >
              <v-remixicon name="riHeading" />
              <v-remixicon
                name="riArrowDownSLine"
                class="opacity-60 size-3.5"
              />
            </button>
          </template>

          <button
            v-for="h in [1, 2, 3, 4]"
            :key="h"
            :class="{ 'is-active': editor.isActive('heading', { level: h }) }"
            class="flex items-center gap-2 p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-[#353333] transition-colors"
            @click="editor.chain().focus().toggleHeading({ level: h }).run()"
          >
            <v-remixicon :name="`riH${h}`" />
            <span
              class="text-sm font-medium text-neutral-800 dark:text-[color:var(--selected-dark-text)]"
            >
              {{ translations.menu.heading }} {{ h }}
            </span>
          </button>
        </ui-popover>

        <ui-popover
          v-else-if="item.id === 'fontSize'"
          padding="p-2 flex flex-col"
        >
          <template #trigger>
            <div
              class="flex items-center justify-center w-24 p-1 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden gap-1 flex-shrink-0 border"
            >
              <button
                type="button"
                class="w-7 h-7 border flex items-center justify-center bg-input focus:outline-none rounded-full"
                @click.stop="
                  fontSize += 1;
                  updateFontSize();
                "
              >
                <v-remixicon name="riAddLine" class="w-4 h-4" />
              </button>

              <input
                v-model.number="fontSize"
                v-tooltip.group="translations.menu.fontSize"
                type="number"
                min="1"
                class="w-1/3 bg-transparent text-center text-neutral-800 dark:text-white border-0 appearance-none focus:outline-none text-xs"
                @change="updateFontSize"
              />

              <button
                type="button"
                class="w-7 h-7 border flex items-center justify-center bg-input focus:outline-none rounded-full"
                @click.stop="
                  fontSize = Math.max(1, fontSize - 1);
                  updateFontSize();
                "
              >
                <v-remixicon name="riSubtractLine" class="w-4 h-4" />
              </button>
            </div>
          </template>

          <div
            class="flex flex-col gap-0.5 max-h-44 overflow-y-auto no-scrollbar"
          >
            <button
              class="px-2 py-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 text-left text-sm"
              @click="
                editor.chain().focus().unsetFontSize().run();
                fontSize = null;
              "
            >
              Default
            </button>

            <button
              v-for="size in [10, 12, 14, 16, 18, 20, 24, 28, 32, 36]"
              :key="size"
              class="px-2 py-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 text-left text-sm"
              @click="
                editor
                  .chain()
                  .focus()
                  .setFontSize(size + 'pt')
                  .run();
                fontSize = size;
              "
            >
              {{ size }}
            </button>
          </div>
        </ui-popover>

        <button
          v-else-if="fmtMap[item.id]"
          v-tooltip.group="fmtMap[item.id].title"
          :class="{ 'is-active': editor.isActive(fmtMap[item.id].state) }"
          class="hoverable h-8 px-1 rounded-lg transition-colors"
          @click="fmtMap[item.id].run()"
        >
          <v-remixicon :name="fmtMap[item.id].icon" />
        </button>

        <ui-popover v-else-if="item.id === 'color'" padding="p-2">
          <template #trigger>
            <button
              v-tooltip.group="translations.menu.highlight"
              class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
            >
              <v-remixicon
                name="riFontColor"
                :style="{ color: currentTextColor }"
              />
            </button>
          </template>

          <div>
            <p class="text-xs font-medium text-neutral-500 mb-1.5">
              {{ translations.menu.textColor }}
            </p>

            <div class="grid grid-cols-4 gap-1.5 mb-3">
              <button
                class="w-7 h-7 flex items-center justify-center rounded border hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                @click="editor.chain().focus().unsetColor().run()"
              >
                <v-remixicon name="riFontColor" class="w-3.5 h-3.5" />
              </button>

              <button
                v-for="c in textColors"
                :key="c"
                class="w-7 h-7 rounded border hover:scale-110 transition-transform"
                :style="{ backgroundColor: c + '33' }"
                @click="setTextColor(c)"
              >
                <v-remixicon
                  name="riFontColor"
                  class="w-3.5 h-3.5 mx-auto"
                  :style="{ color: c }"
                />
              </button>
            </div>

            <p class="text-xs font-medium text-neutral-500 mb-1.5">
              {{ translations.menu.highlighterColor }}
            </p>

            <div class="grid grid-cols-4 gap-1.5">
              <button
                class="w-7 h-7 rounded border hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors text-xs"
                @click="editor.commands.unsetHighlight()"
              >
                ∅
              </button>

              <button
                v-for="c in highlighterColors"
                :key="c"
                :class="[
                  'w-7 h-7 rounded hover:scale-110 transition-transform',
                  c,
                ]"
                @click="setHighlightColor(c)"
              />
            </div>
          </div>
        </ui-popover>

        <button
          v-else-if="item.id === 'blockquote' && !isTableActive"
          v-tooltip.group="translations.menu.blockQuote"
          :class="{ 'is-active': editor.isActive('blockquote') }"
          class="hoverable h-8 px-1 rounded-lg transition-colors"
          @click="editor.chain().focus().toggleBlockquote().run()"
        >
          <v-remixicon name="riDoubleQuotesR" />
        </button>

        <button
          v-else-if="item.id === 'codeBlock' && !isTableActive"
          v-tooltip.group="translations.menu.codeBlock"
          :class="{ 'is-active': editor.isActive('codeBlock') }"
          class="hoverable h-8 px-1 rounded-lg transition-colors"
          @click="editor.chain().focus().toggleCodeBlock().run()"
        >
          <v-remixicon name="riCodeBoxLine" />
        </button>

        <ui-popover
          v-else-if="item.id === 'lists' && !isTableActive"
          padding="p-2 flex flex-col"
        >
          <template #trigger>
            <button
              v-tooltip.group="translations.menu.lists"
              :class="{
                'is-active':
                  editor.isActive('orderedList') ||
                  editor.isActive('bulletList') ||
                  editor.isActive('taskList'),
              }"
              class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
            >
              <v-remixicon name="riListOrdered" />
              <v-remixicon
                name="riArrowDownSLine"
                class="opacity-60 size-3.5"
              />
            </button>
          </template>

          <button
            v-for="l in lists"
            :key="l.name"
            :class="{ 'is-active': editor.isActive(l.state) }"
            class="flex items-center gap-2 p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-[#353333] transition-colors"
            @click="l.run()"
          >
            <v-remixicon :name="l.icon" />
            <span
              class="text-sm font-medium text-neutral-800 dark:text-[color:var(--selected-dark-text)]"
              >{{ l.title }}</span
            >
          </button>
        </ui-popover>

        <template
          v-else-if="
            isTableActive &&
            ['blockquote', 'codeBlock', 'lists'].includes(item.id) &&
            item.id ===
              visibleItems.find((i) =>
                ['blockquote', 'codeBlock', 'lists'].includes(i.id)
              )?.id
          "
        >
          <button
            v-for="t in tableActions"
            :key="t.name"
            v-tooltip.group="t.label"
            class="hoverable h-8 px-1 rounded-lg transition-colors"
            @click="t.run()"
          >
            <v-remixicon :name="t.icon" />
          </button>
        </template>

        <ui-popover
          v-else-if="item.id === 'image'"
          padding="p-2 flex items-center gap-2"
        >
          <template #trigger>
            <button
              v-tooltip.group="translations.menu.image"
              class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
            >
              <v-remixicon name="riImageLine" />
            </button>
          </template>

          <input
            v-model="imgUrl"
            class="bg-transparent text-sm w-40"
            :placeholder="translations.menu.imgUrl || 'URL'"
            @keyup.enter="insertImage"
          />

          <v-remixicon
            name="riFolderOpenLine"
            class="cursor-pointer opacity-60 hover:opacity-100"
            @click="editorImage.select(true)"
          />

          <v-remixicon
            name="riSave3Line"
            class="cursor-pointer opacity-60 hover:opacity-100"
            @click="insertImage"
          />
        </ui-popover>

        <div
          v-else-if="item.id === 'audio'"
          :class="[
            'flex items-center space-x-2',
            isRecording
              ? 'bg-neutral-50 dark:bg-neutral-800 border dark:text-[color:var(--selected-dark-text)] rounded-full p-1'
              : '',
          ]"
        >
          <template v-if="isRecording">
            <button
              v-tooltip.group="translations.menu.record"
              class="w-7 h-7 flex items-center justify-center bg-input focus:outline-none rounded-full"
              @click="toggleRecording"
            >
              <v-remixicon name="riStopCircleLine" />
            </button>

            <span class="font-secondary font-semibold text-sm">{{
              formattedTime
            }}</span>

            <button
              v-tooltip.group="
                isPaused ? translations.menu.resume : translations.menu.pause
              "
              class="w-7 h-7 flex items-center justify-center bg-input focus:outline-none rounded-full"
              @click="pauseResume"
            >
              <v-remixicon :name="isPaused ? 'riPlayFill' : 'riPauseFill'" />
            </button>
          </template>

          <template v-else>
            <ui-popover padding="p-2 flex flex-col">
              <template #trigger>
                <button
                  v-tooltip.group="translations.menu.record"
                  class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
                >
                  <v-remixicon name="riMicLine" />
                </button>
              </template>

              <button
                class="flex items-center gap-2 p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-[#353333] transition-colors"
                @click="toggleRecording"
              >
                <v-remixicon name="riMicLine" />
                <span
                  class="text-sm font-medium dark:text-[color:var(--selected-dark-text)]"
                  >{{ translations.menu.record }}</span
                >
              </button>

              <button
                class="flex items-center gap-2 p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-[#353333] transition-colors"
                @click="$refs.audioInput.click()"
              >
                <v-remixicon name="riFile2Line" />
                <span
                  class="text-sm font-medium dark:text-[color:var(--selected-dark-text)]"
                  >{{ translations.menu.upload }}</span
                >
              </button>
            </ui-popover>

            <input
              ref="audioInput"
              type="file"
              class="hidden"
              accept="audio/*"
              multiple
              @change="handleAudioSelect"
            />
          </template>
        </div>

        <button
          v-else-if="item.id === 'link'"
          v-tooltip.group="translations.menu.link"
          :class="{ 'is-active': editor.isActive('link') }"
          class="hoverable h-8 px-1 rounded-lg transition-colors"
          @click="editor.chain().focus().toggleLink({ href: '' }).run()"
        >
          <v-remixicon name="riLink" />
        </button>

        <ui-popover
          v-else-if="item.id === 'file'"
          padding="p-2 flex items-center gap-2"
        >
          <template #trigger>
            <button
              v-tooltip.group="translations.menu.file"
              class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
            >
              <v-remixicon name="riFile2Line" />
            </button>
          </template>

          <input
            v-model="fileUrl"
            class="bg-transparent text-sm w-40"
            :placeholder="translations.menu.fileUrl || 'URL'"
            @keyup.enter="insertFile"
          />

          <v-remixicon
            name="riFolderOpenLine"
            class="cursor-pointer opacity-60 hover:opacity-100"
            @click="$refs.fileInput.click()"
          />

          <input
            ref="fileInput"
            type="file"
            class="hidden"
            multiple
            @change="handleFileSelect"
          />

          <v-remixicon
            name="riSave3Line"
            class="cursor-pointer opacity-60 hover:opacity-100"
            @click="insertFile"
          />
        </ui-popover>

        <button
          v-else-if="item.id === 'table'"
          v-tooltip.group="translations.menu.table"
          class="hoverable h-8 px-1 rounded-lg transition-colors"
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

        <ui-popover
          v-else-if="item.id === 'embed'"
          padding="p-2 flex items-center gap-2"
        >
          <template #trigger>
            <button
              v-tooltip.group="translations.menu.embed"
              class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
            >
              <v-remixicon name="riPagesLine" />
            </button>
          </template>

          <input
            v-model="EmbedUrl"
            class="bg-transparent text-sm w-40"
            :placeholder="translations.menu.embedUrl || 'URL'"
            @keyup.enter="addIframe"
          />

          <v-remixicon
            name="riSave3Line"
            class="cursor-pointer opacity-60 hover:opacity-100"
            @click="addIframe"
          />
        </ui-popover>

        <button
          v-else-if="item.id === 'draw'"
          v-tooltip.group="translations.menu.draw"
          class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
          @click="editor.commands.insertPaper"
        >
          <v-remixicon name="riBrushLine" />
        </button>

        <ui-popover
          v-else-if="item.id === 'video'"
          padding="p-2 flex items-center gap-2"
        >
          <template #trigger>
            <button
              v-tooltip.group="translations.menu.video"
              class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
            >
              <v-remixicon name="riMovieLine" />
            </button>
          </template>

          <input
            v-model="VideoUrl"
            class="bg-transparent text-sm w-40"
            :placeholder="translations.menu.videoUrl || 'URL'"
            @keyup.enter="insertVideo"
          />

          <v-remixicon
            name="riFolderOpenLine"
            class="cursor-pointer opacity-60 hover:opacity-100"
            @click="$refs.videoInput.click()"
          />

          <input
            ref="videoInput"
            type="file"
            class="hidden"
            multiple
            @change="handleVideoSelect"
          />

          <v-remixicon
            name="riSave3Line"
            class="cursor-pointer opacity-60 hover:opacity-100"
            @click="insertVideo"
          />
        </ui-popover>

        <ui-popover
          v-else-if="item.id === 'share' && !isTableActive"
          padding="p-2 flex flex-col"
        >
          <template #trigger>
            <button
              v-tooltip.group="translations.menu.share"
              class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
            >
              <v-remixicon name="riShare2Line" />
            </button>
          </template>

          <button
            v-for="s in shareActions"
            :key="s.name"
            class="flex items-center gap-2 p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-[#353333] transition-colors"
            @click="s.handler"
          >
            <v-remixicon :name="s.icon" />
            <span
              class="text-sm font-medium dark:text-[color:var(--selected-dark-text)]"
              >{{ s.title }}</span
            >
          </button>
        </ui-popover>

        <button
          v-else-if="item.id === 'delete'"
          v-tooltip.group="translations.menu.delete"
          class="hoverable h-8 px-1 rounded-lg"
          @click="deleteNode"
        >
          <v-remixicon name="riDeleteBin6Line" />
        </button>

        <button
          v-else-if="item.id === 'readerMode'"
          v-tooltip.group="translations.menu.readerMode"
          :class="{ 'is-active': store.inReaderMode }"
          class="hoverable h-8 px-1 rounded-lg"
          @click="toggleReaderMode"
        >
          <v-remixicon name="riArticleLine" />
        </button>

        <template v-else-if="item.id === 'headingsTree'">
          <button
            v-tooltip.group="translations.menu.headingsTree"
            :class="{ 'is-active': tree }"
            class="hoverable h-8 px-1 rounded-lg"
            @click="showHeadingsTree = !showHeadingsTree"
          >
            <v-remixicon name="riSearchLine" />
          </button>

          <ui-popover
            v-slot="{ isShow }"
            v-model="showHeadingsTree"
            trigger="manual"
            @show="getHeadingsTree"
          >
            <note-menu-headings-tree
              v-if="isShow"
              :editor="editor"
              :headings="headingsTree"
              @close="showHeadingsTree = false"
            />
          </ui-popover>
        </template>

        <component
          :is="item.meta.component"
          v-else-if="item.meta?.component"
          :editor="editor"
        />
      </template>

      <template
        v-if="
          isTableActive &&
          !visibleItems.some((i) =>
            ['blockquote', 'codeBlock', 'lists'].includes(i.id)
          )
        "
      >
        <button
          v-for="t in tableActions"
          :key="t.name"
          v-tooltip.group="t.label"
          class="hoverable h-8 px-1 rounded-lg transition-colors"
          @click="t.run()"
        >
          <v-remixicon :name="t.icon" />
        </button>
      </template>

      <hr class="border-r mx-2 h-6" />

      <button
        v-tooltip.group="'Customize toolbar'"
        :class="{ 'is-active': showCustomizer }"
        class="hoverable h-8 px-1 rounded-lg transition-colors"
        @click="showCustomizer = true"
      >
        <v-remixicon name="riSettings3Line" />
      </button>
    </div>

    <toolbar-customizer
      v-model="showCustomizer"
      @close="showCustomizer = false"
    />
  </div>
</template>

<script>
import { ref } from 'vue';
import useAudioRecorder from '@/utils/record';
import { useGroupTooltip } from '@/composable/groupTooltip';
import { useStore } from '@/store';
import { useEditorImage } from '@/composable/editorImage';
import NoteMenuHeadingsTree from './NoteMenuHeadingsTree.vue';
import ToolbarCustomizer from './ToolbarCustomizer.vue';
import { useNoteStore } from '../../store/note';
import { useRouter } from 'vue-router';
import { useDialog } from '@/composable/dialog';
import { useStorage } from '@/composable/storage';
import { useTranslations } from '@/composable/useTranslations';
import { useToolbarConfig } from '@/composable/useToolbarConfig';
import { useNoteMenuActions } from '@/composable/useNoteMenuActions';
import { useNoteMenuState } from '@/composable/useNoteMenuState';
import { backend, path } from '@/lib/tauri-bridge';
const storage = useStorage('settings');

export default {
  components: { NoteMenuHeadingsTree, ToolbarCustomizer },
  props: {
    editor: { type: Object, default: () => ({}) },
    tree: { type: Boolean, default: false },
    id: { type: String, default: '' },
    note: { type: Object, required: true },
  },
  emits: ['update:tree'],
  setup(props) {
    const { translations } = useTranslations();
    const toolbar = useToolbarConfig();
    const visibleItems = toolbar.visibleItems;
    const showCustomizer = ref(false);

    const {
      isRecording,
      formattedTime,
      toggleRecording,
      isPaused,
      pauseResume,
    } = useAudioRecorder(props, backend, storage, path);

    const store = useStore();
    const noteStore = useNoteStore();
    const router = useRouter();
    const dialog = useDialog();
    const editorImage = useEditorImage(props.editor);
    useGroupTooltip();

    const {
      currentTextColor,
      fmtMap,
      highlighterColors,
      isTableActive,
      lists,
      printContent,
      setHighlightColor,
      setTextColor,
      shareActions,
      tableActions,
      textColors,
    } = useNoteMenuActions({
      editor: props.editor,
      noteId: props.id,
      noteTitle: props.note.title,
      translations,
      backend,
    });

    const {
      addIframe,
      changeWheelDirection,
      container,
      deleteNode,
      embedUrl: EmbedUrl,
      fileUrl,
      fontSize,
      getHeadingsTree,
      handleAudioSelect,
      handleFileSelect,
      handleVideoSelect,
      headingsTree,
      imgUrl,
      insertFile,
      insertImage,
      insertVideo,
      showHeadingsTree,
      toggleReaderMode,
      updateFontSize,
      videoUrl: VideoUrl,
    } = useNoteMenuState({
      dialog,
      editor: props.editor,
      editorImage,
      noteId: props.id,
      noteStore,
      printContent,
      router,
      store,
      translations,
    });

    return {
      store,
      translations,
      fontSize,
      updateFontSize,
      imgUrl,
      fileUrl,
      VideoUrl,
      EmbedUrl,
      insertImage,
      insertFile,
      insertVideo,
      addIframe,
      handleFileSelect,
      handleAudioSelect,
      handleVideoSelect,
      editorImage,
      headingsTree,
      showHeadingsTree,
      getHeadingsTree,
      isTableActive,
      fmtMap,
      lists,
      shareActions,
      tableActions,
      highlighterColors,
      textColors,
      currentTextColor,
      setHighlightColor,
      setTextColor,
      isRecording,
      formattedTime,
      isPaused,
      toggleRecording,
      pauseResume,
      toggleReaderMode,
      deleteNode,
      printContent,
      container,
      changeWheelDirection,
      visibleItems,
      showCustomizer,
    };
  },
};
</script>

<style scoped>
@media print {
  .no-print {
    visibility: hidden;
  }
}
button {
  @apply hover:text-neutral-800 dark:hover:text-[color:var(--selected-dark-text)];
}
button.is-active {
  @apply text-primary dark:text-secondary hover:text-primary dark:hover:text-secondary;
}
input[type='number']::-webkit-inner-spin-button,
input[type='number']::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type='number'] {
  -moz-appearance: textfield;
}
</style>
