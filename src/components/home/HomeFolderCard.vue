<template>
  <div
    class="folder-card relative group cursor-pointer w-full min-h-[130px] max-h-[180px] [perspective:1000px] [aspect-ratio:6/5]"
    :class="{ 'is-drag-over': isDragOver }"
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
      class="absolute top-[20%] left-0 z-0 w-full h-[80%] rounded-xl rounded-tl-none transition-colors"
      :style="{
        backgroundColor: folder.color || DEFAULT_FOLDER_COLOR,
        filter: 'saturate(0.8)',
      }"
    ></div>

    <div
      v-if="itemCount > 1"
      class="folder-card__sheet folder-card__sheet--rear absolute z-10 rounded-lg border border-neutral-200 dark:border-neutral-200 bg-white p-3 top-[15%] left-[14%] w-[72%] h-[58%]"
    >
      <div class="mb-2 h-1 w-full rounded-full bg-gray-100"></div>
      <div class="mb-2 h-1 w-full rounded-full bg-gray-100"></div>
      <div class="h-1 w-2/3 rounded-full bg-gray-100"></div>
    </div>

    <div
      v-if="itemCount > 0"
      class="folder-card__sheet folder-card__sheet--front absolute z-10 rotate-2 rounded-lg border border-neutral-200 dark:border-neutral-200 bg-gray-50 p-4 top-[23%] left-[21%] w-[72%] h-[64%]"
    >
      <div class="mb-3 h-2 w-12 rounded-full bg-blue-400/30"></div>
      <div class="mb-2 h-1 w-full rounded-full bg-gray-200"></div>
      <div class="mb-2 h-1 w-full rounded-full bg-gray-200"></div>
      <div class="h-1 w-4/5 rounded-full bg-gray-200"></div>
    </div>

    <div
      class="folder-card__body absolute bottom-0 left-0 z-20 flex w-full flex-col rounded-xl px-3 pb-2.5 pt-3 text-neutral-800 h-[65%]"
      :style="{
        background: `linear-gradient(to bottom, ${
          folder.color || lightenHex(DEFAULT_FOLDER_COLOR, 0.18)
        }, ${folder.color || DEFAULT_FOLDER_COLOR})`,
        transformOrigin: 'bottom center',
      }"
    >
      <!-- Centered emoji / customize trigger -->
      <div class="flex-1 flex items-center justify-center min-h-0 py-0.5">
        <button
          data-testid="customize-folder-button"
          class="flex items-center justify-center text-white transition-transform folder-emoji active:scale-95"
          aria-label="Customize folder"
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
          <div class="flex flex-col">
            <h3
              class="text-white font-bold text-sm truncate leading-tight cursor-pointer"
              @click.stop="openCustomizeModal"
            >
              {{ folder.name || translations.card.untitledFolder }}
            </h3>
            <p class="text-white/80 text-[10px] font-medium">
              {{ itemCount }} item{{ itemCount !== 1 ? 's' : '' }}
            </p>
          </div>
        </div>

        <!-- Desktop: ... -> popover -->
        <div class="relative shrink-0 hidden sm:block">
          <button
            class="size-6 flex items-center justify-center text-white/60 hover:text-white transition-colors"
            aria-label="More"
            @click.stop="showMenu = !showMenu"
          >
            <v-remixicon name="riMoreFill" class="size-4" />
          </button>
          <div
            v-if="showMenu"
            data-selection-keep
            class="absolute right-0 bottom-7 z-30 w-44 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-lg py-1 overflow-hidden"
            @click.stop
          >
            <button class="w-full text-left px-3 py-2.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 flex items-center gap-2" @click="onMenuCustomize"><v-remixicon name="riPaletteLine" class="size-4" />{{ translations.card?.customize || 'Customize' }}</button>
            <button class="w-full text-left px-3 py-2.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 flex items-center gap-2" @click="onMenuArchive"><v-remixicon :name="folder.isArchived ? 'riInboxUnarchiveLine' : 'riArchiveLine'" class="size-4" />{{ folder.isArchived ? (translations.card?.unarchive || 'Unarchive') : (translations.card?.archive || 'Archive') }}</button>
            <button class="w-full text-left px-3 py-2.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 flex items-center gap-2" @click="onMenuMove"><v-remixicon name="riFolderTransferLine" class="size-4" />{{ translations.card?.moveToFolder || 'Move' }}</button>
            <button class="w-full text-left px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2" @click="onMenuDelete"><v-remixicon name="riDeleteBin6Line" class="size-4" />{{ translations.card?.delete || 'Delete' }}</button>
          </div>
        </div>
      </div>
    </div>

    <folder-customize-modal
      v-model="showCustomizeModal"
      :folder="folder"
      @saved="onCustomizeSaved"
    />
    <folder-tree
      v-if="showMoveModal"
      v-model="showMoveModal"
      :folders="folder ? [folder] : []"
      mode="folder"
      overlay-class="z-[60]"
      @moved="showMoveModal = false"
    />
  </div>
