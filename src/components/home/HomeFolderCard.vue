<template>
  <div
    :class="{
      'is-drag-over': isDragOver,
      'folder-card': true,
      relative: true,
      group: true,
      'cursor-pointer': true,
      'w-full': true,
    }"
    style="
      aspect-ratio: 6/5;
      min-height: 130px;
      max-height: 180px;
      perspective: 1000px;
    "
    @click="handleCardClick($event, folder.id)"
  >
    <div
      class="absolute top-[10%] left-0 z-0 h-[20%] w-[40%] rounded-tl-xl rounded-tr-md transition-colors"
      :style="{
        backgroundColor: folder.color || DEFAULT_FOLDER_COLOR,
        filter: 'saturate(0.8)',
      }"
    ></div>

    <div
      class="absolute top-[20%] left-0 z-0 w-full rounded-xl rounded-tl-none transition-colors"
      style="height: 80%"
      :style="{
        backgroundColor: folder.color || DEFAULT_FOLDER_COLOR,
        filter: 'saturate(0.8)',
      }"
    ></div>

    <div
      v-if="itemCount > 1"
      class="folder-card__sheet folder-card__sheet--rear absolute z-10 rounded-lg border border-neutral-200 dark:border-neutral-200 bg-white p-3"
      style="top: 15%; left: 14%; width: 72%; height: 58%"
    >
      <div class="mb-2 h-1 w-full rounded-full bg-gray-100"></div>
      <div class="mb-2 h-1 w-full rounded-full bg-gray-100"></div>
      <div class="h-1 w-2/3 rounded-full bg-gray-100"></div>
    </div>

    <div
      v-if="itemCount > 0"
      class="folder-card__sheet folder-card__sheet--front absolute z-10 rotate-2 rounded-lg border border-neutral-200 dark:border-neutral-200 bg-gray-50 p-4"
      style="top: 23%; left: 21%; width: 72%; height: 64%"
    >
      <div class="mb-3 h-2 w-12 rounded-full bg-blue-400/30"></div>
      <div class="mb-2 h-1 w-full rounded-full bg-gray-200"></div>
      <div class="mb-2 h-1 w-full rounded-full bg-gray-200"></div>
      <div class="h-1 w-4/5 rounded-full bg-gray-200"></div>
    </div>

    <div
      class="folder-card__body absolute bottom-0 left-0 z-20 flex w-full flex-col rounded-xl px-3 pb-2.5 pt-3 text-neutral-800"
      style="height: 65%"
      :style="{
        background: `linear-gradient(to bottom, ${
          folder.color || lightenHex(DEFAULT_FOLDER_COLOR, 0.18)
        }, ${folder.color || DEFAULT_FOLDER_COLOR})`,
        transformOrigin: 'bottom center',
      }"
    >
      <!-- Centered emoji -->
      <div class="flex-1 flex items-center justify-center min-h-0 py-0.5">
        <div v-if="!isMobileRuntime">
          <ui-popover placement="bottom" @click.stop>
            <template #trigger>
              <button
                class="flex items-center justify-center text-white transition-transform hover:scale-110 active:scale-95"
              >
                <span
                  v-if="folder.icon"
                  class="text-4xl leading-none drop-shadow-sm"
                  >{{ folder.icon }}</span
                >
                <v-remixicon
                  v-else
                  name="riFolder5Fill"
                  class="size-8 drop-shadow-sm"
                />
              </button>
            </template>

            <!-- Colors row -->
            <p class="text-[11px] font-semibold text-neutral-500 mb-2 ml-0.5">
              {{ translations.card.colors }}
            </p>
            <div class="grid grid-cols-7 gap-1.5 mb-4">
              <button
                v-for="color in iconColors"
                :key="color"
                class="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                :class="{
                  'ring-2 ring-primary ring-inset bg-neutral-100 dark:bg-neutral-800':
                    folder.color === color ||
                    (!folder.color && color === '#6366f1'),
                }"
                @click="selectColorIcon(color)"
              >
                <v-remixicon
                  name="riFolder5Fill"
                  class="w-5 h-5"
                  :style="{ color }"
                />
              </button>
            </div>

            <!-- Emoji section -->
            <div class="w-72">
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

              <div
                class="grid grid-cols-8 gap-1 max-h-52 overflow-y-auto relative"
              >
                <button
                  v-for="emoji in filteredEmojis"
                  :key="emoji.char"
                  class="text-xl p-1.5 rounded-lg transition-colors duration-150 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  :class="{
                    'bg-primary/15 ring-1 ring-primary':
                      folder.icon === emoji.char,
                  }"
                  style="
                    font-family: 'Apple Color Emoji', 'Segoe UI Emoji',
                      'Noto Color Emoji', 'Twemoji', sans-serif;
                  "
                  :title="emoji.name"
                  @click="selectEmoji(emoji.char)"
                >
                  {{ emoji.char }}
                </button>

                <!-- Skin tone selector -->
                <div
                  v-if="activeSkinToneBase && skinToneMap[activeSkinToneBase]"
                  class="col-span-full flex justify-center gap-1 py-1.5 border-t border-neutral-200 dark:border-neutral-700 mt-1"
                >
                  <button
                    v-for="variant in skinToneMap[activeSkinToneBase]"
                    :key="variant.char"
                    class="text-lg p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                    :class="{
                      'bg-primary/15 ring-1 ring-primary':
                        folder.icon === variant.char,
                    }"
                    style="
                      font-family: 'Apple Color Emoji', 'Segoe UI Emoji',
                        'Noto Color Emoji', 'Twemoji', sans-serif;
                    "
                    :title="variant.name"
                    @click="selectSkinToneVariant(variant.char)"
                  >
                    {{ variant.char }}
                  </button>
                </div>
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

        <!-- Mobile: centered trigger -->
        <button
          v-else
          class="flex items-center justify-center text-white"
          @click.stop="openCustomizeModal"
        >
          <span
            v-if="folder.icon"
            class="text-4xl leading-none drop-shadow-sm"
            >{{ folder.icon }}</span
          >
          <v-remixicon
            v-else
            name="riFolder5Fill"
            class="size-8 drop-shadow-sm"
          />
        </button>
      </div>

      <!-- Bottom row: title + ... menu -->
      <div class="flex justify-between items-end gap-2 shrink-0">
        <div class="flex-grow min-w-0">
          <template v-if="!isMobileRuntime">
            <div v-if="!isRenaming" class="flex flex-col">
              <h3
                class="text-white font-bold text-sm truncate leading-tight"
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
          </template>

          <div v-else class="flex flex-col">
            <h3
              class="text-white font-bold text-sm truncate leading-tight drop-shadow-sm"
            >
              {{ folder.name || translations.card.untitledFolder }}
            </h3>
            <p class="text-white/80 text-[10px] font-medium">
              {{ itemCount }} item{{ itemCount !== 1 ? 's' : '' }}
            </p>
          </div>
        </div>

        <!-- ... menu -->
        <ui-popover placement="top" @click.stop>
          <template #trigger>
            <button
              class="size-6 flex items-center justify-center text-white/60 hover:text-white transition-colors shrink-0"
            >
              <v-remixicon name="riMoreFill" class="size-4" />
            </button>
          </template>

          <div class="flex flex-col gap-0.5 min-w-[130px]">
            <button
              class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              @click.stop="toggleArchive"
            >
              <v-remixicon
                :name="
                  folder.isArchived ? 'riInboxUnarchiveLine' : 'riArchiveLine'
                "
              />
              <span>{{
                folder.isArchived
                  ? translations.card.unarchive
                  : translations.card.archive
              }}</span>
            </button>
            <button
              class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              @click.stop="showFolderMoveModal = true"
            >
              <v-remixicon name="riFolderTransferLine" />
              <span>{{ translations.card.moveToFolder }}</span>
            </button>
            <button
              class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left transition-colors group"
              @click.stop="deleteFolder"
            >
              <v-remixicon
                name="riDeleteBin6Line"
                class="text-red-600 dark:text-red-400"
              />
              <span class="text-red-600 dark:text-red-400">{{
                translations.card.delete
              }}</span>
            </button>
          </div>
        </ui-popover>
      </div>
    </div>

    <!-- Mobile: customization modal -->
    <ui-modal
      v-model="showCustomizeModal"
      content-class="max-w-sm"
      @close="onModalClose"
    >
      <template #header>
        <span class="font-semibold text-base">{{
          translations.card.rename
        }}</span>
      </template>

      <!-- Rename input -->
      <div class="px-4 pt-1 pb-3">
        <input
          ref="mobileRenameInput"
          v-model="newName"
          class="w-full bg-neutral-100 dark:bg-neutral-800 rounded-lg px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-neutral-400"
          :placeholder="translations.card.untitledFolder"
          @keydown.enter.prevent="showCustomizeModal = false"
        />
      </div>

      <!-- Colors row -->
      <p class="px-4 text-[11px] font-semibold text-neutral-500 mb-2">
        {{ translations.card.colors }}
      </p>
      <div class="px-4 grid grid-cols-7 gap-2 mb-4">
        <button
          v-for="color in iconColors"
          :key="color"
          class="p-2 rounded-xl transition-colors"
          :class="{
            'bg-primary/15 ring-2 ring-primary':
              folder.color === color || (!folder.color && color === '#6366f1'),
            'hover:bg-neutral-100 dark:hover:bg-neutral-800': !(
              folder.color === color ||
              (!folder.color && color === '#6366f1')
            ),
          }"
          @click="selectColorIcon(color)"
        >
          <v-remixicon
            name="riFolder5Fill"
            class="w-6 h-6 mx-auto"
            :style="{ color }"
          />
        </button>
      </div>

      <!-- Emoji section -->
      <div class="px-4 pb-4">
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
          class="flex flex-wrap gap-1.5 mb-3 justify-center"
        >
          <button
            v-for="category in emojiCategories"
            :key="category.name"
            :class="{
              'bg-primary text-white': selectedCategory === category.name,
              'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700':
                selectedCategory !== category.name,
            }"
            class="flex items-center gap-2 p-2.5 rounded-full text-xs font-medium transition-all duration-200"
            @click="
              selectedCategory =
                selectedCategory === category.name ? null : category.name
            "
          >
            <v-remixicon :name="category.icon" />
          </button>
        </div>

        <div class="grid grid-cols-8 gap-1 max-h-56 overflow-y-auto relative">
          <button
            v-for="emoji in filteredEmojis"
            :key="emoji.char"
            class="text-xl p-2.5 rounded-lg transition-colors duration-150 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            :class="{
              'bg-primary/15 ring-1 ring-primary': folder.icon === emoji.char,
            }"
            style="
              font-family: 'Apple Color Emoji', 'Segoe UI Emoji',
                'Noto Color Emoji', 'Twemoji', sans-serif;
            "
            :title="emoji.name"
            @click="selectEmoji(emoji.char)"
          >
            {{ emoji.char }}
          </button>

          <div
            v-if="activeSkinToneBase && skinToneMap[activeSkinToneBase]"
            class="col-span-full flex justify-center gap-1 py-1.5 border-t border-neutral-200 dark:border-neutral-700 mt-1"
          >
            <button
              v-for="variant in skinToneMap[activeSkinToneBase]"
              :key="variant.char"
              class="text-lg p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              :class="{
                'bg-primary/15 ring-1 ring-primary':
                  folder.icon === variant.char,
              }"
              style="
                font-family: 'Apple Color Emoji', 'Segoe UI Emoji',
                  'Noto Color Emoji', 'Twemoji', sans-serif;
              "
              :title="variant.name"
              @click="selectSkinToneVariant(variant.char)"
            >
              {{ variant.char }}
            </button>
          </div>
        </div>

        <div
          v-if="filteredEmojis.length === 0"
          class="text-center py-10 text-neutral-500 dark:text-neutral-400"
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
    </ui-modal>

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
import { useRouter } from 'vue-router';
import { backend } from '@/lib/tauri-bridge';
import FolderTree from './FolderTree.vue';
import emojis from 'emoji.json';

