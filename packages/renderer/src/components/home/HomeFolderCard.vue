<template>
  <div
    class="bg-neutral-50 dark:bg-neutral-750 transform rounded-xl transition-transform ui-card overflow-hidden hover:ring-2 hover:ring-secondary group note-card transition flex flex-row items-center p-3"
  >
    <ui-popover padding="p-3 flex flex-col print:hidden">
      <template #trigger>
        <button
          class="transition hoverable h-10 w-10 rounded-lg flex items-center justify-center bg-neutral-100 dark:bg-neutral-700"
        >
          <span v-if="folder.icon" class="text-2xl select-none">{{
            folder.icon
          }}</span>
          <v-remixicon
            v-else
            name="riFolder5Fill"
            class="w-6 h-6"
            :style="{ color: folder.color || '#6B7280' }"
          />
        </button>
      </template>

      <div
        class="flex mb-4 border-b border-neutral-200 dark:border-neutral-700 w-full relative"
      >
        <button
          class="flex-1 px-4 py-2 font-medium text-sm transition-colors relative"
          @click="activeTab = 'icon'"
        >
          {{ translations.card.colors }}
        </button>
        <button
          class="flex-1 px-4 py-2 font-medium text-sm transition-colors relative"
          :class="{
            'text-primary': activeTab === 'emoji',
            'text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200':
              activeTab !== 'emoji',
          }"
          @click="activeTab = 'emoji'"
        >
          Emojis
        </button>

        <div
          class="absolute bottom-0 h-0.5 bg-primary transition-all duration-300"
          :style="{
            width: '50%',
            left: activeTab === 'icon' ? '0%' : '50%',
          }"
        ></div>
      </div>

      <div v-if="activeTab === 'icon'" class="grid grid-cols-4 gap-2">
        <button
          v-for="color in iconColors"
          :key="color"
          class="p-2 rounded-lg flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800"
          @click="selectColorIcon(color)"
        >
          <v-remixicon
            name="riFolder5Fill"
            class="w-6 h-6"
            :style="{ color: color }"
          />
        </button>
      </div>

      <!-- Emoji Section -->
      <div v-if="activeTab === 'emoji'" class="w-80">
        <!-- Search Bar -->
        <div class="mb-3">
          <ui-input
            :model-value="searchQuery"
            class="w-full note-search-input"
            prepend-icon="riSearch2Line"
            :clearable="true"
            :placeholder="translations.index.search"
            @keydown.esc="$event.target.blur()"
            @change="searchQuery = $event.toLowerCase()"
          />
        </div>

        <div
          v-if="!searchQuery"
          class="flex flex-wrap gap-1 mb-3 justify-center"
        >
          <button
            v-for="category in emojiCategories"
            :key="category.name"
            :class="{
              'bg-primary text-white': selectedCategory === category.name,
              'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700':
                selectedCategory !== category.name,
            }"
            class="flex items-center gap-2 p-2 rounded-full text-xs font-medium transition-all duration-200"
            @click="
              selectedCategory =
                selectedCategory === category.name ? null : category.name
            "
          >
            <v-remixicon :name="category.icon" />
          </button>
        </div>

        <div class="grid grid-cols-8 gap-1 max-h-64 overflow-auto">
          <button
            v-for="emoji in filteredEmojis"
            :key="emoji.char"
            class="text-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 p-2 rounded-md transition-colors duration-150 relative group"
            style="
              font-family: 'Apple Color Emoji', 'Segoe UI Emoji',
                'Noto Color Emoji', 'Twemoji', sans-serif;
            "
            :title="emoji.name"
            @click="selectEmoji(emoji.char)"
          >
            {{ emoji.char }}
          </button>
        </div>

        <div
          v-if="filteredEmojis.length === 0"
          class="text-center py-8 text-neutral-500 dark:text-neutral-400"
        >
          <v-remixicon
            name="riEmotionUnhappyFill"
            class="w-8 h-8 mx-auto mb-2 opacity-50"
          />
          <p class="text-sm">{{ translations.card.noEmojis }}</p>
          <p class="text-xs mt-1">{{ translations.card.noEmojisMessage }}</p>
        </div>
      </div>
    </ui-popover>

    <div class="flex flex-col flex-grow min-w-0 ml-2">
      <router-link
        v-if="!isRenaming"
        :to="`/folder/${folder.id}`"
        class="block group truncate font-medium hover:text-primary transition-colors"
        @dblclick.prevent="startRenaming"
      >
        {{ folder.name || translations.card.untitledFolder }}
      </router-link>

      <input
        v-else
        ref="renameInput"
        v-model="newName"
        class="flex-1 bg-transparent focus:outline-none font-medium"
        autofocus
        @keydown.enter.prevent="saveRename"
        @keydown.esc.prevent="cancelRename"
        @blur="saveRename"
      />
    </div>

    <div
      class="flex z-10 items-center text-neutral-600 dark:text-neutral-200 gap-2"
    >
      <button
        v-tooltip.group="translations.card.rename"
        type="button"
        class="hover:text-neutral-900 dark:hover:text-[color:var(--selected-dark-text)] transition invisible group-hover:visible"
        @click="startRenaming"
      >
        <v-remixicon name="riEditLine" />
      </button>

      <button
        v-tooltip.group="translations.card.moveToFolder"
        class="hover:text-neutral-900 dark:hover:text-[color:var(--selected-dark-text)] transition invisible group-hover:visible"
        @click="showFolderMoveModal = true"
      >
        <v-remixicon name="riFolderTransferLine" />
      </button>

      <button
        v-tooltip.group="translations.card.delete"
        type="button"
        class="hover:text-red-500 rtl: dark:hover:text-red-400 transition invisible group-hover:visible"
        @click="deleteFolder"
      >
        <v-remixicon name="riDeleteBin6Line" />
      </button>
    </div>

    <folder-tree
      v-model="showFolderMoveModal"
      :folders="[folder]"
      mode="folder"
    />
  </div>
