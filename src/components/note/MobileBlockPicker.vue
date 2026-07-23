<template>
  <ui-modal v-model="show" content-class="max-w-lg mobile:max-w-full" blur>
    <div class="p-2 pb-safe">
      <div class="flex items-center gap-2 pb-2 mb-1">
        <ui-input
          v-model="searchQuery"
          type="text"
          clearable
          class="flex-1 bg-transparent text-sm outline-none text-neutral-800 dark:text-white placeholder:text-neutral-400"
          :placeholder="translations.menu.searchBlocks || 'Search blocks'"
          prependIcon="riSearchLine"
          @keydown.stop
        />
      </div>

      <!-- Tile grid -->
      <div
        class="grid grid-cols-3 sm:grid-cols-4 gap-2 overflow-y-auto no-scrollbar max-h-[50vh]"
      >
        <button
          v-for="(item, index) in filteredItems"
          :key="index"
          class="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-700 active:bg-neutral-100 dark:active:bg-neutral-600 transition-colors"
          :disabled="item.disabled"
          @click="handleItemClick(item)"
        >
          <div class="flex items-center justify-center w-10 h-10">
            <v-remixicon
              :name="item.icon"
              class="text-lg"
              :class="
                item.className || 'text-neutral-700 dark:text-neutral-300'
              "
            />
          </div>
          <span
            class="text-[10px] leading-tight text-center text-neutral-600 dark:text-neutral-400 truncate w-full"
          >
            {{ translations.menu[item.name] || item.name }}
          </span>
        </button>
      </div>
    </div>
  </ui-modal>
</template>

<script>
import { computed, ref } from 'vue';
import mime from 'mime';
import dayjs from '@/lib/dayjs';
import { getSettingSync } from '@/composable/settings';
import { useTranslations } from '@/composable/useTranslations';
import { useEditorImage } from '@/composable/editorImage';
import { saveFile } from '@/utils/assets/storage.js';
import { openDialog } from '@/lib/native/dialog';