</template>

<script setup>
import { useTranslations } from '@/composable/useTranslations';
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { useDialog } from '@/lib/dialog';
import { useRouter } from 'vue-router';
import FolderCustomizeModal from './FolderCustomizeModal.vue';
import FolderTree from './FolderTree.vue';
import { DEFAULT_FOLDER_COLOR } from '@/lib/folder-styles';

const props = defineProps({
  folder: { type: Object, required: true },
  disableOpen: { type: Boolean, default: false },
  isDragOver: { type: Boolean, default: false },
});

const noteStore = useNoteStore();
const folderStore = useFolderStore();
const dialog = useDialog();
const router = useRouter();
const showCustomizeModal = ref(false);
const showMenu = ref(false);
const showMoveModal = ref(false);

function handleCardClick(event, folderId) {
  if (event.metaKey || event.ctrlKey || event.shiftKey) return;
  if (props.disableOpen) return;
  router.push(`/folder/${folderId}`);
}

function openCustomizeModal() {
  showCustomizeModal.value = true;
}

function onCustomizeSaved() {
  showCustomizeModal.value = false;
}
function onMenuCustomize() { showMenu.value = false; showCustomizeModal.value = true; }
function onMenuArchive() { showMenu.value = false; if (props.folder.isArchived) folderStore.unarchive(props.folder.id); else folderStore.archive(props.folder.id); }
function onMenuMove() { showMenu.value = false; showMoveModal.value = true; }
function onMenuDelete() {
  showMenu.value = false;
  dialog.confirm({
    title: translations.value?.card?.confirmPromptFolder || 'Delete folder?',
    body: translations.value?.card?.deleteAction || 'This cannot be undone',
    icon: 'riDeleteBin6Line', okVariant: 'danger',
    onConfirm: async () => { await folderStore.delete(props.folder.id, { deleteContents: true }); },
  });
}
function onClickOutside() { showMenu.value = false; }
onMounted(() => window.addEventListener('click', onClickOutside));
onBeforeUnmount(() => window.removeEventListener('click', onClickOutside));

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

const itemCount = computed(() => {
  return noteStore.notesCountByFolder.get(props.folder.id) || 0;
});

const { translations } = useTranslations();
</script>

<style scoped>
.folder-card {
  transition: transform 0.25s var(--ease-spring);
}
@media (hover: hover) and (pointer: fine) {
  .folder-card:hover {
    transform: translateY(-1px);
  }
}
.folder-card:active {
  transform: translateY(0) scale(0.99);
}

.folder-card .folder-card__body {
  transition: transform 0.35s var(--ease-spring);
}

.folder-card .folder-card__sheet--front {
  transition: transform 0.35s var(--ease-spring) 30ms;
}
.folder-card .folder-card__sheet--rear {
  transition: transform 0.3s var(--ease-spring) 60ms;
}

.folder-card.is-drag-over .folder-card__body {
  transform: scale(1.02);
}
.folder-card.is-drag-over .folder-card__sheet--front {
  transform: translateY(-2px) !important;
}
.folder-card.is-drag-over .folder-card__sheet--rear {
  transform: translateY(-1px) !important;
}
@media (hover: hover) and (pointer: fine) {
  .folder-emoji:hover {
    transform: scale(1.1);
  }
}
</style>