</template>

<script setup>
import { useTranslation } from '@/composable/translations';
import { ref, nextTick, computed, onMounted } from 'vue';
import { useFolderStore } from '@/store/folder';
import { useDialog } from '@/composable/dialog';
import FolderTree from './FolderTree.vue';
import emojis from 'emoji.json';

const props = defineProps({
  folder: {
    type: Object,
    required: true,
  },
});

const folderStore = useFolderStore();

const showFolderMoveModal = ref(false);

const iconColors = [
  '#ffba00', // Amber
  '#c27aff', // Purple
  '#fb64b6', // Pink
  '#fb2c36', // Red
  '#51a2ff', // Blue
  '#a1a1a1', // Neutral
  '#00bc7d', // Green
];

const emojiCategories = [
  {
    name: 'Smileys & Emotion',
    icon: 'riEmotionLine',
    groups: ['Smileys & Emotion', 'People & Body'],
  },
  {
    name: 'Animals & Nature',
    icon: 'riLeafLine',
    groups: ['Animals & Nature'],
  },
  {
    name: 'Food & Drink',
    icon: 'riCake3Line',
    groups: ['Food & Drink'],
  },
  {
    name: 'Travel & Places',
    icon: 'riPlaneLine',
    groups: ['Travel & Places'],
  },
  {
    name: 'Activities',
    icon: 'riFootballLine',
    groups: ['Activities'],
  },
  {
    name: 'Objects',
    icon: 'riLightbulbLine',
    groups: ['Objects'],
  },
  {
    name: 'Symbols & Flags',
    icon: 'riFlagLine',
    groups: ['Symbols', 'Flags'],
  },
];

const dialog = useDialog();
const activeTab = ref('icon');
const isRenaming = ref(false);
const newName = ref(props.folder.name);
const renameInput = ref(null);
const searchQuery = ref('');
const selectedCategory = ref(null);

const filteredEmojis = computed(() => {
  let filtered = emojis; // assuming emojis is a plain array, not a ref

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    filtered = filtered.filter((emoji) =>
      emoji.name.toLowerCase().includes(query)
    );
  } else if (selectedCategory.value) {
    const category = emojiCategories.find(
      (cat) => cat.name === selectedCategory.value
    );
    if (category) {
      filtered = filtered.filter((emoji) => {
        const mainGroup = (emoji.group || '').split(' (')[0];
        const inGroup = category.groups.includes(mainGroup);
        const inSubgroup = category.subgroups
          ? category.subgroups.includes(emoji.subgroup || '')
          : true;
        return inGroup && inSubgroup;
      });
    }
  }

  const seen = new Set();
  filtered = filtered.filter((emoji) => {
    const normalized = emoji.char.normalize('NFC').replace(/\uFE0F/g, '');
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  return filtered;
});

function startRenaming() {
  newName.value = props.folder.name;
  isRenaming.value = true;
  nextTick(() => {
    renameInput.value?.focus();
    renameInput.value?.select();
  });
}

function saveRename() {
  if (!newName.value.trim()) {
    newName.value = props.folder.name;
  } else if (newName.value !== props.folder.name) {
    folderStore.update(props.folder.id, { name: newName.value.trim() });
  }
  isRenaming.value = false;
}

function cancelRename() {
  isRenaming.value = false;
  newName.value = props.folder.name;
}

function selectEmoji(emoji) {
  folderStore.update(props.folder.id, {
    icon: emoji,
    color: null,
  });
}

function selectColorIcon(color) {
  folderStore.update(props.folder.id, {
    color: color,
    icon: null,
  });
}

function deleteFolder() {
  dialog.confirm({
    title: translations.value.card.confirmPrompt,
    onConfirm: () =>
      folderStore.delete(props.folder.id, { deleteContents: true }),
  });
}

const translations = ref({
  card: {},
  inxed: {},
});

onMounted(async () => {
  await useTranslation().then((trans) => {
    if (trans) {
      translations.value = trans;
    }
  });
});
</script>

<style scoped>
.folder-card {
  min-width: 320px;
}

.folder-card:hover .group-hover\:opacity-100 {
  opacity: 1;
}
</style>
