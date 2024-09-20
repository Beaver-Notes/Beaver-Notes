<template>
  <div
    ref="container"
    class="text-gray-600 dark:text-[color:var(--selected-dark-text)] bg-[#FFFFFF] dark:bg-[#232222] dark:text-gray-50 overflow-x-auto sm:overflow-x-none scroll border-b z-20 top-0 w-full left-0 py-1 sticky top-0 no-print"
    :class="{ 'opacity-0 hover:opacity-100 transition': store.inFocusMode }"
    @wheel="changeWheelDirection"
  >
    <div
      v-if="isTableActive"
      class="w-full h-full flex items-center justify-between w-full"
    >
      <button
        v-tooltip.group="translations.menu.paragraph"
        :class="{ 'is-active': editor.isActive('paragraph') }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().setParagraph().run()"
      >
        <v-remixicon name="riParagraph" />
      </button>
      <button
        v-for="heading in [1, 2]"
        :key="heading"
        v-tooltip.group="`${translations.menu.heading} ${heading}`"
        :class="{ 'is-active': editor.isActive('heading', { level: heading }) }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().toggleHeading({ level: heading }).run()"
      >
        <v-remixicon :name="`riH${heading}`" />
      </button>
      <hr class="border-r mx-2 h-6" />
      <button
        v-for="action in textFormatting"
        :key="action.name"
        v-tooltip.group="action.title"
        :class="{ 'is-active': editor.isActive(action.activeState) }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="action.handler"
      >
        <v-remixicon :name="action.icon" />
      </button>
      <ui-popover padding="p-2 flex items-center">
        <template #trigger>
          <button
            v-tooltip.group="translations.menu.highlight"
            :class="{ 'is-active': editor.isActive('highlight') }"
            class="transition hoverable h-8 px-1 rounded-lg"
          >
            <v-remixicon name="riMarkPenLine" />
          </button>
        </template>
        <div class="grid grid-cols-4 gap-2 p-2">
          <button
            v-tooltip.group="translations.menu.highlight"
            :class="{ 'is-active': editor.isActive('highlight') }"
            class="transition hoverable w-8 h-8 px-1 rounded-lg cursor-pointer"
            @click="editor.commands.unsetHighlight()"
          >
            <v-remixicon name="riCloseLine" />
          </button>
          <div
            v-for="color in colors"
            :key="color"
            :class="['w-8 h-8 cursor-pointer', color]"
            @click="setHighlightColor(color)"
          ></div>
        </div>
      </ui-popover>
      <hr class="border-r mx-2 h-6" />
      <button
        v-tooltip.group="translations.menu.addRowAbove"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().addRowBefore().run()"
      >
        <v-remixicon name="riInsertRowTop" />
      </button>
      <button
        v-tooltip.group="translations.menu.addRowBelow"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().addRowAfter().run()"
      >
        <v-remixicon name="riInsertRowBottom" />
      </button>
      <button
        v-tooltip.group="translations.menu.deleteRow"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().deleteRow().run()"
      >
        <v-remixicon name="riDeleteRow" />
      </button>
      <button
        v-tooltip.group="translations.menu.addColumnLeft"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().addColumnBefore().run()"
      >
        <v-remixicon name="riInsertColumnLeft" />
      </button>
      <button
        v-tooltip.group="translations.menu.addColumnRight"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().addColumnAfter().run()"
      >
        <v-remixicon name="riInsertColumnRight" />
      </button>
      <button
        v-tooltip.group="translations.menu.deleteColumn"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().deleteColumn().run()"
      >
        <v-remixicon name="riDeleteColumn" />
      </button>
      <button
        v-tooltip.group="translations.menu.toggleHeader"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().toggleHeaderCell().run()"
      >
        <v-remixicon name="riBrush2Fill" />
      </button>
      <hr class="border-r mx-2 h-6" />
      <ui-popover padding="p-2 flex items-center">
        <template #trigger>
          <button
            v-tooltip.group="translations.menu.image"
            class="transition hoverable h-8 px-1 rounded-lg"
          >
            <v-remixicon name="riImageLine" />
          </button>
        </template>
        <input
          v-model="imgUrl"
          class="bg-transparent mr-2"
          :placeholder="translations.menu.imgurl || '-'"
          @keyup.enter="insertImage"
        />
        <v-remixicon
          name="riFolderOpenLine"
          class="mr-2 cursor-pointer"
          @click="editorImage.select(true)"
        />
        <v-remixicon
          name="riSave3Line"
          class="mr-2 cursor-pointer"
          @click="insertImage"
        />
      </ui-popover>
      <div class="flex items-center">
        <button
          v-tooltip.group="translations.menu.record"
          class="transition hoverable h-8 px-1 rounded-lg"
          @click="toggleRecording"
        >
          <v-remixicon :name="isRecording ? 'riStopCircleLine' : 'riMicLine'" />
        </button>
        <span v-if="isRecording" class="font-amber-100 font-semibold pr-1">{{
          formattedTime
        }}</span>
      </div>
      <button
        v-tooltip.group="translations.menu.Link"
        :class="{ 'is-active': editor.isActive('link') }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().toggleLink({ href: '' }).run()"
      >
        <v-remixicon name="riLink" />
      </button>
      <ui-popover padding="p-2 flex items-center">
        <template #trigger>
          <button
            v-tooltip.group="translations.menu.File"
            class="transition hoverable h-8 px-1 rounded-lg"
          >
            <v-remixicon name="riFile2Line" />
          </button>
        </template>
        <input
          v-model="fileUrl"
          class="bg-transparent mr-2"
          :placeholder="translations.menu.fileUrl || '-'"
          @keyup.enter="insertFile"
        />
        <v-remixicon
          name="riFolderOpenLine"
          class="mr-2 cursor-pointer"
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
          class="mr-2 cursor-pointer"
          @click="insertFile"
        />
      </ui-popover>
      <button
        v-tooltip.group="translations.menu.tableInsert"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="insertTableWithEmptyParagraph"
      >
        <v-remixicon name="riTableLine" />
      </button>
      <ui-popover padding="p-2 flex items-center">
        <ui-popover padding="p-2 flex items-center">
          <template #trigger>
            <button
              v-tooltip.group="translations.menu.Embed"
              class="transition hoverable h-8 px-1 rounded-lg"
            >
              <v-remixicon name="riPagesLine" />
            </button>
          </template>
          <input
            v-model="EmbedUrl"
            class="bg-transparent mr-2"
            :placeholder="translations.menu.EmbedUrl || '-'"
            @keyup.enter="addIframe"
          />
          <v-remixicon
            name="riSave3Line"
            class="mr-2 cursor-pointer"
            @click="addIframe"
          />
        </ui-popover>
        <template #trigger>
          <button class="transition hoverable h-8 px-1 rounded-lg">
            <v-remixicon name="riMoreFill" />
          </button>
        </template>
        <button
          v-tooltip.group="translations.menu.draw"
          class="transition hoverable h-8 px-1 rounded-lg"
          @click="editor.commands.insertPaper"
        >
          <v-remixicon name="riBrushLine" />
        </button>
        <ui-popover padding="p-2 flex items-center">
          <template #trigger>
            <button
              v-tooltip.group="translations.menu.video"
              class="transition hoverable h-8 px-1 rounded-lg"
            >
              <v-remixicon name="riMovieLine" />
            </button>
          </template>
          <input
            v-model="VideoUrl"
            class="bg-transparent mr-2"
            :placeholder="translations.menu.videoUrl || '-'"
            @keyup.enter="insertVideo"
          />
          <v-remixicon
            name="riFolderOpenLine"
            class="mr-2 cursor-pointer"
            @click="$refs.videoInput.click()"
          />
          <input
            ref="videoInput"
            type="file"
            class="hidden"
            multiple
            @change="handleVideoSelect"
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
            class="mr-2 cursor-pointer"
            @click="insertVideo"
          />
        </ui-popover>
      </ui-popover>
      <hr class="border-r mx-2 h-6" />
      <button
        v-tooltip.group="translations.menu.deleteTable"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().deleteTable().run()"
      >
        <v-remixicon name="riDeleteBin6Line" />
      </button>
      <ui-popover
        v-slot="{ isShow }"
        v-model="showHeadingsTree"
        trigger="manual"
        @show="getHeadingsTree"
        @close="editor.commands.focus()"
      >
        <note-menu-headings-tree
          v-if="isShow"
          :editor="editor"
          :headings="headingsTree"
          @close="
            showHeadingsTree = false;
            editor.commands.focus();
          "
        />
      </ui-popover>
    </div>
    <div v-else class="w-full h-full flex items-center justify-between w-full">
      <!-- <input
        type="number"
        class="
          hoverable
          appearance-none
          h-full
          bg-transparent
          h-8 px-1 rounded-lg
          w-20
          text-center
        "
        value="16"
        min="1"
        title="Font size"
      /> -->
      <button
        v-tooltip.group="translations.menu.paragraph"
        :class="{ 'is-active': editor.isActive('paragraph') }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().setParagraph().run()"
      >
        <v-remixicon name="riParagraph" />
      </button>
      <button
        v-for="heading in [1, 2]"
        :key="heading"
        v-tooltip.group="`${translations.menu.heading} ${heading}`"
        :class="{ 'is-active': editor.isActive('heading', { level: heading }) }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().toggleHeading({ level: heading }).run()"
      >
        <v-remixicon :name="`riH${heading}`" />
      </button>
      <hr class="border-r mx-2 h-6" />
      <button
        v-for="action in textFormatting"
        :key="action.name"
        v-tooltip.group="action.title"
        :class="{ 'is-active': editor.isActive(action.activeState) }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="action.handler"
      >
        <v-remixicon :name="action.icon" />
      </button>
      <ui-popover padding="p-2 flex items-center">
        <template #trigger>
          <button
            v-tooltip.group="translations.menu.highlight"
            :class="{ 'is-active': editor.isActive('highlight') }"
            class="transition hoverable h-8 px-1 rounded-lg"
          >
            <v-remixicon name="riMarkPenLine" />
          </button>
        </template>
        <div class="grid grid-cols-4 gap-2 p-2">
          <button
            v-tooltip.group="translations.menu.highlight"
            :class="{ 'is-active': editor.isActive('highlight') }"
            class="transition hoverable w-8 h-8 px-1 rounded-lg cursor-pointer"
            @click="editor.commands.unsetHighlight()"
          >
            <v-remixicon name="riCloseLine" />
          </button>
          <div
            v-for="color in colors"
            :key="color"
            :class="['w-8 h-8 cursor-pointer', color]"
            @click="setHighlightColor(color)"
          ></div>
        </div>
      </ui-popover>
      <hr class="border-r mx-2 h-6" />
      <button
        v-for="action in lists"
        :key="action.name"
        v-tooltip.group="action.title"
        :class="{ 'is-active': editor.isActive(action.activeState) }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="action.handler"
      >
        <v-remixicon :name="action.icon" />
      </button>
      <hr class="border-r mx-2 h-6" />
      <ui-popover padding="p-2 flex items-center">
        <template #trigger>
          <button
            v-tooltip.group="translations.menu.image"
            class="transition hoverable h-8 px-1 rounded-lg"
          >
            <v-remixicon name="riImageLine" />
          </button>
        </template>
        <input
          v-model="imgUrl"
          class="bg-transparent mr-2"
          :placeholder="translations.menu.imgurl || '-'"
          @keyup.enter="insertImage"
        />
        <v-remixicon
          name="riFolderOpenLine"
          class="mr-2 cursor-pointer"
          @click="editorImage.select(true)"
        />
        <v-remixicon
          name="riSave3Line"
          class="mr-2 cursor-pointer"
          @click="insertImage"
        />
      </ui-popover>
      <div class="flex items-center">
        <button
          v-tooltip.group="translations.menu.record"
          class="transition hoverable h-8 px-1 rounded-lg"
          @click="toggleRecording"
        >
          <v-remixicon :name="isRecording ? 'riStopCircleLine' : 'riMicLine'" />
        </button>
        <span v-if="isRecording" class="font-amber-100 font-semibold pr-1">{{
          formattedTime
        }}</span>
      </div>
      <button
        v-tooltip.group="translations.menu.Link"
        :class="{ 'is-active': editor.isActive('link') }"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="editor.chain().focus().toggleLink({ href: '' }).run()"
      >
        <v-remixicon name="riLink" />
      </button>
      <ui-popover padding="p-2 flex items-center">
        <template #trigger>
          <button
            v-tooltip.group="translations.menu.File"
            class="transition hoverable h-8 px-1 rounded-lg"
          >
            <v-remixicon name="riFile2Line" />
          </button>
        </template>
        <input
          v-model="fileUrl"
          class="bg-transparent mr-2"
          :placeholder="translations.menu.fileUrl || '-'"
          @keyup.enter="insertFile"
        />
        <v-remixicon
          name="riFolderOpenLine"
          class="mr-2 cursor-pointer"
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
          class="mr-2 cursor-pointer"
          @click="insertFile"
        />
      </ui-popover>
      <button
        v-tooltip.group="translations.menu.tableInsert"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="insertTableWithEmptyParagraph"
      >
        <v-remixicon name="riTableLine" />
      </button>

      <ui-popover padding="p-2 flex items-center">
        <ui-popover padding="p-2 flex items-center">
          <template #trigger>
            <button
              v-tooltip.group="translations.menu.Embed"
              class="transition hoverable h-8 px-1 rounded-lg"
            >
              <v-remixicon name="riPagesLine" />
            </button>
          </template>
          <input
            v-model="EmbedUrl"
            class="bg-transparent mr-2"
            :placeholder="translations.menu.EmbedUrl || '-'"
            @keyup.enter="addIframe"
          />
          <v-remixicon
            name="riSave3Line"
            class="mr-2 cursor-pointer"
            @click="addIframe"
          />
        </ui-popover>
        <template #trigger>
          <button class="transition hoverable h-8 px-1 rounded-lg">
            <v-remixicon name="riMoreFill" />
          </button>
        </template>
        <button
          v-tooltip.group="translations.menu.draw"
          class="transition hoverable h-8 px-1 rounded-lg"
          @click="editor.commands.insertPaper"
        >
          <v-remixicon name="riBrushLine" />
        </button>
        <ui-popover padding="p-2 flex items-center">
          <template #trigger>
            <button
              v-tooltip.group="translations.menu.video"
              class="transition hoverable h-8 px-1 rounded-lg"
            >
              <v-remixicon name="riMovieLine" />
            </button>
          </template>
          <input
            v-model="VideoUrl"
            class="bg-transparent mr-2"
            :placeholder="translations.menu.videoUrl || '-'"
            @keyup.enter="insertVideo"
          />
          <v-remixicon
            name="riFolderOpenLine"
            class="mr-2 cursor-pointer"
            @click="$refs.videoInput.click()"
          />
          <input
            ref="videoInput"
            type="file"
            class="hidden"
            multiple
            @change="handleVideoSelect"
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
            class="mr-2 cursor-pointer"
            @click="insertVideo"
          />
        </ui-popover>
      </ui-popover>
      <hr class="border-r mx-2 h-6" />
      <button
        v-tooltip.group="translations.menu.Print"
        class="transition hoverable h-8 px-1 rounded-lg"
        @click="printContent"
      >
        <v-remixicon name="riPrinterLine" />
      </button>
      <hr class="border-r mx-2 h-6" />
      <button
        v-if="showAdavancedSettings"
        v-tooltip.group="translations.menu.delete"
        class="hoverable h-8 px-1 rounded-lg h-full"
        @click="deleteNode"
      >
        <v-remixicon name="riDeleteBin6Line" />
      </button>
      <button
        v-tooltip.group="translations.menu.Focusmode"
        :class="{ 'is-active': store.inFocusMode }"
        class="hoverable h-8 px-1 rounded-lg h-full"
        @click="toggleFocusMode"
      >
        <v-remixicon name="riFocus3Line" />
      </button>
      <button
        v-tooltip.group="translations.menu.headingsTree"
        :class="{ 'is-active': tree }"
        class="hoverable h-8 px-1 rounded-lg h-full"
        @click="showHeadingsTree = !showHeadingsTree"
      >
        <v-remixicon name="riSearchLine" />
      </button>
      <ui-popover
        v-slot="{ isShow }"
        v-model="showHeadingsTree"
        trigger="manual"
        @show="getHeadingsTree"
        @close="editor.commands.focus()"
      >
        <note-menu-headings-tree
          v-if="isShow"
          :editor="editor"
          :headings="headingsTree"
          @close="
            showHeadingsTree = false;
            editor.commands.focus();
          "
        />
      </ui-popover>
    </div>
  </div>
