<template>
  <div
    class="bg-neutral-50 dark:bg-neutral-700/50 transform rounded-xl transition-transform ui-card overflow-hidden hover:ring-2 ring-secondary group note-card transition flex flex-row items-center p-3"
  >
    <!-- Emoji / Icon selector -->
    <ui-popover padding="p-3 flex flex-col print:hidden">
      <template #trigger>
        <button
          v-tooltip.group="folder.icon"
          class="transition hoverable h-10 w-10 rounded-lg flex items-center justify-center bg-neutral-100 dark:bg-neutral-700"
        >
          <span v-if="folder.icon" class="text-2xl select-none">{{
            folder.icon
          }}</span>
          <v-remixicon
            v-else
            name="riFolder3Line"
            class="w-6 h-6"
            :style="{ color: folder.color || '#6B7280' }"
          />
        </button>
      </template>

      <!-- Tab Headers -->
      <div
        class="flex mb-4 border-b border-neutral-200 dark:border-neutral-700"
      >
        <button
          class="px-4 py-2 font-medium text-sm transition-colors"
          :class="{
            'border-b-2 border-primary text-primary': activeTab === 'icon',
            'text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200':
              activeTab !== 'icon',
          }"
          @click="activeTab = 'icon'"
        >
          Colors
        </button>
        <button
          class="px-4 py-2 font-medium text-sm transition-colors"
          :class="{
            'border-b-2 border-primary text-primary': activeTab === 'emoji',
            'text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200':
              activeTab !== 'emoji',
          }"
          @click="activeTab = 'emoji'"
        >
          Emojis
        </button>
      </div>

      <!-- Color Icons Grid -->
      <div v-if="activeTab === 'icon'" class="grid grid-cols-6 gap-2">
        <button
          v-for="color in iconColors"
          :key="color"
          class="w-10 h-10 rounded-lg flex items-center justify-center hover:ring-2 hover:ring-neutral-300 transition-all duration-200 hover:scale-105"
          @click="selectColorIcon(color)"
        >
          <v-remixicon
            name="riFolder3Line"
            class="w-5 h-5"
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
            placeholder="Search emojis..."
            @keydown.esc="$event.target.blur()"
            @change="searchQuery = $event.toLowerCase()"
          />
        </div>

        <!-- Category Filters -->
        <div v-if="!searchQuery" class="flex flex-wrap gap-1 mb-3">
          <button
            v-for="category in emojiCategories"
            :key="category.name"
            :class="{
              'bg-primary text-white': selectedCategory === category.name,
              'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700':
                selectedCategory !== category.name,
            }"
            class="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200"
            @click="
              selectedCategory =
                selectedCategory === category.name ? null : category.name
            "
          >
            <span class="text-sm">{{ category.icon }}</span>
            <span>{{ category.name }}</span>
          </button>
        </div>

        <!-- Emoji Grid -->
        <div class="grid grid-cols-8 gap-1 max-h-64 overflow-auto">
          <button
            v-for="emoji in filteredEmojis"
            :key="emoji.char"
            class="text-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 p-2 rounded-md transition-colors duration-150 relative group"
            :title="emoji.name"
            @click="selectEmoji(emoji.char)"
          >
            {{ emoji.char }}
          </button>
        </div>

        <!-- No results message -->
        <div
          v-if="filteredEmojis.length === 0"
          class="text-center py-8 text-neutral-500 dark:text-neutral-400"
        >
          <v-remixicon
            name="riEmotionUnhappyFill"
            class="w-8 h-8 mx-auto mb-2 opacity-50"
          />
          <p class="text-sm">No emojis found</p>
          <p class="text-xs mt-1">Try a different search term or category</p>
        </div>
      </div>
    </ui-popover>

    <!-- Folder Name -->
    <div class="flex flex-col flex-grow min-w-0 ml-2">
      <router-link
        v-if="!isRenaming"
        :to="`/folder/${folder.id}`"
        class="block group truncate font-medium hover:text-primary transition-colors"
        @dblclick.prevent="startRenaming"
      >
        {{ folder.name }}
      </router-link>

      <input
        v-else
        ref="renameInput"
        v-model="newName"
        class="flex-1 bg-transparent border-b-2 border-primary focus:outline-none font-medium"
        autofocus
        @keydown.enter.prevent="saveRename"
        @keydown.esc.prevent="cancelRename"
        @blur="saveRename"
      />
    </div>

    <!-- Actions -->
    <div
      class="flex z-10 items-center text-neutral-600 dark:text-neutral-200 gap-2"
    >
      <!-- Rename -->
      <button
        v-tooltip.group="'Rename'"
        type="button"
        class="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
        @click="startRenaming"
      >
        <v-remixicon name="riEditLine" />
      </button>

      <button
        v-tooltip.group="'Move to Folder'"
        class="hover:text-neutral-900 dark:hover:text-[color:var(--selected-dark-text)] transition invisible group-hover:visible"
        @click="showFolderMoveModal = true"
      >
        <v-remixicon name="riFolderTransferLine" />
      </button>

      <button
        v-tooltip.group="'Duplicate'"
        type="button"
        class="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
        @click="duplicateFolder"
      >
        <v-remixicon name="riFoldersLine" />
      </button>

      <!-- Delete -->
      <button
        v-tooltip.group="'Delete'"
        type="button"
        class="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 hover:text-red-600 transition-colors"
        @click="deleteFolder"
      >
        <v-remixicon name="riDeleteBin6Line" />
      </button>
    </div>

    <folder-tree v-model="showFolderMoveModal" :folder="folder" mode="folder" />
  </div>
