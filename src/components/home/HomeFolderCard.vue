<template>
  <div
    class="folder-card relative group cursor-pointer h-40 w-48"
    @click="!isRenaming && $router.push(`/folder/${folder.id}`)"
  >
    <!-- Tab -->
    <div
      class="absolute top-4 left-0 z-0 h-8 w-16 rounded-tl-xl rounded-tr-md transition-colors"
      :style="{
        backgroundColor: folder.color || '#f59e0b',
        filter: 'saturate(0.8)',
      }"
    ></div>

    <!-- Back panel -->
    <div
      class="absolute top-8 left-0 z-0 h-32 w-full rounded-xl rounded-tl-none transition-colors shadow-sm"
      :style="{
        backgroundColor: folder.color || '#f59e0b',
        filter: 'saturate(0.8)',
      }"
    ></div>

    <!-- Rear sheet -->
    <div
      v-if="itemCount > 1"
      class="folder-card__sheet folder-card__sheet--rear absolute top-6 left-6 z-10 h-24 w-36 rounded-lg border border-neutral-200 dark:border-neutral-200 bg-white p-3 shadow-sm transition-transform duration-300 ease-out"
    >
      <div class="mb-2 h-1 w-full rounded-full bg-gray-100"></div>
      <div class="mb-2 h-1 w-full rounded-full bg-gray-100"></div>
      <div class="h-1 w-2/3 rounded-full bg-gray-100"></div>
    </div>

    <!-- Front sheet -->
    <div
      v-if="itemCount > 0"
      class="folder-card__sheet folder-card__sheet--front absolute top-9 left-9 z-10 h-28 w-36 rotate-2 rounded-lg border border-neutral-200 dark:border-neutral-200 bg-gray-50 p-4 shadow-md transition-transform duration-300 ease-out"
    >
      <div class="mb-3 h-2 w-12 rounded-full bg-blue-400/30"></div>
      <div class="mb-2 h-1 w-full rounded-full bg-gray-200"></div>
      <div class="mb-2 h-1 w-full rounded-full bg-gray-200"></div>
      <div class="h-1 w-4/5 rounded-full bg-gray-200"></div>
    </div>

    <!-- Front body (the "flap" that opens) -->
    <div
      class="folder-card__body absolute bottom-0 left-0 z-20 flex h-28 w-full flex-col justify-between rounded-xl p-3 shadow-sm transition-transform duration-300 ease-out opacity-95"
      :style="{
        background: `linear-gradient(to bottom, ${folder.color || '#fbbf24'}, ${
          folder.color || '#f59e0b'
        })`,
        transformOrigin: 'bottom center',
      }"
    >
      <div class="flex justify-between items-start gap-2">
        <div class="flex-grow min-w-0">
          <div v-if="!isRenaming" class="flex flex-col">
            <h3
              class="text-white font-bold text-sm truncate leading-tight drop-shadow-sm"
              @click.stop="startRenaming"
            >
              {{ folder.name || translations.card.untitledFolder }}
            </h3>
            <p class="text-white/80 text-[10px] font-medium">
              {{ itemCount }} item{{ itemCount !== 1 ? 's' : '' }}
            </p>
          </div>

          <input
            v-else
            ref="renameInput"
            v-model="newName"
            class="w-full bg-white/20 text-white rounded px-1 focus:outline-none font-bold text-sm"
            @click.stop
            @keydown.enter.prevent="saveRename"
            @keydown.esc.prevent="cancelRename"
            @blur="saveRename"
          />
        </div>

        <ui-popover padding="p-3 flex flex-col print:hidden" @click.stop>
          <template #trigger>
            <button
              class="folder-card__icon-button size-7 flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-lg text-white"
            >
              <span v-if="folder.icon" class="text-base leading-none">{{
                folder.icon
              }}</span>
              <v-remixicon v-else name="riFolder5Fill" class="size-4" />
            </button>
          </template>

          <div class="flex mb-4 border-b w-full relative">
            <button
              class="flex-1 px-4 py-2 font-medium text-sm"
              @click="activeTab = 'icon'"
            >
              {{ translations.card.colors }}
            </button>
            <button
              class="flex-1 px-4 py-2 font-medium text-sm"
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
        class="folder-card__actions flex gap-1 opacity-0 group-hover:opacity-100"
      >
        <button
          v-tooltip.group="translations.card.moveToFolder"
          class="folder-card__action size-6 flex items-center justify-center bg-white/20 hover:bg-white/30 rounded text-white"
          @click.stop="showFolderMoveModal = true"
        >
          <v-remixicon name="riFolderTransferLine" class="size-3.5" />
        </button>
        <button
          v-tooltip.group="translations.card.delete"
          class="folder-card__action size-6 flex items-center justify-center bg-white/20 hover:bg-red-500/40 rounded text-white"
          @click.stop="deleteFolder"
        >
          <v-remixicon name="riDeleteBin6Line" class="size-3.5" />
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
import { useRouter } from 'vue-router';
import FolderTree from './FolderTree.vue';
import emojis from 'emoji.json';

const props = defineProps({
  folder: { type: Object, required: true },
  disableOpen: { type: Boolean, default: false },
});

const folderStore = useFolderStore();
const noteStore = useNoteStore();
const router = useRouter();
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

const DEFAULT_FOLDER_COLOR = '#6366f1';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '').trim();
  const fullHex =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => char + char)
          .join('')
      : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(fullHex)) return null;

  return {
    r: parseInt(fullHex.slice(0, 2), 16),
    g: parseInt(fullHex.slice(2, 4), 16),
    b: parseInt(fullHex.slice(4, 6), 16),
  };
}

function toRgba(hex, alpha) {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(99, 102, 241, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function darkenHex(hex, amount = 0.16) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#4f46e5';

  const scale = 1 - amount;
  const toHex = (value) =>
    clamp(Math.round(value * scale), 0, 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

const folderBaseColor = computed(
  () => props.folder.color || DEFAULT_FOLDER_COLOR
);

const folderFrontColor = computed(() => toRgba(folderBaseColor.value, 0.94));

const itemCount = computed(() => {
  return noteStore.notes.filter((note) => note.folderId === props.folder.id)
    .length;
});

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

const folderBackColor = computed(() =>
  toRgba(lightenHex(folderBaseColor.value, 0.18), 0.75)
);

const folderTabColor = computed(() =>
  toRgba(lightenHex(folderBaseColor.value, 0.18), 0.75)
);

function lightenHex(hex, amount = 0.18) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#818cf8';
  const toHex = (value) =>
    clamp(Math.round(value + (255 - value) * amount), 0, 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
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

function handleOpen() {
  if (isRenaming.value || props.disableOpen) return;
  router.push(`/folder/${props.folder.id}`);
}

const { translations } = useTranslations();
</script>

<style scoped>
/* ── Folder open animation on hover ── */

/* Front body flap tilts open */
.folder-card .folder-card__body {
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.folder-card:hover .folder-card__body {
  transform: perspective(800px) rotateX(-6deg) translateY(-2px);
}

/* Paper sheets rise out of the folder */
.folder-card .folder-card__sheet--front {
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.folder-card:hover .folder-card__sheet--front {
  transform: rotate(2deg) translateY(-8px);
}

.folder-card .folder-card__sheet--rear {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.folder-card:hover .folder-card__sheet--rear {
  transform: translateY(-5px);
}

/* Subtle scale-up on the whole card for a polished feel */
.folder-card {
  transition: transform 0.3s ease;
}

.folder-card:hover {
  transform: translateY(-2px);
}
</style>
