<template>
  <ui-card
    data-testid="note-card"
    class="hover:ring-1 hover:ring-primary/20 hover:shadow-md hover:shadow-neutral-200/60 dark:hover:shadow-neutral-900 group note-card flex flex-col cursor-pointer"
    padding="p-0"
    @click="openNote($event, note.id)"
  >
    <!-- Conflict banner -->
    <div
      v-if="note.isConflict"
      class="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs"
    >
      <v-remixicon name="riErrorWarningLine" size="14" class="flex-shrink-0" />
      <span class="flex-1">{{
        translations.card.conflictCopy ||
        'Conflict copy — review and delete one version'
      }}</span>
    </div>

    <div class="pt-4 px-4 flex-1">
      <div>
        <div
          data-testid="note-card-title"
          class="text-md font-semibold text-lg block line-clamp leading-tight note-card__title"
        >
          {{ note.title || translations.card.untitledNote }}
        </div>
        <div
          v-if="note.labels.length !== 0"
          class="text-primary dark:text-primary mt-2 mb-1 w-full flex flex-wrap gap-1"
        >
          <span
            v-for="label in note.labels"
            :key="label"
            class="note-card__label inline-flex max-w-full hover:underline cursor-pointer px-1.5 py-0.5 bg-primary/10 dark:bg-primary/10 rounded-lg text-xs sm:text-sm text-primary"
            :style="
              labelColor(label)
                ? {
                    color: labelColor(label),
                    backgroundColor: labelColor(label) + '1a',
                  }
                : {}
            "
            @click.stop="$emit('update:label', label)"
          >
            #{{ label }}
          </span>
        </div>
      </div>
      <div
        v-if="!note.isLocked"
        data-preview-shell
        class="relative h-[140px] overflow-hidden mt-1.5 eio-fade-y-4"
      >
        <div v-if="preview.blocks.length" class="note-card-preview-stack">
          <div
            v-for="(block, index) in preview.blocks"
            :key="`${block.kind}-${index}-${block.text || block.label || ''}`"
            :class="[
              'note-card-preview-block',
              `is-${block.kind}`,
              block.tone ? `tone-${block.tone}` : '',
              block.checked ? 'is-checked' : '',
            ]"
          >
            <template v-if="block.kind === 'image'">
              <img
                class="note-card-preview-image"
                :src="block.src"
                :alt="block.alt || 'Note preview image'"
                loading="lazy"
                decoding="async"
              />
            </template>

            <template v-else-if="block.kind === 'table'">
              <div class="note-card-preview-table-wrap">
                <table class="note-card-preview-table">
                  <tbody>
                    <tr
                      v-for="(row, rowIndex) in block.rows"
                      :key="`row-${rowIndex}`"
                      class="note-card-preview-table-row"
                    >
                      <component
                        :is="cell.isHeader ? 'th' : 'td'"
                        v-for="(cell, cellIndex) in row"
                        :key="`cell-${rowIndex}-${cellIndex}`"
                        class="note-card-preview-table-cell"
                      >
                        {{ cell.text }}
                      </component>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>

            <template v-else-if="block.kind === 'media'">
              <span class="note-card-preview-media-icon" aria-hidden="true">
                <v-remixicon :name="mediaIcon(block.tone)" size="16" />
              </span>
              <span class="note-card-preview-media-copy">
                <span class="note-card-preview-media-label">
                  {{ block.label }}
                </span>
                <span v-if="block.text" class="note-card-preview-media-text">
                  {{ block.text }}
                </span>
              </span>
            </template>

            <template v-else-if="block.kind === 'task'">
              <span
                class="note-card-preview-check"
                :data-checked="block.checked ? 'true' : 'false'"
              >
                <v-remixicon
                  v-if="block.checked"
                  name="riCheckLine"
                  size="13"
                  class="note-card-preview-check-icon"
                />
              </span>
              <span class="note-card-preview-task-text truncate">{{
                block.text
              }}</span>
            </template>

            <template v-else>
              {{ block.text }}
            </template>
          </div>

          <div
            v-if="preview.hasMore || preview.mediaCount > 1"
            class="note-card-preview-meta"
          >
            {{ previewMeta }}
          </div>
        </div>

        <div v-else class="note-card-preview-empty">
          {{ translations.card.content || 'Start writing...' }}
        </div>
      </div>

      <button
        v-if="note.isLocked"
        :aria-label="translations.card.unlock || 'Unlock'"
        class="hover:text-neutral-600 dark:text-[color:var(--selected-dark-text)] h-full transition"
        @click.stop="unlockNote(note.id)"
      >
        <v-remixicon
          class="w-24 h-auto text-neutral-600 dark:text-[color:var(--selected-dark-text)]"
          name="riLockLine"
        />
        <div
          class="text-xs text-neutral-500 dark:text-neutral-400 invisible group-hover:visible dark:text-[color:var(--selected-dark-text)]"
        >
          {{ translations.card.unlockToEdit || '-' }}
        </div>
      </button>
    </div>

    <!-- Unified action bar: shows full actions on desktop, bookmark-only on mobile -->
    <div
      class="bg-neutral-500/5 dark:bg-white/5 flex z-10 items-center text-neutral-600 dark:text-neutral-200 gap-1 p-2 px-4 bottom-0"
    >
      <button
        v-if="!note.isArchived"
        v-tooltip.group="
          note.isBookmarked
            ? translations.card.removeBookmark
            : translations.card.bookmark
        "
        :aria-label="note.isBookmarked ? (translations.card.removeBookmark || 'Remove bookmark') : (translations.card.bookmark || 'Bookmark')"
        class="note-card__action size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
        :class="[note.isBookmarked ? 'text-primary' : 'hover:text-neutral-900']"
        @click.stop="toggleBookmark(note)"
      >
        <v-remixicon
          :name="note.isBookmarked ? 'riBookmarkFill' : 'riBookmarkLine'"
          class="size-5"
        />
      </button>

      <template v-if="!isMobile">
        <button
          v-tooltip.group="
            note.isArchived
              ? translations.card.unarchive
              : translations.card.archive
          "
          :aria-label="note.isArchived ? (translations.card.unarchive || 'Unarchive') : (translations.card.archive || 'Archive')"
          class="note-card__action size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 invisible group-hover:visible"
          @click.stop="toggleArchive(note)"
        >
          <v-remixicon
            :name="note.isArchived ? 'riInboxUnarchiveLine' : 'riArchiveLine'"
            class="size-5"
          />
        </button>

        <button
          v-if="!note.isLocked"
          v-tooltip.group="translations.card.lock"
          :aria-label="translations.card.lock || 'Lock'"
          class="note-card__action size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 invisible group-hover:visible"
          @click.stop="lockNote(note.id)"
        >
          <v-remixicon name="riLockLine" class="size-5" />
        </button>

        <button
          v-if="note.isLocked"
          v-tooltip.group="translations.card.unlock"
          :aria-label="translations.card.unlock || 'Unlock'"
          class="note-card__action size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 invisible group-hover:visible"
          @click.stop="unlockNote(note.id)"
        >
          <v-remixicon
            :name="note.isLocked ? 'riLockUnlockLine' : 'riLockLine'"
            class="size-5"
          />
        </button>

        <button
          v-tooltip.group="translations.card.moveToFolder"
          :aria-label="translations.card.moveToFolder || 'Move to folder'"
          class="note-card__action size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 invisible group-hover:visible"
          @click.stop="showMoveModal = true"
        >
          <v-remixicon name="riFolderTransferLine" class="size-5" />
        </button>

        <button
          v-tooltip.group="translations.card.delete"
          :aria-label="translations.card.delete || 'Delete'"
          class="note-card__action size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-red-500/5 hover:text-red-500 invisible group-hover:visible"
          @click.stop="deleteNote(note.id)"
        >
          <v-remixicon name="riDeleteBin6Line" class="size-5" />
        </button>
      </template>

      <div class="flex-grow"></div>

      <p class="text-overflow text-sm opacity-70">
        {{
          note.isLocked
            ? translations.card.isLocked
            : formatDate(note.createdAt)
        }}
      </p>
    </div>

    <folder-tree v-model="showMoveModal" :notes="[note]" mode="note" />
  </ui-card>