</template>

<script setup>
import { ref, nextTick, computed } from 'vue';
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
  { name: 'Smileys & Emotion', icon: '😀', group: 'Smileys & Emotion' },
  { name: 'People & Body', icon: '👤', group: 'People & Body' },
  { name: 'Animals & Nature', icon: '🐾', group: 'Animals & Nature' },
  { name: 'Food & Drink', icon: '🍎', group: 'Food & Drink' },
  { name: 'Travel & Places', icon: '✈️', group: 'Travel & Places' },
  { name: 'Activities', icon: '⚽', group: 'Activities' },
  { name: 'Objects', icon: '💡', group: 'Objects' },
  { name: 'Symbols', icon: '❤️', group: 'Symbols' },
  { name: 'Flags', icon: '🏳️', group: 'Flags' },
];

const dialog = useDialog();
const activeTab = ref('icon');
const isRenaming = ref(false);
const newName = ref(props.folder.name);
const renameInput = ref(null);
const searchQuery = ref('');
const selectedCategory = ref(null);

const filteredEmojis = computed(() => {
  let filtered = emojis;

  // Filter by search query
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    filtered = emojis.filter((emoji) =>
      emoji.name.toLowerCase().includes(query)
    );
  }
  // Filter by category using the actual group property
  else if (selectedCategory.value) {
    const category = emojiCategories.find(
      (cat) => cat.name === selectedCategory.value
    );
    if (category) {
      filtered = emojis.filter((emoji) => emoji.group === category.group);
    }
  }

  return filtered.slice(0, 200); // Limit results for performance
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
    color: null, // Remove color when emoji is selected
  });
}

function selectColorIcon(color) {
  folderStore.update(props.folder.id, {
    color: color,
    icon: null, // Remove emoji when color is selected
  });
}

function duplicateFolder() {
  folderStore.duplicate(props.folder.id, {
    includeChildren: true,
  });
}

function deleteFolder() {
  dialog.confirm({
    title: 'Delete Folder?',
    body: 'Are you sure you want to delete this folder and its contents?',
    onConfirm: () =>
      folderStore.delete(props.folder.id, { deleteContents: true }),
  });
}
</script>

<style scoped>
.folder-card {
  min-width: 320px;
}

.folder-card:hover .group-hover\:opacity-100 {
  opacity: 1;
}
</style>
