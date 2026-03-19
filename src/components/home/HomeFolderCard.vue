<template>
  <div
    class="relative w-full max-w-[216px] group cursor-pointer transition-all duration-300 active:scale-95"
    style="aspect-ratio: 1 / 1"
    @click="!isRenaming && $router.push(`/folder/${folder.id}`)"
  >
    <!-- Folder background shape -->
    <svg
      class="absolute inset-0 w-full h-full"
      viewBox="0 0 192 192"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="none"
    >
      <path
        :fill="folder.color || '#6366f1'"
        d="M32,0 L80,0 C92,0 95,3 100,15 L160,15 C185,15 192,22 192,45 L192,160 C192,185 175,192 160,192 L32,192 C15,192 0,185 0,160 L0,32 C0,15 15,0 32,0 Z"
        class="transition-colors duration-500"
      />
    </svg>

    <!-- Floating papers -->
    <div
      v-if="itemCount > 1"
      class="absolute w-1/2 h-2/3 bg-white/80 rounded-lg shadow-sm -rotate-12 transition-transform group-hover:-translate-y-3"
      style="bottom: 10%; left: 16.67%"
    ></div>

    <div
      v-if="itemCount > 0"
      class="absolute w-1/2 h-2/3 bg-white rounded-lg shadow-md rotate-6 z-10 transition-transform group-hover:-translate-y-5"
      style="bottom: 10%; left: 33.33%"
    ></div>

    <!-- Folder front panel with content -->
    <div
      class="absolute bottom-0 left-0 w-full border-t border-white/20 rounded-b-[2rem] z-20 flex flex-col justify-between"
      style="height: 58%; padding: 6.25% 8.33%"
      :style="{
        backgroundColor: folder.color ? `${folder.color}f2` : '#4f46e5f2',
      }"
    >
      <div class="flex justify-between items-start gap-2 min-h-0">
        <div class="flex-grow min-w-0 overflow-hidden">
          <div v-if="!isRenaming" class="flex flex-col min-h-0">
            <h3
              class="text-white font-bold text-base sm:text-lg tracking-tight truncate leading-tight"
              @click.stop="startRenaming"
            >
              {{ folder.name || translations.card.untitledFolder }}
            </h3>
            <p class="text-white/70 text-xs font-medium truncate">
              {{ itemCount }} item{{ itemCount !== 1 ? 's' : '' }}
            </p>
          </div>

          <input
            v-else
            ref="renameInput"
            v-model="newName"
            class="w-full bg-white/20 text-white rounded px-1 focus:outline-none font-bold text-base sm:text-lg"
            autofocus
            @click.stop
            @keydown.enter.prevent="saveRename"
            @keydown.esc.prevent="cancelRename"
            @blur="saveRename"
          />
        </div>

        <ui-popover padding="p-3 flex flex-col print:hidden" @click.stop>
          <template #trigger>
            <button
              class="size-8 sm:size-10 aspect-square flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-white flex-shrink-0"
            >
              <span
                v-if="folder.icon"
                class="text-lg sm:text-xl leading-none select-none"
              >
                {{ folder.icon }}
              </span>
              <v-remixicon
                v-else
                name="riFolder5Fill"
                class="size-5 sm:size-6"
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
              <p class="text-xs mt-1">
                {{ translations.card.noEmojisMessage }}
              </p>
            </div>
          </div>
        </ui-popover>
      </div>

      <div
        class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
      >
        <button
          v-tooltip.group="translations.card.moveToFolder"
          class="size-7 sm:size-8 aspect-square flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-lg text-white transition-all"
          @click.stop="showFolderMoveModal = true"
        >
          <v-remixicon name="riFolderTransferLine" class="size-4 sm:size-5" />
        </button>

        <button
          v-tooltip.group="translations.card.delete"
          class="size-7 sm:size-8 aspect-square flex items-center justify-center bg-white/20 hover:bg-red-500/30 rounded-lg text-white hover:text-red-100 transition-all"
          @click.stop="deleteFolder"
        >
          <v-remixicon name="riDeleteBin6Line" class="size-4 sm:size-5" />
        </button>
      </div>
    </div>

    <folder-tree
      v-model="showFolderMoveModal"
      :folders="[folder]"
      mode="folder"
    />
  </div>
</template>

<script setup>
import { useTranslations } from '@/composable/useTranslations';
import { ref, nextTick, computed } from 'vue';
import { useFolderStore } from '@/store/folder';
import { useNoteStore } from '@/store/note';
import { useDialog } from '@/composable/dialog';
import { useGroupTooltip } from '@/composable/groupTooltip';
import FolderTree from './FolderTree.vue';
import emojis from 'emoji.json';

const props = defineProps({
  folder: { type: Object, required: true },
});

const folderStore = useFolderStore();
const noteStore = useNoteStore();
const showFolderMoveModal = ref(false);

useGroupTooltip();

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

const itemCount = computed(() => {
  return noteStore.notes.filter((note) => note.folderId === props.folder.id)
    .length;
});

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
  folderStore.update(props.folder.id, { icon: emoji, color: null });
}

function selectColorIcon(color) {
  folderStore.update(props.folder.id, { color: color, icon: null });
}

function deleteFolder() {
  dialog.confirm({
    title: translations.value.card.confirmPrompt,
    onConfirm: () =>
      folderStore.delete(props.folder.id, { deleteContents: true }),
  });
}

const { translations } = useTranslations();
</script>