</template>

<script setup>
/* eslint-disable no-undef */
import dayjs from '@/lib/dayjs';
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useNoteStore } from '@/store/note';
import { usePasswordStore } from '@/store/passwd';
import { verifyPassphrase } from '@/utils/crypto/encryption.js';
import { useGroupTooltip } from '@/composable/groupTooltip';
import { getSettingSync } from '@/composable/settings';
import { useTranslations } from '@/composable/useTranslations';
import { useRouter } from 'vue-router';
import { useDialog } from '@/composable/dialog';
import FolderTree from './FolderTree.vue';
import { useLabelStore } from '@/store/label';
import { useSounds } from '@/composable/useSounds';

const props = defineProps({
  note: {
    type: Object,
    default: () => ({}),
  },
  disableOpen: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update', 'update:label']);

const labelStore = useLabelStore();
const router = useRouter();
const dialog = useDialog();
const showMoveModal = ref(false);
const { play } = useSounds();

const { translations } = useTranslations();

const preview = computed(
  () =>
    props.note?.cardPreview || {
      blocks: [],
      hasMore: false,
      mediaCount: 0,
      visibleMediaCount: 0,
    }
);

const previewMeta = computed(() => {
  const extraVisuals = Math.max(
    0,
    (preview.value.mediaCount || 0) - (preview.value.visibleMediaCount || 0)
  );

  if (extraVisuals > 0) {
    return `+${extraVisuals} more visuals`;
  }

  return 'More';
});

const labelColorMap = computed(() => {
  const map = {};
  for (const label of props.note?.labels ?? []) {
    map[label] = labelStore.getColor(label);
  }
  return map;
});

function labelColor(name) {
  return labelColorMap.value[name] ?? null;
}

const showCardAlert = (message) =>
  dialog.alert({
    title: translations.value.settings?.alertTitle || 'Alert',
    body: message,
    okText: translations.value.dialog?.close || 'Close',
  });

const mobileQuery = window.matchMedia('(max-width: 767px)');
const isMobile = ref(mobileQuery.matches);
const onMobileChange = (e) => {
  isMobile.value = e.matches;
};
onMounted(() => mobileQuery.addEventListener('change', onMobileChange));
onUnmounted(() => mobileQuery.removeEventListener('change', onMobileChange));

useGroupTooltip();

async function lockNote(note) {
  const passwordStore = usePasswordStore();
  const noteStore = useNoteStore();
  try {
    const hassharedKey = await passwordStore.retrieve();
    if (!hassharedKey) {
      dialog.prompt({
        title: translations.value.card.enterPasswd,
        okText: translations.value.card.setKey,
        body: translations.value.settings.warning,
        cancelText: translations.value.dialog.cancel,
        placeholder: translations.value.card.password,
        onConfirm: async (newKey) => {
          if (newKey) {
            try {
              await passwordStore.setSharedKey(newKey);
              await verifyPassphrase(newKey);
              await noteStore.lockNote(note, newKey);
            } catch {
              showCardAlert(translations.value.card.keyFail);
            }
          } else {
            showCardAlert(translations.value.card.keyFail);
          }
        },
      });
    } else {
      dialog.prompt({
        title: translations.value.card.enterPasswd,
        body: translations.value.settings.warning,
        icon: 'riLockLine',
        okText: translations.value.card.lock,
        cancelText: translations.value.dialog.cancel,
        placeholder: translations.value.card.password,
        onConfirm: async (enteredPassword) => {
          const isValid = await passwordStore.isValidPassword(enteredPassword);
          if (isValid) {
            await noteStore.lockNote(note, enteredPassword);
          } else {
            play('error');
            showCardAlert(translations.value.card.wrongPasswd);
          }
        },
      });
    }
  } catch (error) {
    console.error('Error locking note:', error);
  }
}

async function unlockNote(note) {
  const passwordStore = usePasswordStore();
  const noteStore = useNoteStore();
  dialog.prompt({
    title: translations.value.card.enterPasswd,
    body: translations.value.card.isLocked,
    icon: 'riLockUnlockLine',
    okText: translations.value.card.unlock,
    cancelText: translations.value.dialog.cancel,
    placeholder: translations.value.card.password,
    onConfirm: async (enteredPassword) => {
      try {
        const hassharedKey = await passwordStore.retrieve();
        if (!hassharedKey) {
          await noteStore.unlockNote(note, enteredPassword);
          await passwordStore.setSharedKey(enteredPassword);
          await verifyPassphrase(enteredPassword);
        } else {
          const isValid = await passwordStore.isValidPassword(enteredPassword);
          if (isValid) {
            await noteStore.unlockNote(note, enteredPassword);
          } else {
            play('error');
            showCardAlert(translations.value.card.wrongPasswd);
          }
        }
      } catch {
        play('error');
        showCardAlert(translations.value.card.wrongPasswd);
      }
    },
  });
}

async function deleteNote(note) {
  const noteStore = useNoteStore();
  dialog.confirm({
    title: translations.value.card.confirmPrompt,
    body:
      translations.value.card?.deleteAction || 'This action cannot be undone',
    icon: 'riDeleteBin6Line',
    okVariant: 'danger',
    okText: translations.value.card.confirm,
    cancelText: translations.value.dialog.cancel,
    onConfirm: async () => {
      await noteStore.delete(note);
    },
  });
}

const selectedLanguage = getSettingSync('selectedLanguage');
dayjs.locale(selectedLanguage);

function formatDate(date) {
  return dayjs(date).fromNow();
}

function openNote(event, noteId) {
  if (props.disableOpen) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey) return;
  router.push(`/note/${noteId}`);
}

function emitUpdate(payload) {
  emit('update', payload);
}

function toggleBookmark(note) {
  emitUpdate({ isBookmarked: !note.isBookmarked });
}

function toggleArchive(note) {
  emitUpdate({ isArchived: !note.isArchived });
}

function mediaIcon(tone) {
  switch (tone) {
    case 'audio':
      return 'riVolumeDownFill';
    case 'video':
      return 'riMovieLine';
    case 'file':
      return 'riFile2Line';
    case 'diagram':
      return 'riPieChart2Line';
    case 'math':
      return 'riCalculatorLine';
    case 'sketch':
      return 'riBrushLine';
    case 'table':
      return 'riTableLine';
    default:
      return 'riArticleLine';
  }
}
</script>

<style>
.note-card {
  content-visibility: auto;
  contain-intrinsic-size: 320px;
  min-width: 0;
  transform: translate3d(0, 0, 0) scale(1);
  transition: transform var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard);
  will-change: transform;
}

