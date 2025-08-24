<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <ui-card
    class="border max-w-xs"
    padding="p-2"
    style="max-width: 16rem; min-width: 6rem"
  >
    <ui-list
      class="cursor-pointer space-y-1 overflow-y-auto no-scrollbar"
      style="max-height: calc(5 * 2.5rem)"
    >
      <ui-list-item
        v-for="(item, index) in filteredItems"
        :key="index"
        :active="index === selectedIndex"
        class="label-item w-full text-overflow"
        tag="button"
        :disabled="item.disabled"
        @click="handleItemClick(item)"
      >
        <v-remixicon :name="item.icon" class="mr-2" :class="item.className" />
        <div class="text-left overflow-hidden text-ellipsis whitespace-nowrap">
          <h3 class="font-medium">
            {{ translations.menu[item.name] || item.name }}
          </h3>
        </div>
      </ui-list-item>
    </ui-list>
  </ui-card>
</template>

<script>
import {
  onMounted,
  ref,
  reactive,
  shallowRef,
  computed,
  getCurrentInstance,
} from 'vue';
import { useTranslation } from '@/composable/translations';
import { useEditorImage } from '@/composable/editorImage';
import { saveFile } from '@/utils/copy-doc';

const { ipcRenderer } = window.electron;

export default {
  props: {
    editor: {
      type: Object,
      required: true,
    },
    query: {
      type: String,
      default: '',
    },
    range: {
      type: Object,
      required: true,
    },
    id: {
      type: String,
      default: '',
    },
    command: {
      type: Function,
      required: true,
    },
  },
  setup(props) {
    const instance = getCurrentInstance();
    const editorImage = useEditorImage(props.editor);
    const selectedIndex = ref(0);
    const fileUrl = shallowRef('');
    const VideoUrl = shallowRef('');
    const EmbedUrl = shallowRef('');
    const inputVisible = ref(false);

    const translations = reactive({
      menu: {},
    });

    const handleFileInputClick = () => {
      console.log(instance?.refs.fileInput);
      instance?.refs.fileInput?.click();
    };

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.menu = trans.menu || {};
        }
      });
    });

    const filteredItems = computed(() => {
      return items.value.filter((item) =>
        item.name.toLowerCase().includes(props.query.toLowerCase())
      );
    });

    function onKeyDown({ event }) {
      switch (event.key) {
        case 'ArrowUp':
          upHandler();
          return true;
        case 'ArrowDown':
          downHandler();
          return true;
        case 'Enter':
          enterHandler();
          return true;
        default:
          return false;
      }
    }

    const handleItemClick = (item) => {
      props.command({
        editor: props.editor,
        range: props.range,
        props: {
          action: item.action,
        },
      });
    };

    const handleFileSelect = async () => {
      try {
        const filePaths = await ipcRenderer.callMain('dialog:open', {
          properties: ['openFile', 'multiSelections'],
          filters: [
            {
              name: 'Files',
              extensions: ['pdf', 'docx', 'txt', 'png', 'jpg', 'jpeg'],
            },
          ],
        });

        if (!filePaths || filePaths.length === 0) return;

        for (const path of filePaths) {
          // You might need to adapt saveFile to accept paths instead of File objects
          const { fileName, relativePath } = await saveFile(path, props.id);

          props.command({
            editor: props.editor,
            range: props.range,
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
        const filePaths = await ipcRenderer.callMain('dialog:open', {
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'webm'] }],
        });

        if (!filePaths || filePaths.length === 0) return;

        for (const path of filePaths) {
          const { relativePath } = await saveFile(path, props.id);

          props.command({
            editor: props.editor,
            range: props.range,
            props: {
              action: () => {
                props.editor.commands.setVideo(relativePath);
              },
            },
          });
        }
      } catch (error) {
        console.error(error);
      }
    };

    // List of items to display in the menu
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
        icon: 'riPagesLine',
        name: 'embed',
        action: () => {
          props.editor
            .chain()
            .focus()
            .setIframe({
              src: '',
            })
            .run();
        },
      },
    ]);

    const showInput = () => {
      inputVisible.value = true;
    };

    function upHandler() {
      selectedIndex.value =
        (selectedIndex.value + filteredItems.value.length - 1) %
        filteredItems.value.length;
    }

    function downHandler() {
      selectedIndex.value =
        (selectedIndex.value + 1) % filteredItems.value.length;
    }

    function enterHandler() {
      selectItem(selectedIndex.value);
    }

    function selectItem(index) {
      const item = filteredItems.value[index];
      if (item) {
        handleItemClick(item);
      }
    }

    if (instance) {
      instance.exposed = instance.exposed || {};
      instance.exposed.onKeyDown = onKeyDown;
    }

    return {
      translations,
      filteredItems,
      EmbedUrl,
      showInput,
      handleItemClick,
      fileUrl,
      VideoUrl,
      handleFileSelect,
      handleVideoSelect,
      handleFileInputClick,
      inputVisible,
      selectedIndex,
      onKeyDown,
    };
  },
};
</script>
<style scoped>
/* Hide scrollbar but keep scroll working */
.no-scrollbar {
  scrollbar-width: none !important; /* Firefox */
  -ms-overflow-style: none !important; /* IE and Edge */
}

.no-scrollbar::-webkit-scrollbar {
  display: none !important; /* Chrome, Safari */
}
</style>