export default {
  props: {
    modelValue: { type: Boolean, default: false },
    editor: { type: Object, required: true },
    id: { type: String, default: '' },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const { translations } = useTranslations();
    const editorImage = useEditorImage(props.editor);
    const searchQuery = ref('');

    const show = computed({
      get: () => props.modelValue,
      set: (val) => {
        if (!val) searchQuery.value = '';
        emit('update:modelValue', val);
      },
    });

    const cursorPos = computed(() => {
      return props.editor?.state?.selection?.from || 0;
    });

    const range = computed(() => ({
      from: cursorPos.value,
      to: cursorPos.value,
    }));

    const handleFileSelect = async () => {
      try {
        const { canceled, filePaths = [] } = await openDialog({
          properties: ['openFile', 'multiSelections'],
        });

        if (canceled || filePaths.length === 0) return;

        for (const path of filePaths) {
          const { fileName, relativePath } = await saveFile(path, props.id);

          command({
            editor: props.editor,
            range: range.value,
            props: {
              action: () => {
                props.editor.commands.setFileEmbed(relativePath, fileName);
              },
            },
          });
        }
      } catch (error) {
        console.error(error);
      }
    };

    const handleVideoSelect = async () => {
      try {
        const { canceled, filePaths = [] } = await openDialog({
          properties: ['openFile', 'multiSelections'],
        });

        if (canceled || !filePaths.length) return;

        for (const path of filePaths) {
          const { relativePath } = await saveFile(path, props.id);
          const type = mime.getType(path) || '';

          if (type.startsWith('video/')) {
            command({
              editor: props.editor,
              range: range.value,
              props: {
                action: () => props.editor.commands.setVideo(relativePath),
              },
            });
          }
        }
      } catch (error) {
        console.error(error);
      }
    };

    const handleAudioSelect = async () => {
      try {
        const { canceled, filePaths = [] } = await openDialog({
          properties: ['openFile', 'multiSelections'],
        });

        if (canceled || !filePaths.length) return;

        for (const path of filePaths) {
          const { fileName, relativePath } = await saveFile(path, props.id);
          const type = mime.getType(path) || '';

          if (type.startsWith('audio/')) {
            command({
              editor: props.editor,
              range: range.value,
              props: {
                action: () =>
                  props.editor.commands.setAudio(relativePath, fileName),
              },
            });
          }
        }
      } catch (error) {
        console.error(error);
      }
    };

    const items = ref([
      {
        icon: 'riParagraph',
        name: 'paragraph',
        action: () => props.editor.chain().focus().setParagraph().run(),
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        icon: `riH${i + 1}`,
        name: `heading ${i + 1}`,
        action: () =>
          props.editor
            .chain()
            .focus()
            .toggleHeading({ level: i + 1 })
            .run(),
      })),
      {
        icon: 'riDoubleQuotesR',
        name: 'blockQuote',
        action: () => props.editor.chain().focus().toggleBlockquote().run(),
      },
      {
        icon: 'riCodeBoxLine',
        name: 'codeBlock',
        action: () => props.editor.chain().focus().toggleCodeBlock().run(),
      },
      {
        icon: 'riTableLine',
        name: 'table',
        action: () =>
          props.editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run(),
      },
      {
        icon: 'riListOrdered',
        name: 'orderedList',
        action: () => props.editor.chain().focus().toggleOrderedList().run(),
      },
      {
        icon: 'riListUnordered',
        name: 'bulletList',
        action: () => props.editor.chain().focus().toggleBulletList().run(),
      },
      {
        icon: 'riListCheck2',
        name: 'checkList',
        action: () => props.editor.chain().focus().toggleTaskList().run(),
      },
      {
        icon: 'riCalculatorLine',
        name: 'mathBlock',
        action: () => {
          props.editor.commands.insertMathBlock({
            content: '',
            macros: '{\\f: "#1f(#2)"}',
          });
        },
      },
      {
        icon: 'riSingleQuotesR',
        name: 'blackCallout',
        className: 'dark:text-neutral-400',
        action: () => props.editor.chain().focus().setBlackCallout().run(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'blueCallout',
        className: 'text-blue-500 dark:text-blue-500',
        action: () => props.editor.chain().focus().setBlueCallout().run(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'greenCallout',
        className: 'text-green-600 dark:text-green-600',
        action: () => props.editor.chain().focus().setGreenCallout().run(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'purpleCallout',
        className: 'text-purple-500 dark:text-purple-500',
        action: () => props.editor.chain().focus().setPurpleCallout().run(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'redCallout',
        className: 'text-red-500 dark:text-red-500',
        action: () => props.editor.chain().focus().setRedCallout().run(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'yellowCallout',
        className: 'text-yellow-500 dark:text-yellow-500',
        action: () => props.editor.chain().focus().setYellowCallout().run(),
      },
      {
        icon: 'riPieChart2Line',
        name: 'mermaid',
        action: () => props.editor.chain().focus().setMermaidDiagram().run(),
      },
      {
        icon: 'riBrush3Fill',
        name: 'drawing',
        action: () => props.editor.chain().focus().insertPaper().run(),
      },
      {
        icon: 'riImageLine',
        name: 'image',
        action: () => {
          editorImage.select(true);
        },
      },
      {
        icon: 'riFile2Line',
        name: 'file',
        action: () => {
          handleFileSelect();
        },
      },
      {
        icon: 'riMovieLine',
        name: 'video',
        action: () => {
          handleVideoSelect();
        },
      },
      {
        icon: 'riMicLine',
        name: 'audio',
        action: () => {
          handleAudioSelect();
        },
      },
      {
        icon: 'riCalendarLine',
        name: 'todayDate',
        action: () => {
          const customFormat = getSettingSync('todayDateFormat');
          props.editor
            .chain()
            .focus()
            .insertContent(dayjs().format(customFormat))
            .run();
        },
      },
      {
        icon: 'riTimerLine',
        name: 'currentTime',
        action: () => {
          const customFormat = getSettingSync('timeFormat');
          props.editor
            .chain()
            .focus()
            .insertContent(dayjs().format(customFormat))
            .run();
        },
      },
      {
        icon: 'riLayoutColumnLine',
        name: 'columns',
        action: () => props.editor.chain().focus().insertMultiColumn(2).run(),
      },
    ]);

    const filteredItems = computed(() => {
      return items.value.filter((item) =>
        item.name.toLowerCase().includes(searchQuery.value.toLowerCase())
      );
    });

    const command = ({ props: cmdProps }) => {
      cmdProps.action();
      show.value = false;
    };

    const handleItemClick = (item) => {
      command({
        editor: props.editor,
        range: range.value,
        props: {
          action: item.action,
        },
      });
    };

    return {
      show,
      searchQuery,
      filteredItems,
      handleItemClick,
      translations,
    };
  },
};
</script>
