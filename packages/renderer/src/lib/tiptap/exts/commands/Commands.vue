<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <ui-list>
    <ui-list-item
      v-for="(item, index) in filteredItems.slice(0, 5)"
      :key="index"
      :active="index === selectedIndex"
      class="menu-item"
      tag="button"
      :disabled="item.disabled"
      @click="handleItemClick(item)"
    >
      <template v-if="!item.popover && !item.embed">
        <v-remixicon
          :name="item.icon"
          :class="[
            'text-black dark:text-[color:var(--selected-dark-text)] text-xl w-6 h-6 mr-2',
            item.className || '',
          ]"
        />
        <div class="text-left overflow-hidden text-ellipsis whitespace-nowrap">
          <h3
            class="font-medium text-neutral-800 dark:text-[color:var(--selected-dark-text)]"
          >
            {{ translations.menu[item.name] || item.name }}
          </h3>
        </div>
      </template>

      <template v-if="item.popover">
        <!-- your existing popover markup -->
        <input v-model="fileUrl" class="hidden" @keyup.enter="item.action" />
        <label
          for="fileInput"
          class="flex items-center p-2 rounded-lg text-black dark:text-[color:var(--selected-dark-text)] cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700 transition duration-200"
        >
          <v-remixicon
            :name="item.icon"
            class="text-black dark:text-[color:var(--selected-dark-text)] text-xl w-6 h-6 mr-2"
          />
          <div
            class="text-left overflow-hidden text-ellipsis whitespace-nowrap"
          >
            <h3
              class="font-medium text-neutral-800 dark:text-[color:var(--selected-dark-text)]"
            >
              {{ translations.menu[item.name] || item.name }}
            </h3>
          </div>
        </label>
        <input
          id="fileInput"
          ref="fileInput"
          type="file"
          class="hidden"
          multiple
          @change="item.action"
        />
      </template>

      <template v-if="item.embed">
        <div
          class="flex items-center p-2 rounded-lg text-black dark:text-[color:var(--selected-dark-text)] cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700 transition duration-200"
        >
          <input
            v-show="inputVisible"
            v-model="EmbedUrl"
            class="bg-transparent mr-2 flex-1"
            :placeholder="translations.menu.embedUrl || '-'"
            @keyup.enter="addIframe"
          />
          <v-remixicon
            v-show="inputVisible"
            name="riSave3Line"
            class="text-black dark:text-[color:var(--selected-dark-text)] text-xl w-6 h-6"
            @click="addIframe"
          />
          <label
            v-show="!inputVisible"
            class="flex items-center space-x-2 cursor-pointer"
            @click="showInput"
          >
            <v-remixicon
              :name="item.icon"
              class="text-black dark:text-[color:var(--selected-dark-text)] text-xl w-6 h-6"
            />
            <div
              class="text-left overflow-hidden text-ellipsis whitespace-nowrap"
            >
              <h3
                class="font-medium text-neutral-800 dark:text-[color:var(--selected-dark-text)]"
              >
                {{ translations.menu[item.name] || item.name }}
              </h3>
            </div>
          </label>
        </div>
      </template>
    </ui-list-item>
  </ui-list>
</template>

