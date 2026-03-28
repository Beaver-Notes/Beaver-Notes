<template>
  <ui-card
    data-testid="note-card"
    class="hover:ring-1 hover:ring-primary/20 hover:shadow-md hover:shadow-neutral-200/60 dark:hover:shadow-neutral-900 group note-card flex flex-col cursor-pointer"
    padding="p-0"
    @click="openNote(note.id)"
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

    <div
      class="bg-neutral-500/5 dark:bg-white/5 flex z-10 items-center text-neutral-600 dark:text-neutral-200 gap-1 p-2 px-4 bottom-0 mobile:hidden"
    >
      <button
        v-if="!note.isArchived"
        v-tooltip.group="
          note.isBookmarked
            ? translations.card.removeBookmark
            : translations.card.bookmark
        "
        class="note-card__action size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
        :class="[note.isBookmarked ? 'text-primary' : 'hover:text-neutral-900']"
        @click.stop="toggleBookmark(note)"
      >
        <v-remixicon
          :name="note.isBookmarked ? 'riBookmarkFill' : 'riBookmarkLine'"
          class="size-5"
        />
      </button>

      <button
        v-tooltip.group="
          note.isArchived
            ? translations.card.unarchive
            : translations.card.archive
        "
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
        class="note-card__action size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 invisible group-hover:visible"
        @click.stop="lockNote(note.id)"
      >
        <v-remixicon name="riLockLine" class="size-5" />
      </button>

      <button
        v-if="note.isLocked"
        v-tooltip.group="translations.card.unlock"
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
        class="note-card__action size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 invisible group-hover:visible"
        @click.stop="showMoveModal = true"
      >
        <v-remixicon name="riFolderTransferLine" class="size-5" />
      </button>

      <button
        v-tooltip.group="translations.card.delete"
        class="note-card__action size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-red-500/5 hover:text-red-500 invisible group-hover:visible"
        @click.stop="deleteNote(note.id)"
      >
        <v-remixicon name="riDeleteBin6Line" class="size-5" />
      </button>

      <div class="flex-grow"></div>

      <p class="text-overflow text-sm opacity-70">
        {{
          note.isLocked
            ? translations.card.isLocked
            : formatDate(note.createdAt)
        }}
      </p>
    </div>

    <div
      class="bg-neutral-500/5 dark:bg-white/5 flex z-10 items-center text-neutral-600 dark:text-neutral-200 gap-1 p-2 px-4 bottom-0 hidden mobile:flex"
    >
      <button
        v-if="!note.isArchived"
        v-tooltip.group="
          note.isBookmarked
            ? translations.card.removeBookmark
            : translations.card.bookmark
        "
        class="note-card__action size-7 aspect-square flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
        :class="[note.isBookmarked ? 'text-primary' : 'hover:text-neutral-900']"
        @click.stop="toggleBookmark(note)"
      >
        <v-remixicon
          :name="note.isBookmarked ? 'riBookmarkFill' : 'riBookmarkLine'"
          class="size-5"
        />
      </button>

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
import { ref, computed } from 'vue';
import { useNoteStore } from '@/store/note';
import { usePasswordStore } from '@/store/passwd';
import { useGroupTooltip } from '@/composable/groupTooltip';
import { getSettingSync } from '@/composable/settings';
import { useTranslations } from '@/composable/useTranslations';
import { useRouter } from 'vue-router';
import { useDialog } from '@/composable/dialog';
import FolderTree from './FolderTree.vue';
import { useLabelStore } from '@/store/label';

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

function labelColor(name) {
  return labelStore.getColor(name);
}