.note-card__title {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.note-card__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-card.active-note .group-hover\:visible {
  visibility: visible;
}

@media (hover: hover) and (pointer: fine) {
  .note-card:hover {
    transform: translate3d(0, -1px, 0) scale(1.002);
  }
}

.note-card:active {
  transform: translate3d(0, 0, 0) scale(0.998);
}

.note-card__action {
  transition: background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
  transform: translate3d(0, 0, 0);
}

.note-card__action:active {
  transform: scale(0.96);
}

.note-card [data-preview-shell] {
  contain: layout paint style;
}

.note-card-preview-stack {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  gap: 0;
  padding: 0.05rem 0 0.3rem;
  font-family: var(--selected-font), sans-serif;
  font-size: 0.94rem;
  line-height: 1.5;
  letter-spacing: normal;
  word-spacing: normal;
  font-kerning: normal;
  font-variant-ligatures: normal;
}

.note-card-preview-block {
  display: block;
  margin: 0.5em 0;
  overflow: hidden;
  color: theme('colors.neutral.700');
  line-height: 1.5;
  text-wrap: pretty;
  white-space: pre-wrap;
  word-break: normal;
  overflow-wrap: anywhere;
}

.note-card-preview-stack > *:first-child {
  margin-top: 0 !important;
}

.note-card-preview-stack > *:last-child {
  margin-bottom: 0 !important;
}

.dark .note-card-preview-block {
  color: var(--text-dark);
}

@media (prefers-reduced-motion: reduce) {
  .note-card,
  .note-card__action {
    transition-duration: 0.01ms;
  }

  .note-card:hover,
  .note-card:active,
  .note-card__action:active {
    transform: none;
  }
}

.note-card-preview-block.is-image,
.note-card-preview-block.is-table,
.note-card-preview-block.is-media {
  display: block;
}

.note-card-preview-block.is-paragraph,
.note-card-preview-block.is-list,
.note-card-preview-block.is-task,
.note-card-preview-block.is-quote,
.note-card-preview-block.is-callout {
  color: theme('colors.neutral.700');
}

.dark .note-card-preview-block.is-paragraph,
.dark .note-card-preview-block.is-list,
.dark .note-card-preview-block.is-task,
.dark .note-card-preview-block.is-quote,
.dark .note-card-preview-block.is-callout {
  color: var(--text-dark);
}

.note-card-preview-block.is-heading {
  color: theme('colors.neutral.900');
  font-size: 1.02rem;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: -0.015em;
  margin: 0.9em 0 0.55em;
}

.dark .note-card-preview-block.is-heading {
  color: var(--text-dark);
}

.note-card-preview-block.is-list {
  position: relative;
  padding-left: 1rem;
  margin: 0.25em 0;
}

.note-card-preview-block.is-list::before {
  content: '';
  position: absolute;
  top: 0.68em;
  left: 0.18rem;
  height: 0.32rem;
  width: 0.32rem;
  border-radius: 999px;
  background: currentColor;
}

.note-card-preview-block.is-quote,
.note-card-preview-block.is-callout {
  border-left: 4px solid theme('colors.zinc.300');
  margin: 0.5em 0;
  padding: 0.25rem 0.25rem 0.25rem 0.9rem;
  color: theme('colors.neutral.700');
}

.dark .note-card-preview-block.is-quote,
.dark .note-card-preview-block.is-callout {
  border-left-color: theme('colors.neutral.600');
  color: var(--text-dark);
}

.note-card-preview-block.is-callout.tone-blue {
  border-left-color: theme('colors.blue.500');
  background: theme('colors.blue.500 / 0.08');
}

.note-card-preview-block.is-callout.tone-green {
  border-left-color: theme('colors.green.500');
  background: theme('colors.green.500 / 0.08');
}

.note-card-preview-block.is-callout.tone-red {
  border-left-color: theme('colors.red.500');
  background: theme('colors.red.500 / 0.08');
}

.note-card-preview-block.is-callout.tone-yellow {
  border-left-color: theme('colors.yellow.500');
  background: theme('colors.yellow.500 / 0.12');
}

.note-card-preview-block.is-callout.tone-purple {
  border-left-color: theme('colors.purple.500');
  background: theme('colors.purple.500 / 0.1');
}

.note-card-preview-block.is-callout.tone-black {
  border-left-color: theme('colors.neutral.600');
  background: theme('colors.zinc.700 / 0.09');
}

.note-card-preview-block.is-code {
  margin: 0.55em 0;
  border-radius: 0.5rem;
  background: theme('colors.black / 0.05');
  color: theme('colors.zinc.700');
  padding: 0.5rem 0.75rem;
  font-family: var(--selected-font-code), 'Source Code Pro', monospace;
  font-size: 0.82rem;
  line-height: 1.45;
}

.dark .note-card-preview-block.is-code {
  background: theme('colors.neutral.600 / 0.3');
  color: theme('colors.zinc.200');
}

.note-card-preview-block.is-media {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  margin: 0.55em 0;
  --preview-media-accent: theme('colors.sky.500');
  --preview-media-surface: theme('colors.sky.500 / 0.1');
  --preview-media-surface-alt: theme('colors.blue.500 / 0.04');
  --preview-media-icon-surface: theme('colors.white / 0.58');
  border: 1px solid
    color-mix(in srgb, var(--preview-media-accent) 18%, transparent);
  border-radius: 0.5rem;
  background: linear-gradient(
    135deg,
    var(--preview-media-surface),
    var(--preview-media-surface-alt)
  );
  padding: 0.65rem 0.8rem;
}

.note-card-preview-block.is-media.tone-diagram {
  --preview-media-accent: theme('colors.indigo.600');
  --preview-media-surface: theme('colors.indigo.500 / 0.12');
  --preview-media-surface-alt: theme('colors.indigo.400 / 0.05');
}

.note-card-preview-block.is-media.tone-math {
  --preview-media-accent: theme('colors.orange.700');
  --preview-media-surface: theme('colors.orange.500 / 0.12');
  --preview-media-surface-alt: theme('colors.orange.400 / 0.05');
}

.note-card-preview-block.is-media.tone-sketch {
  --preview-media-accent: theme('colors.emerald.600');
  --preview-media-surface: theme('colors.emerald.500 / 0.12');
  --preview-media-surface-alt: theme('colors.emerald.400 / 0.05');
}

.note-card-preview-block.is-media.tone-file,
.note-card-preview-block.is-media.tone-audio,
.note-card-preview-block.is-media.tone-video {
  --preview-media-accent: theme('colors.cyan.600');
  --preview-media-surface: theme('colors.cyan.400 / 0.12');
  --preview-media-surface-alt: theme('colors.cyan.400 / 0.05');
}

.note-card-preview-media-label {
  display: inline-flex;
  align-items: center;
  margin-bottom: 0.2rem;
  color: var(--preview-media-accent);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.note-card-preview-media-icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.5rem;
  background: var(--preview-media-icon-surface);
  color: var(--preview-media-accent);
}

.note-card-preview-media-copy {
  display: block;
  min-width: 0;
  flex: 1 1 auto;
}

.note-card-preview-media-text {
  display: block;
  color: theme('colors.zinc.700');
  font-size: 0.82rem;
  line-height: 1.4;
}

.dark .note-card-preview-media-label {
  color: var(--preview-media-accent);
}

.dark .note-card-preview-media-icon {
  background: theme('colors.zinc.900 / 0.45');
  color: var(--preview-media-accent);
}

.dark .note-card-preview-media-text {
  color: theme('colors.zinc.200');
}

.dark
  .note-card-preview-block.is-media.tone-diagram
  .note-card-preview-media-icon,
.dark
  .note-card-preview-block.is-media.tone-diagram
  .note-card-preview-media-label {
  color: theme('colors.indigo.300');
}

.dark .note-card-preview-block.is-media.tone-math .note-card-preview-media-icon,
.dark
  .note-card-preview-block.is-media.tone-math
  .note-card-preview-media-label {
  color: theme('colors.amber.300');
}

.dark
  .note-card-preview-block.is-media.tone-sketch
  .note-card-preview-media-icon,
.dark
  .note-card-preview-block.is-media.tone-sketch
  .note-card-preview-media-label {
  color: theme('colors.emerald.300');
}

.dark .note-card-preview-block.is-media.tone-file,
.dark .note-card-preview-block.is-media.tone-audio,
.dark .note-card-preview-block.is-media.tone-video {
  --preview-media-accent: theme('colors.cyan.300');
}

.note-card-preview-image {
  display: block;
  width: 100%;
  max-height: 82px;
  border: 1px solid theme('colors.zinc.200 / 0.9');
  border-radius: 0.5rem;
  object-fit: cover;
  background: theme('colors.zinc.100');
}

.dark .note-card-preview-image {
  border-color: theme('colors.zinc.700 / 0.9');
  background: theme('colors.zinc.900');
}

.note-card-preview-table-wrap {
  overflow: hidden;
  border-radius: 0.75rem;
}

.note-card-preview-table {
  width: 100%;
  table-layout: auto;
  border-collapse: separate;
  border-spacing: 0;
  overflow: hidden;
  background: theme('colors.zinc.50 / 0.95');
}

.dark .note-card-preview-table {
  background: theme('colors.zinc.900 / 0.95');
}

.note-card-preview-table-row {
  background: transparent;
}

.note-card-preview-table-cell {
  overflow: hidden;
  border: 1px solid theme('colors.zinc.200 / 0.9');
  background: transparent;
  padding: 0.42rem 0.48rem;
  color: theme('colors.zinc.700');
  font-size: 0.76rem;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-weight: 400;
}

.note-card-preview-table-cell:is(th) {
  background: theme('colors.zinc.700 / 0.08');
  font-weight: 600;
}

.dark .note-card-preview-table-cell {
  border-color: theme('colors.neutral.600 / 0.85');
  color: theme('colors.zinc.200');
}

.dark .note-card-preview-table-cell:is(th) {
  background: theme('colors.neutral.600 / 0.28');
}

.note-card-preview-check {
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 20%;
  border: 2px solid var(--border-input);
  background: transparent;
  margin-top: 0.1rem;
}

.note-card-preview-check[data-checked='true'] {
  @apply bg-primary border-primary;
}

.note-card-preview-check-icon {
  color: white;
}

.note-card-preview-block.is-task {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.25em 0;
}

.note-card-preview-task-text {
  line-height: 1.45;
}

.note-card-preview-block.is-task.is-checked .note-card-preview-task-text {
  color: theme('colors.zinc.500');
  text-decoration: line-through;
}

.dark .note-card-preview-block.is-task.is-checked .note-card-preview-task-text {
  color: theme('colors.zinc.400');
}

.note-card-preview-meta {
  margin-top: 0.35rem;
  color: theme('colors.zinc.500');
  font-size: 0.78rem;
  font-weight: 500;
}

.dark .note-card-preview-meta {
  color: theme('colors.zinc.400');
}

.note-card-preview-empty {
  display: flex;
  height: 100%;
  align-items: center;
  color: theme('colors.zinc.400');
  font-size: 0.93rem;
  line-height: 1.5;
}

.dark .note-card-preview-empty {
  color: theme('colors.zinc.500');
}
</style>