const props = defineProps({
  folder: { type: Object, required: true },
  disableOpen: { type: Boolean, default: false },
  isDragOver: { type: Boolean, default: false },
});

const folderStore = useFolderStore();
const noteStore = useNoteStore();
const router = useRouter();
const showFolderMoveModal = ref(false);
const showCustomizeModal = ref(false);

const isMobileRuntime = backend.isMobileRuntime();

const iconColors = [
  '#6366f1', // Indigo (default)
  '#ffba00', // Amber
  '#c27aff', // Purple
  '#fb64b6', // Pink
  '#fb2c36', // Red
  '#51a2ff', // Blue
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
const isRenaming = ref(false);

const activeSkinToneBase = ref(null);

const SKIN_TONE_SUFFIXES = [
  ': light skin tone',
  ': medium-light skin tone',
  ': medium skin tone',
  ': medium-dark skin tone',
  ': dark skin tone',
];

const skinToneMap = {};
for (const e of emojis) {
  for (const s of SKIN_TONE_SUFFIXES) {
    if (e.name.endsWith(s)) {
      const base = e.name.slice(0, -s.length);
      if (!skinToneMap[base]) skinToneMap[base] = [];
      skinToneMap[base].push(e);
      break;
    }
  }
}

function isSkinToneVariant(name) {
  return SKIN_TONE_SUFFIXES.some((s) => name.endsWith(s));
}

function handleCardClick(event, folderId) {
  if (isRenaming.value) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey) return;
  if (props.disableOpen) return;
  router.push(`/folder/${folderId}`);
}
const newName = ref(props.folder.name);
const renameInput = ref(null);
const mobileRenameInput = ref(null);
const searchQuery = ref('');
const selectedCategory = ref(null);