</template>

<script>
import {
  shallowRef,
  onUnmounted,
  onMounted,
  computed,
  shallowReactive,
  ref,
} from 'vue';
import { useGroupTooltip } from '@/composable/groupTooltip';
import { useStore } from '@/store';
import { saveFile } from '../../utils/copy-doc';
import { useEditorImage } from '@/composable/editorImage';
import Mousetrap from '@/lib/mousetrap';
import NoteMenuHeadingsTree from './NoteMenuHeadingsTree.vue';
import { useNoteStore } from '../../store/note';
import { useRouter } from 'vue-router';
import { useDialog } from '@/composable/dialog';
import RecordRTC from 'recordrtc';
const { path, ipcRenderer } = window.electron;
import { useStorage } from '@/composable/storage';

const storage = useStorage('settings');

const state = shallowReactive({
  zoomLevel: (+localStorage.getItem('zoomLevel') || 1).toFixed(1),
});

export default {
  components: { NoteMenuHeadingsTree },
  props: {
    editor: {
      type: Object,
      default: () => ({}),
    },
    tree: {
      type: Boolean,
      default: false,
    },
    id: {
      type: String,
      default: '',
    },
  },
  emits: ['update:tree'],
  setup(props) {
    const headings = [
      { name: 'Paragraphs', id: 'paragraph' },
      { name: 'Header 1', id: 1 },
      { name: 'Header 2', id: 2 },
      { name: 'Header 3', id: 3 },
      { name: 'Header 4', id: 4 },
      { name: 'Header 5', id: 5 },
      { name: 'Header 6', id: 6 },
    ];

    const lists = computed(() => {
      return [
        {
          name: 'ordered-list',
          title: translations.menu.orderedlist,
          icon: 'riListOrdered',
          activeState: 'orderedList',
          handler: () => props.editor.chain().focus().toggleOrderedList().run(),
        },
        {
          name: 'bullet-list',
          title: translations.menu.bulletlist,
          icon: 'riListUnordered',
          activeState: 'bulletList',
          handler: () => props.editor.chain().focus().toggleBulletList().run(),
        },
        {
          name: 'check-list',
          title: translations.menu.checklist,
          icon: 'riListCheck2',
          activeState: 'taskList',
          handler: () => props.editor.chain().focus().toggleTaskList().run(),
        },
        {
          name: 'blockquote',
          title: translations.menu.blockquote,
          icon: 'riDoubleQuotesR',
          activeState: 'blockquote',
          handler: () => props.editor.chain().focus().toggleBlockquote().run(),
        },
        {
          name: 'code-block',
          title: translations.menu.codeblock,
          icon: 'riCodeBoxLine',
          activeState: 'codeBlock',
          handler: () => props.editor.chain().focus().toggleCodeBlock().run(),
        },
      ];
    });
    const isTableActive = computed(() => {
      return (
        props.editor.isActive('tableCell') ||
        props.editor.isActive('tableHeader')
      );
    });
    const textFormatting = computed(() => {
      return [
        {
          name: 'bold',
          title: translations.menu.bold,
          icon: 'riBold',
          activeState: 'bold',
          handler: () => props.editor.chain().focus().toggleBold().run(),
        },
        {
          name: 'italic',
          title: translations.menu.italic,
          icon: 'riItalic',
          activeState: 'italic',
          handler: () => props.editor.chain().focus().toggleItalic().run(),
        },
        {
          name: 'underline',
          title: translations.menu.underline,
          icon: 'riUnderline',
          activeState: 'underline',
          handler: () => props.editor.chain().focus().toggleUnderline().run(),
        },
        {
          name: 'strikethrough',
          title: translations.menu.strikethrough,
          icon: 'riStrikethrough',
          activeState: 'strike',
          handler: () => props.editor.chain().focus().toggleStrike().run(),
        },
        {
          name: 'inline-code',
          title: translations.menu.inlinecode,
          icon: 'riCodeLine',
          activeState: 'code',
          handler: () => props.editor.chain().focus().toggleCode().run(),
        },
      ];
    });

    const store = useStore();
    const noteStore = useNoteStore();
    const router = useRouter();
    const editorImage = useEditorImage(props.editor);
    const dialog = useDialog();

    useGroupTooltip();

    const imgUrl = shallowRef('');
    const fileUrl = shallowRef('');
    const VideoUrl = shallowRef('');
    const EmbedUrl = shallowRef('');
    const headingsTree = shallowRef([]);
    const showHeadingsTree = shallowRef(false);
    function normalizePath(path) {
      return path.replace(/\\/g, '');
    }

    function insertImage() {
      let imgUrlValue = normalizePath(imgUrl.value);
      editorImage.set(imgUrlValue);
      imgUrl.value = '';
      props.editor.commands.focus();
    }

    function insertFile() {
      let fileUrlValue = normalizePath(fileUrl.value);
      const url = fileUrlValue;
      const filename = url.substring(url.lastIndexOf('/') + 1);
      props.editor.commands.setFileEmbed(url, filename);
      fileUrl.value = '';
    }

    function insertVideo() {
      let videoUrlValue = normalizePath(VideoUrl.value);
      const url = videoUrlValue;
      props.editor.commands.setVideo(url);
      VideoUrl.value = '';
    }

    function addIframe() {
      if (EmbedUrl.value.trim() === '') {
        return;
      }

      let trimmedEmbedUrl = EmbedUrl.value.trim(); // Renamed local variable

      // Check if the URL is a YouTube Embed URL in the regular format
      if (trimmedEmbedUrl.includes('youtube.com/watch?v=')) {
        let EmbedId = trimmedEmbedUrl.split('v=')[1];
        const ampersandPosition = EmbedId.indexOf('&');
        if (ampersandPosition !== -1) {
          EmbedId = EmbedId.substring(0, ampersandPosition);
        }
        // Convert to the embed format
        trimmedEmbedUrl = `https://www.youtube.com/embed/${EmbedId}`;
      }

      // Use the value of trimmedEmbedUrl to set the iframe source
      props.editor
        .chain()
        .focus()
        .setIframe({
          src: trimmedEmbedUrl,
        })
        .run();

      // Clear the input field after setting the iframe source
      EmbedUrl.value = '';
    }

    function getHeadingsTree() {
      const editorEl = props.editor.options.element;
      const headingEls = editorEl.querySelectorAll('h1, h2, h3, h4');
      const headingsArr = Array.from(headingEls).map((heading) => ({
        el: heading,
        tag: heading.tagName,
        top: heading.offsetTop,
        text: heading.innerText.slice(0, 120),
      }));

      headingsTree.value = headingsArr;
    }
    const setZoom = (newZoomLevel) => {
      window.electron.ipcRenderer.callMain('app:set-zoom', newZoomLevel);

      state.zoomLevel = newZoomLevel.toFixed(1);
      localStorage.setItem('zoomLevel', state.zoomLevel);
    };

    const handleZoomButtonClick = () => {
      const storedZoomLevel = parseFloat(localStorage.getItem('zoomLevel'));

      if (!isNaN(storedZoomLevel)) {
        setZoom(storedZoomLevel);
      } else {
        console.warn(
          'No valid zoom level found in localStorage. Setting default zoom level.'
        );
        const defaultZoomLevel = 1.0;
        setZoom(defaultZoomLevel);
      }
    };

    function toggleFocusMode() {
      handleZoomButtonClick();
      store.inFocusMode = !store.inFocusMode;

      if (store.inFocusMode) {
        document.documentElement.requestFullscreen();
        props.editor.commands.focus();
      } else {
        document.exitFullscreen();
      }
    }

    function deleteNode() {
      dialog.confirm({
        title: translations.card.confirmPrompt,
        okText: translations.card.confirm,
        cancelText: translations.card.Cancel,
        onConfirm: async () => {
          await noteStore.delete(props.id);
          router.push('/');
        },
      });
    }

    const shortcuts = {
      'mod+alt+h': () => (showHeadingsTree.value = !showHeadingsTree.value),
      'mod+shift+d': deleteNode,
      'mod+shift+f': toggleFocusMode,
      'mod+p': printContent,
    };
    Mousetrap.bind(Object.keys(shortcuts), (event, combo) => {
      shortcuts[combo]();
    });

    onUnmounted(() => {
      Mousetrap.unbind(Object.keys(shortcuts));
    });

    function printContent() {
      window.print();
    }

    const translations = shallowReactive({
      menu: {
        paragraph: 'menu.paragraph',
        heading: 'menu.heading',
        image: 'menu.image',
        imgurl: 'menu.imgurl',
        Embed: 'menu.embed',
        EmbedUrl: 'menu.EmbedUrl',
        record: 'menu.record',
        Link: 'menu.Link',
        File: 'menu.File',
        Print: 'menu.Print',
        Focusmode: 'menu.Focusmode',
        headingsTree: 'menu.headingsTree',
        orderedlist: 'menu.orderedlist',
        bulletlist: 'menu.bulletlist',
        checklist: 'menu.checklist',
        blockquote: 'menu.blockquote',
        codeblock: 'menu.codeblock',
        bold: 'menu.bold',
        italic: 'menu.italic',
        underline: 'menu.underline',
        strikethrough: 'menu.strikethrough',
        inlinecode: 'menu.inlinecode',
        highlight: 'menu.highlight',
        delete: 'menu.delete',
        tableOptions: 'menu.tableOptions',
        tableInsert: 'menu.tableInsert',
        addRowAbove: 'menu.addRowAbove',
        addRowBelow: 'menu.addRowBelow',
        addColumnLeft: 'menu.addColumnLeft',
        addColumnRight: 'menu.addColumnRight',
        deleteRow: 'menu.deleteRow',
        deleteColumn: 'menu.deleteColumn',
        toggleHeader: 'menu.toggleHeader',
        deleteTable: 'menu.deleteTable',
      },
    });

    onMounted(async () => {
      const loadedTranslations = await loadTranslations();
      if (loadedTranslations) {
        Object.assign(translations, loadedTranslations);
      }
      // Add event listeners for drag and drop
      document.addEventListener('drop', handleDrop);
    });

    const loadTranslations = async () => {
      const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
      try {
        const translationModule = await import(
          `../../pages/settings/locales/${selectedLanguage}.json`
        );
        return translationModule.default;
      } catch (error) {
        console.error('Error loading translations:', error);
        return null;
      }
    };

    const showAdavancedSettings = computed(() => {
      return localStorage.getItem('advanced-settings') === 'true';
    });

    const handleFileSelect = async (event) => {
      const files = event.target.files;
      if (!files.length) return;

      try {
        for (const file of files) {
          const { fileName, relativePath } = await saveFile(file, props.id);
          const src = `${relativePath}`; // Construct the complete source path
          props.editor.commands.setFileEmbed(src, fileName);
        }
      } catch (error) {
        console.error(error);
      }
    };

    const handleVideoSelect = async (event) => {
      const files = event.target.files;
      if (!files.length) return;

      try {
        for (const file of files) {
          const { relativePath } = await saveFile(file, props.id);
          const src = `${relativePath}`; // Construct the complete source path
          props.editor.commands.setVideo(src);
        }
      } catch (error) {
        console.error(error);
      }
    };

    // Function to handle drop event
    async function handleDrop(event) {
      // Alt/Opt key is pressed
      event.preventDefault();
      event.stopPropagation();

      // Access dropped files
      const files = event.dataTransfer.files;

      try {
        for (const file of files) {
          // Determine the type of the file
          const mimeType = file.type;

          // Ignore image files
          if (mimeType.startsWith('image/')) {
            continue;
          }

          const { fileName, relativePath } = await saveFile(file, props.id);
          const src = `${relativePath}`; // Construct the complete source path

          if (mimeType.startsWith('audio/')) {
            props.editor.commands.setAudio(src);
          } else if (mimeType.startsWith('video/')) {
            props.editor.commands.setVideo(src);
          } else {
            props.editor.commands.setFileEmbed(src, fileName);
          }
        }
      } catch (error) {
        console.error('Error saving and embedding files:', error);
      }
    }

    const container = ref();
    function changeWheelDirection(e) {
      e.preventDefault();
      if (container.value) {
        container.value.scrollLeft += e.deltaY + e.deltaX;
      }
    }
    const isRecording = ref(false);
    let recorder;
    let recordingStartTime = null;
    let recordingInterval = null;
    let stream = null; // Keep track of the media stream

    const minutes = ref(0);
    const seconds = ref(0);

    const formattedTime = computed(() => {
      return `${String(minutes.value).padStart(2, '0')}:${String(
        seconds.value
      ).padStart(2, '0')}`;
    });

    function generateRandomFilename(extension = 'ogg') {
      const randomString = Math.random().toString(36).substring(2, 15);
      const timestamp = Date.now();
      return `${timestamp}_${randomString}.${extension}`;
    }

    async function toggleRecording() {
      if (isRecording.value) {
        // Stop recording
        recorder.stopRecording(() => {
          const blob = recorder.getBlob();
          const filename = generateRandomFilename('ogg');

          // Process and save the blob
          handleBlob(blob, filename);

          // Clean up
          if (stream) {
            // Stop all tracks in the stream
            stream.getTracks().forEach((track) => {
              track.stop();
            });
            stream = null; // Ensure the stream is nullified
          }
          if (recorder && typeof recorder.destroy === 'function') {
            recorder.destroy();
          }
          recorder = null;
        });

        // Update state
        isRecording.value = false;
        clearInterval(recordingInterval);
        recordingInterval = null;
        minutes.value = 0;
        seconds.value = 0;
      } else {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });

          recorder = RecordRTC(stream, {
            type: 'audio',
            mimeType: 'audio/ogg',
            recorderType: RecordRTC.StereoAudioRecorder,
          });

          recorder.startRecording();
          isRecording.value = true;
          recordingStartTime = Date.now();

          recordingInterval = setInterval(() => {
            if (isRecording.value) {
              const elapsedTime = Math.floor(
                (Date.now() - recordingStartTime) / 1000
              );
              minutes.value = Math.floor(elapsedTime / 60);
              seconds.value = elapsedTime % 60;
            }
          }, 1000);
        } catch (err) {
          console.error('Error accessing media devices.', err);
        }
      }
    }

    async function handleBlob(blob, filename) {
      const dataDir = await storage.get('dataDir');
      const assetsPath = path.join(dataDir, 'file-assets', props.id);
      await ipcRenderer.callMain('fs:ensureDir', assetsPath);
      const destPath = path.join(assetsPath, filename);
      const contentUint8Array = await readFile(blob);
      await ipcRenderer.callMain('fs:writeFile', {
        path: destPath,
        data: contentUint8Array,
      });
      const audioPath = `file-assets://${props.id}/${filename}`;
      props.editor.commands.setAudio(audioPath);
    }

    async function readFile(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result));
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
      });
    }

    onUnmounted(() => {
      if (recordingInterval) {
        clearInterval(recordingInterval);
      }
      if (recorder) {
        if (recorder.stream) {
          // Ensure all tracks are stopped
          recorder.stream.getTracks().forEach((track) => track.stop());
          // Nullify the stream
          recorder.stream = null;
        }
        // Destroy the recorder if applicable
        if (recorder && typeof recorder.destroy === 'function') {
          recorder.destroy();
        }
        recorder = null;
      }
      // Ensure all media streams are closed
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
    });

    const colors = [
      'bg-orange-200 dark:bg-orange-40',
      'bg-yellow-200 dark:bg-yellow-100',
      'bg-green-200 dark:bg-green-100',
      'bg-blue-200 dark:bg-blue-100',
      'bg-purple-200 dark:bg-purple-100',
      'bg-pink-200 dark:bg-pink-100',
      'bg-red-200 dark:bg-red-100',
    ];

    function setHighlightColor(color) {
      props.editor.commands.setHighlight({ color });
    }

    return {
      store,
      colors,
      setHighlightColor,
      lists,
      isTableActive,
      imgUrl,
      EmbedUrl,
      handleFileSelect,
      translations,
      headings,
      insertImage,
      addIframe,
      editorImage,
      headingsTree,
      textFormatting,
      getHeadingsTree,
      toggleFocusMode,
      toggleRecording,
      handleVideoSelect,
      isRecording,
      formattedTime,
      insertFile,
      fileUrl,
      insertVideo,
      VideoUrl,
      deleteNode,
      showAdavancedSettings,
      showHeadingsTree,
      printContent,
      container,
      changeWheelDirection,
    };
  },
  methods: {
    insertTableWithEmptyParagraph() {
      // Insert the table first
      const transaction = this.editor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();

      if (transaction) {
        const pos = this.editor.state.doc.content.size;
        this.editor
          .chain()
          .focus()
          .insertContentAt(pos, {
            type: 'paragraph',
            content: [],
          })
          .run();
      } else {
        console.error('Failed to insert table.');
      }
    },
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
  @apply hover:text-gray-800 dark:hover:text-[color:var(--selected-dark-text)];
}

button.is-active {
  @apply text-primary dark:text-secondary hover:text-primary dark:hover:text-secondary;
}

input[type='number'] {
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    opacity: 1;
  }
}
</style>