const showCardAlert = (message) =>
  dialog.alert({
    title: translations.value.settings?.alertTitle || 'Alert',
    body: message,
    okText: translations.value.dialog?.close || 'Close',
  });

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
        body: translations.value.card.warning,
        cancelText: translations.value.card.cancel,
        placeholder: translations.value.card.password,
        onConfirm: async (newKey) => {
          if (newKey) {
            try {
              await passwordStore.setsharedKey(newKey);
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
        okText: translations.value.card.lock,
        cancelText: translations.value.card.cancel,
        placeholder: translations.value.card.password,
        onConfirm: async (enteredPassword) => {
          const isValid = await passwordStore.isValidPassword(enteredPassword);
          if (isValid) {
            await noteStore.lockNote(note, enteredPassword);
          } else {
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
    okText: translations.value.card.unlock,
    cancelText: translations.value.card.cancel,
    placeholder: translations.value.card.password,
    onConfirm: async (enteredPassword) => {
      try {
        const hassharedKey = await passwordStore.retrieve();
        if (!hassharedKey) {
          try {
            await noteStore.unlockNote(note, enteredPassword);
            await passwordStore.setsharedKey(enteredPassword);
          } catch {
            showCardAlert(translations.value.card.wrongPasswd);
            return;
          }
        } else {
          const isValid = await passwordStore.isValidPassword(enteredPassword);
          if (isValid) {
            await noteStore.unlockNote(note, enteredPassword);
          } else {
            showCardAlert(translations.value.card.wrongPasswd);
          }
        }
      } catch (error) {
        console.error('Error unlocking note:', error);
        showCardAlert(translations.value.card.wrongPasswd);
      }
    },
  });
}

async function deleteNote(note) {
  const noteStore = useNoteStore();
  dialog.confirm({
    title: translations.value.card.confirmPrompt,
    okText: translations.value.card.confirm,
    cancelText: translations.value.card.cancel,
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

function openNote(noteId) {
  if (props.disableOpen) return;
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
  color: rgb(82 82 91);
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
  color: var(--selected-dark-text);
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
  color: rgb(82 82 91);
}

.dark .note-card-preview-block.is-paragraph,
.dark .note-card-preview-block.is-list,
.dark .note-card-preview-block.is-task,
.dark .note-card-preview-block.is-quote,
.dark .note-card-preview-block.is-callout {
  color: var(--selected-dark-text);
}

.note-card-preview-block.is-heading {
  color: rgb(23 23 23);
  font-size: 1.02rem;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: -0.015em;
  margin: 0.9em 0 0.55em;
}

.dark .note-card-preview-block.is-heading {
  color: var(--selected-dark-text);
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
  border-left: 4px solid rgb(212 212 216);
  margin: 0.5em 0;
  padding: 0.25rem 0.25rem 0.25rem 0.9rem;
  color: rgb(82 82 91);
}

.dark .note-card-preview-block.is-quote,
.dark .note-card-preview-block.is-callout {
  border-left-color: rgb(82 82 91);
  color: var(--selected-dark-text);
}

.note-card-preview-block.is-callout.tone-blue {
  border-left-color: rgb(59 130 246);
  background: rgba(59, 130, 246, 0.08);
}

.note-card-preview-block.is-callout.tone-green {
  border-left-color: rgb(34 197 94);
  background: rgba(34, 197, 94, 0.08);
}

.note-card-preview-block.is-callout.tone-red {
  border-left-color: rgb(239 68 68);
  background: rgba(239, 68, 68, 0.08);
}

.note-card-preview-block.is-callout.tone-yellow {
  border-left-color: rgb(234 179 8);
  background: rgba(234, 179, 8, 0.12);
}

.note-card-preview-block.is-callout.tone-purple {
  border-left-color: rgb(168 85 247);
  background: rgba(168, 85, 247, 0.1);
}

.note-card-preview-block.is-callout.tone-black {
  border-left-color: rgb(82 82 91);
  background: rgba(63, 63, 70, 0.09);
}

.note-card-preview-block.is-code {
  margin: 0.55em 0;
  border-radius: 0.5rem;
  background: rgba(0, 0, 0, 0.05);
  color: rgb(63 63 70);
  padding: 0.5rem 0.75rem;
  font-family: var(--selected-font-code), 'Source Code Pro', monospace;
  font-size: 0.82rem;
  line-height: 1.45;
}

.dark .note-card-preview-block.is-code {
  background: rgba(82, 82, 91, 0.3);
  color: rgb(228 228 231);
}

.note-card-preview-block.is-media {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  margin: 0.55em 0;
  --preview-media-accent: rgb(14 165 233);
  --preview-media-surface: rgba(14, 165, 233, 0.1);
  --preview-media-surface-alt: rgba(59, 130, 246, 0.04);
  --preview-media-icon-surface: rgba(255, 255, 255, 0.58);
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
  --preview-media-accent: rgb(79 70 229);
  --preview-media-surface: rgba(99, 102, 241, 0.12);
  --preview-media-surface-alt: rgba(129, 140, 248, 0.05);
}

.note-card-preview-block.is-media.tone-math {
  --preview-media-accent: rgb(194 65 12);
  --preview-media-surface: rgba(249, 115, 22, 0.12);
  --preview-media-surface-alt: rgba(251, 146, 60, 0.05);
}

.note-card-preview-block.is-media.tone-sketch {
  --preview-media-accent: rgb(5 150 105);
  --preview-media-surface: rgba(16, 185, 129, 0.12);
  --preview-media-surface-alt: rgba(52, 211, 153, 0.05);
}

.note-card-preview-block.is-media.tone-file,
.note-card-preview-block.is-media.tone-audio,
.note-card-preview-block.is-media.tone-video {
  --preview-media-accent: rgb(8 145 178);
  --preview-media-surface: rgba(34, 211, 238, 0.12);
  --preview-media-surface-alt: rgba(6, 182, 212, 0.05);
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
  color: rgb(63 63 70);
  font-size: 0.82rem;
  line-height: 1.4;
}

.dark .note-card-preview-media-label {
  color: var(--preview-media-accent);
}

.dark .note-card-preview-media-icon {
  background: rgba(24, 24, 27, 0.45);
  color: var(--preview-media-accent);
}

.dark .note-card-preview-media-text {
  color: rgb(228 228 231);
}

.dark
  .note-card-preview-block.is-media.tone-diagram
  .note-card-preview-media-icon,
.dark
  .note-card-preview-block.is-media.tone-diagram
  .note-card-preview-media-label {
  color: rgb(165 180 252);
}

.dark .note-card-preview-block.is-media.tone-math .note-card-preview-media-icon,
.dark
  .note-card-preview-block.is-media.tone-math
  .note-card-preview-media-label {
  color: rgb(253 186 116);
}

.dark
  .note-card-preview-block.is-media.tone-sketch
  .note-card-preview-media-icon,
.dark
  .note-card-preview-block.is-media.tone-sketch
  .note-card-preview-media-label {
  color: rgb(110 231 183);
}

.dark .note-card-preview-block.is-media.tone-file,
.dark .note-card-preview-block.is-media.tone-audio,
.dark .note-card-preview-block.is-media.tone-video {
  --preview-media-accent: rgb(103 232 249);
}

.note-card-preview-image {
  display: block;
  width: 100%;
  max-height: 82px;
  border: 1px solid rgba(228, 228, 231, 0.9);
  border-radius: 0.5rem;
  object-fit: cover;
  background: rgb(244 244 245);
}

.dark .note-card-preview-image {
  border-color: rgba(63, 63, 70, 0.9);
  background: rgb(24 24 27);
}

.note-card-preview-table-wrap {
  overflow: hidden;
  border-radius: 0;
}

.note-card-preview-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  overflow: hidden;
  background: rgba(250, 250, 250, 0.95);
}

.dark .note-card-preview-table {
  background: rgba(24, 24, 27, 0.95);
}

.note-card-preview-table-row {
  background: transparent;
}

.note-card-preview-table-cell {
  overflow: hidden;
  border: 2px solid rgba(228, 228, 231, 0.9);
  background: transparent;
  padding: 0.42rem 0.48rem;
  color: rgb(63 63 70);
  font-size: 0.76rem;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-weight: 400;
}

.note-card-preview-table-cell:is(th) {
  background: rgba(63, 63, 70, 0.08);
  font-weight: 600;
}

.dark .note-card-preview-table-cell {
  border-color: rgba(82, 82, 91, 0.85);
  color: rgb(228 228 231);
}

.dark .note-card-preview-table-cell:is(th) {
  background: rgba(82, 82, 91, 0.28);
}

.note-card-preview-check {
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 2px solid #ccc;
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
  color: rgb(113 113 122);
  text-decoration: line-through;
}

.dark .note-card-preview-block.is-task.is-checked .note-card-preview-task-text {
  color: rgb(161 161 170);
}

.note-card-preview-meta {
  margin-top: 0.35rem;
  color: rgb(113 113 122);
  font-size: 0.78rem;
  font-weight: 500;
}

.dark .note-card-preview-meta {
  color: rgb(161 161 170);
}

.note-card-preview-empty {
  display: flex;
  height: 100%;
  align-items: center;
  color: rgb(161 161 170);
  font-size: 0.93rem;
  line-height: 1.5;
}

.dark .note-card-preview-empty {
  color: rgb(113 113 122);
}
</style>