const DEFAULT_FOLDER_COLOR = '#6366f1';

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lightenHex(hex, amount = 0.18) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#818cf8';
  const toHex = (value) =>
    clamp(Math.round(value + (255 - value) * amount), 0, 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

const folderBaseColor = computed(
  () => props.folder.color || DEFAULT_FOLDER_COLOR
);

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
    if (isSkinToneVariant(emoji.name)) return false;
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

function openCustomizeModal() {
  newName.value = props.folder.name;
  showCustomizeModal.value = true;
  nextTick(() => {
    mobileRenameInput.value?.focus();
    mobileRenameInput.value?.select();
  });
}

function onModalClose() {
  // Persist any pending rename when the modal closes
  if (newName.value.trim() && newName.value !== props.folder.name) {
    folderStore.update(props.folder.id, { name: newName.value.trim() });
  } else if (!newName.value.trim()) {
    newName.value = props.folder.name;
  }
}

function selectEmoji(emoji) {
  if (!searchQuery.value && skinToneMap[emoji.name]) {
    activeSkinToneBase.value =
      activeSkinToneBase.value === emoji.name ? null : emoji.name;
    return;
  }
  activeSkinToneBase.value = null;
  folderStore.update(props.folder.id, { icon: emoji });
}

function selectSkinToneVariant(char) {
  activeSkinToneBase.value = null;
  folderStore.update(props.folder.id, { icon: char });
}

function selectColorIcon(color) {
  folderStore.update(props.folder.id, { color: color });
}

function deleteFolder() {
  dialog.confirm({
    title: translations.value.card.confirmPromptFolder,
    onConfirm: () => {
      folderStore.delete(props.folder.id, { deleteContents: true });
    },
  });
}

function toggleArchive() {
  if (props.folder.isArchived) {
    folderStore.unarchive(props.folder.id);
  } else {
    folderStore.archive(props.folder.id);
  }
}

const { translations } = useTranslations();
</script>

<style scoped>
.folder-card {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.folder-card:hover {
  transform: translateY(-1px);
}
.folder-card:active {
  transform: translateY(0) scale(0.99);
}

.folder-card .folder-card__body {
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.folder-card .folder-card__sheet--front {
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.folder-card .folder-card__sheet--rear {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.folder-card.is-drag-over .folder-card__body {
  transform: rotateX(-25deg);
}
.folder-card.is-drag-over .folder-card__sheet--front {
  transform: translateY(-6px) rotate(3deg) !important;
}
.folder-card.is-drag-over .folder-card__sheet--rear {
  transform: translateY(-8px) !important;
}
</style>