<script>
import {
  onMounted,
  ref,
  reactive,
  shallowRef,
  computed,
  onUnmounted,
} from 'vue';
import Mousetrap from 'mousetrap';
import { useTranslation } from '@/composable/translations';
import { useEditorImage } from '@/composable/editorImage';
import { saveFile } from '@/utils/copy-doc';

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
  },
  setup(props) {
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
      console.log(this.$refs.fileInput);
      this.$refs.fileInput?.click();
    };

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    const filteredItems = computed(() => {
      return items.value.filter((item) =>
        item.name.toLowerCase().includes(props.query.toLowerCase())
      );
    });

    const moveSelection = (direction) => {
      if (direction === 'up') {
        selectedIndex.value =
          (selectedIndex.value - 1 + filteredItems.value.length) %
          filteredItems.value.length;
      } else if (direction === 'down') {
        selectedIndex.value =
          (selectedIndex.value + 1) % filteredItems.value.length;
      }
    };

    onMounted(() => {
      Mousetrap.bind('up', () => moveSelection('up'));
      Mousetrap.bind('down', () => moveSelection('down'));
      Mousetrap.bind('esc', () => {
        props.editor.commands.deleteRange(props.range);
      });
    });

    onUnmounted(() => {
      Mousetrap.unbind('up');
      Mousetrap.unbind('down');
      Mousetrap.unbind('esc');
    });

    const handleItemClick = (item) => {
      item.action();
    };

    const insertTableWithEmptyParagraph = () => {
      const transaction = props.editor
        .chain()
        .focus()
        .deleteRange(props.range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();

      if (transaction) {
        const pos = props.editor.state.doc.content.size;
        props.editor
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
    };

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
        .deleteRange(props.range)
        .setIframe({
          src: trimmedEmbedUrl,
        })
        .run();

      // Clear the input field after setting the iframe source
      EmbedUrl.value = '';
    }

    const handleFileSelect = async (event) => {
      const files = event.target.files;
      if (!files.length) return;

      try {
        for (const file of files) {
          const { fileName, relativePath } = await saveFile(file, props.id);
          const src = `${relativePath}`;
          props.editor.commands.deleteRange(props.range);
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
          props.editor.commands.deleteRange(props.range);
          props.editor.commands.setVideo(src);
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
        action: () =>
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .setParagraph()
            .run(),
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        icon: `riH${i + 1}`,
        name: `heading ${i + 1}`,
        action: () =>
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .toggleHeading({ level: i + 1 })
            .run(),
      })),
      {
        icon: 'riDoubleQuotesR',
        name: 'blockQuote',
        action: () =>
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .toggleBlockquote()
            .run(),
      },
      {
        icon: 'riCodeBoxLine',
        name: 'codeBlock',
        action: () =>
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .toggleCodeBlock()
            .run(),
      },
      {
        icon: 'riTableLine',
        name: 'table',
        action: () => insertTableWithEmptyParagraph(),
      },
      {
        icon: 'riListOrdered',
        name: 'orderedList',
        action: () =>
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .toggleOrderedList()
            .run(),
      },
      {
        icon: 'riListUnordered',
        name: 'bulletList',
        action: () =>
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .toggleBulletList()
            .run(),
      },
      {
        icon: 'riListCheck2',
        name: 'checkList',
        action: () =>
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .toggleTaskList()
            .run(),
      },
      {
        icon: 'riCalculatorLine',
        name: 'mathBlock',
        action: () => {
          props.editor.commands.deleteRange(props.range);
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
        action: () =>
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .setBlackCallout()
            .run(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'blueCallout',
        className: 'text-blue-500 dark:text-blue-500',
        action: () =>
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .setBlueCallout()
            .run(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'greenCallout',
        className: 'text-green-600 dark:text-green-600',
        action: () =>
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .setGreenCallout()
            .run(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'purpleCallout',
        className: 'text-purple-500 dark:text-purple-500',
        action: () =>
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .setPurpleCallout()
            .run(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'redCallout',
        className: 'text-red-500 dark:text-red-500',
        action: () =>
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .setRedCallout()
            .run(),
      },
      {
        icon: 'riSingleQuotesR',
        name: 'yellowCallout',
        className: 'text-yellow-500 dark:text-yellow-500',
        action: () =>
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .setYellowCallout()
            .run(),
      },
      {
        icon: 'riPieChart2Line',
        name: 'mermaid',
        action: () =>
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .setMermaidDiagram()
            .run(),
      },
      {
        icon: 'riBrush3Fill',
        name: 'drawing',
        action: () =>
          props.editor
            .chain()
            .focus()
            .deleteRange(props.range)
            .insertPaper()
            .run(),
      },
      {
        icon: 'riImageLine',
        name: 'image',
        action: () => {
          props.editor.commands.deleteRange(props.range);
          editorImage.select(true);
        },
      },
      {
        icon: 'riFile2Line',
        name: 'file',
        popover: true,
        action: handleFileSelect,
      },
      {
        icon: 'riMovieLine',
        name: 'video',
        popover: true,
        action: handleVideoSelect,
      },
      {
        icon: 'riPagesLine',
        name: 'embed',
        embed: true,
        action: addIframe,
      },
    ]);

    const showInput = () => {
      inputVisible.value = true; // Directly update the ref
    };

    onMounted(() => {
      Mousetrap.bind('up', (e) => {
        e.preventDefault();
        upHandler();
      });
      Mousetrap.bind('down', (e) => {
        e.preventDefault();
        downHandler();
      });
      Mousetrap.bind('enter', (e) => {
        e.preventDefault();
        enterHandler();
      });
      Mousetrap.bind('esc', () => {
        props.editor.commands.deleteRange(props.range);
      });
    });

    onUnmounted(() => {
      Mousetrap.unbind('up');
      Mousetrap.unbind('down');
      Mousetrap.unbind('enter');
      Mousetrap.unbind('esc');
    });

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

    return {
      translations,
      filteredItems,
      EmbedUrl,
      showInput,
      handleItemClick,
      insertTableWithEmptyParagraph,
      fileUrl,
      VideoUrl,
      handleFileSelect,
      handleVideoSelect,
      addIframe,
      handleFileInputClick,
      inputVisible,
      selectedIndex,
    };
  },
};
</script>

<style>
.menu-item.selected {
  @apply bg-neutral-100 dark:bg-neutral-700 rounded-lg;
}
</style>
