<template>
  <div
    class="relative w-48 h-48 group cursor-pointer transition-all duration-300 active:scale-95"
    @click="!isRenaming && $router.push(`/folder/${folder.id}`)"
  >
    <div
      class="absolute inset-0 transition-colors duration-500"
      :style="{
        backgroundColor: folder.color || '#6366f1',
        maskImage: 'url(#folder-mask)',
        webkitMaskImage: 'url(#folder-mask)',
        maskRepeat: 'no-repeat',
        webkitMaskRepeat: 'no-repeat',
      }"
    ></div>

    <div
      class="absolute bottom-[45%] left-8 w-24 h-16 bg-white/80 rounded-lg shadow-sm -rotate-12 transition-transform group-hover:-translate-y-3"
    ></div>
    <div
      class="absolute bottom-[45%] left-16 w-24 h-16 bg-white rounded-lg shadow-md rotate-6 z-10 transition-transform group-hover:-translate-y-5"
    ></div>

    <div
      class="absolute bottom-0 left-0 w-full h-[58%] border-t border-white/20 rounded-b-[2rem] z-20 px-4 py-3 flex flex-col justify-between"
      :style="{
        backgroundColor: folder.color ? `${folder.color}f2` : '#4f46e5f2',
      }"
    >
      <div class="flex justify-between items-start">
        <div class="flex-grow min-w-0 pr-1">
          <div v-if="!isRenaming" class="flex flex-col">
            <h3
              class="text-white font-bold text-lg tracking-tight truncate leading-tight"
              @click.stop="startRenaming"
            >
              {{ folder.name || translations.card.untitledFolder }}
            </h3>
            <p class="text-white/70 text-xs font-medium">Items</p>
          </div>

          <input
            v-else
            ref="renameInput"
            v-model="newName"
            class="w-full bg-white/20 text-white rounded px-1 focus:outline-none font-bold text-lg"
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
              class="size-10 aspect-square flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-white"
            >
              <span v-if="folder.icon" class="text-xl leading-none select-none">
                {{ folder.icon }}
              </span>
              <v-remixicon v-else name="riFolder5Fill" class="size-6" />
            </button>
          </template>

          <div
            class="flex mb-4 border-b border-neutral-200 dark:border-neutral-700 w-full relative"
          >
            <button
              class="flex-1 px-4 py-2 font-medium text-sm transition-colors"
              @click="activeTab = 'icon'"
            >
              Colors
            </button>
            <button
              class="flex-1 px-4 py-2 font-medium text-sm transition-colors"
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
              class="p-2 rounded-lg hover:bg-neutral-100"
              @click="selectColorIcon(color)"
            >
              <v-remixicon
                name="riFolder5Fill"
                class="w-6 h-6"
                :style="{ color: color }"
              />
            </button>
          </div>

          <div v-if="activeTab === 'emoji'" class="w-80">
            <div class="mb-3">
              <ui-input
                v-model="searchQuery"
                class="w-full"
                prepend-icon="riSearch2Line"
                placeholder="Search..."
                @change="searchQuery = $event.toLowerCase()"
              />
            </div>
            <div class="grid grid-cols-8 gap-1 max-h-64 overflow-auto">
              <button
                v-for="emoji in filteredEmojis"
                :key="emoji.char"
                class="text-xl p-2 hover:bg-neutral-100 rounded-md"
                @click="selectEmoji(emoji.char)"
              >
                {{ emoji.char }}
              </button>
            </div>
          </div>
        </ui-popover>
      </div>

      <div
        class="flex opacity-0 group-hover:opacity-100 transition-opacity duration-300"
      >
        <div class="flex gap-1">
          <button
            class="size-8 aspect-square flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-lg text-white transition-all"
            @click.stop="showFolderMoveModal = true"
          >
            <v-remixicon name="riFolderTransferLine" class="size-5" />
          </button>

          <button
            class="size-8 aspect-square flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-lg text-white transition-all"
            @click.stop="deleteFolder"
          >
            <v-remixicon name="riDeleteBin6Line" class="size-5" />
          </button>
        </div>
      </div>
    </div>

    <svg width="0" height="0" class="absolute">
      <defs>
        <mask id="folder-mask">
          <path
            fill="white"
            d="M32,0 L80,0 C92,0 95,3 100,15 L160,15 C185,15 192,22 192,45 L192,160 C192,185 175,192 160,192 L32,192 C15,192 0,185 0,160 L0,32 C0,15 15,0 32,0 Z"
          />
        </mask>
      </defs>
    </svg>

    <folder-tree
      v-model="showFolderMoveModal"
      :folders="[folder]"
      mode="folder"
    />
  </div>
</template>

<script setup>
/* All logic preserved from your original script */
import { useTranslations } from '@/composable/useTranslations';
import { ref, nextTick, computed } from 'vue';
import { useFolderStore } from '@/store/folder';
import { useDialog } from '@/composable/dialog';
import FolderTree from './FolderTree.vue';
import emojis from 'emoji.json';

const props = defineProps({
  folder: { type: Object, required: true },
});

const folderStore = useFolderStore();
const showFolderMoveModal = ref(false);
const iconColors = [
  '#ffba00',
  '#c27aff',
  '#fb64b6',
  '#fb2c36',
  '#51a2ff',
  '#a1a1a1',
  '#00bc7d',
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
  { name: 'Food & Drink', icon: 'riCake3Line', groups: ['Food & Drink'] },
  { name: 'Travel & Places', icon: 'riPlaneLine', groups: ['Travel & Places'] },
  { name: 'Activities', icon: 'riFootballLine', groups: ['Activities'] },
  { name: 'Objects', icon: 'riLightbulbLine', groups: ['Objects'] },
  { name: 'Symbols & Flags', icon: 'riFlagLine', groups: ['Symbols', 'Flags'] },
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
        return category.groups.includes(mainGroup);
      });
    }
  }
  const seen = new Set();
  return filtered.filter((emoji) => {
    const normalized = emoji.char.normalize('NFC').replace(/\uFE0F/g, '');
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
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
  folderStore.update(props.folder.id, { icon: emoji });
}

function selectColorIcon(color) {
  folderStore.update(props.folder.id, { color: color });
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

<style scoped>
.rounded-t-none {
  border-top-left-radius: 0 !important;
  border-top-right-radius: 0 !important;
}
</style>
