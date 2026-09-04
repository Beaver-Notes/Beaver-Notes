<template>
  <ui-card
    data-testid="note-card"
    class="hover:ring-1 hover:ring-primary/20 hover:shadow-[var(--shadow-md)] group note-card flex flex-col cursor-pointer"
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
          v-if="note.labels?.length"
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

      <div
        v-else
        class="relative h-[140px] mt-1.5 flex flex-col items-center justify-center gap-2 p-4 cursor-pointer"
        role="button"
        tabindex="0"
        :aria-label="translations.card.unlock || 'Unlock'"
        @click.stop="unlockNote(note.id)"
        @keydown.enter.stop="unlockNote(note.id)"
        @keydown.space.prevent.stop="unlockNote(note.id)"
      >
        <v-remixicon name="riLockLine" size="32" class="text-neutral-400 dark:text-neutral-500" />
        <span class="text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ translations.card.isLocked || 'Locked note' }}</span>
        <span class="text-[11px] text-neutral-400 dark:text-neutral-500 text-center leading-tight">{{ translations.card.unlockToEdit || 'Tap to unlock — Face ID / vault password' }}</span>
      </div>
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
          @click.stop="$emit('move', note)"
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

  </ui-card>
</template>

<script setup>
import dayjs from '@/lib/dayjs';
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useNoteStore } from '@/store/note';
import { isBiometricAvailable, authenticateWithBiometrics } from '@/lib/native/biometric.js';
import { verifyPassphrase } from '@/utils/crypto/encryption.js';
import { useGroupTooltip } from '@/composable/groupTooltip';
import { getSettingSync } from '@/lib/settings';
import { useTranslations } from '@/composable/useTranslations';
import { useRouter } from 'vue-router';
import { useDialog } from '@/lib/dialog';
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

const emit = defineEmits(['update', 'update:label', 'move']);

const labelStore = useLabelStore();
const router = useRouter();
const dialog = useDialog();
const { play } = useSounds();

const { translations } = useTranslations();

const preview = computed(() => {
  const cp = props.note?.cardPreview;
  return cp && (cp.blocks?.length || cp.hasMore || cp.mediaCount)
    ? cp
    : {
        blocks: [],
        hasMore: false,
        mediaCount: 0,
        visibleMediaCount: 0,
      };
});

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
  const noteStore = useNoteStore();
  try {
    await noteStore.lockNote(note);
  } catch (error) {
    console.error('Error locking note:', error);
  }
}

let biometricAvailableCache = null;
async function getBiometricAvailable() {
  if (biometricAvailableCache !== null) return biometricAvailableCache;
  try { biometricAvailableCache = await isBiometricAvailable(); } catch { biometricAvailableCache = false; }
  return biometricAvailableCache;
}

async function unlockNote(noteId) {
  const noteStore = useNoteStore();
  if (await getBiometricAvailable()) {
    try {
      await authenticateWithBiometrics('Unlock note');
      await noteStore.unlockNote(noteId);
      return;
    } catch (e) {
      const msg = String(e?.message || '');
      if (/cancel/i.test(msg) || /User canceled/i.test(msg)) return;
    }
  }
  // vault-password fallback uses the same UnlockCard as AppEncryptionGate/editor — open the note where that card is shown
  router.push(`/note/${noteId}`);
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

/* Touch-primary devices (phones, tablets without a mouse): hover is unreliable,
   so keep card actions visible instead of hover-revealed. */
@media (hover: none) {
  .note-card .invisible.group-hover\:visible,
  .note-card__action.invisible {
    visibility: visible !important;
  }
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

/* Preview — editor-faithful tokens
   Source A: src/assets/css/editor.css — ProseMirror pre/code border bg-neutral-50/dark:neutral-900 rounded-lg,
             blockquote dark:border-neutral-700, tableWrapper border-neutral-200/dark:neutral-700 th bg-neutral-100,
             rounded .75rem (--float-radius), bn-image-node
   Source B: src/lib/tiptap/exts/callouts/* — p-1 border-l-4 border-*-300 pl-4 bg-*-500 bg-opacity-10 (+dark variants)
             code-block uses --selected-font-code, table uses theme colors above
*/
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

.note-card-preview-block.is-quote {
  border-left: 3px solid theme('colors.neutral.300');
  margin: 0.5em 0;
  padding: 0.25rem 0.25rem 0.25rem 0.9rem;
  color: theme('colors.neutral.700');
}

.dark .note-card-preview-block.is-quote {
  border-left-color: theme('colors.neutral.600');
  color: var(--text-dark);
}

/* Callouts — faithful to src/lib/tiptap/exts/callouts/* cssClass */
.note-card-preview-block.is-callout {
  border-left-width: 4px;
  border-left-style: solid;
  margin: 0.5em 0;
  padding: 0.25rem 0.5rem 0.25rem 0.9rem;
  border-radius: 0 0.35rem 0.35rem 0;
}

.note-card-preview-block.is-callout.tone-blue {
  @apply border-blue-300 bg-blue-500/10;
}

.note-card-preview-block.is-callout.tone-yellow {
  @apply border-yellow-300 bg-yellow-500/10;
}

.note-card-preview-block.is-callout.tone-red {
  @apply border-red-300 bg-red-500/10;
}

.note-card-preview-block.is-callout.tone-purple {
  @apply border-purple-300 bg-purple-500/10;
}

.note-card-preview-block.is-callout.tone-green {
  @apply border-green-700 dark:border-green-500 bg-green-900/10 dark:bg-green-400/10;
}

.note-card-preview-block.is-callout.tone-black {
  @apply border-gray-700 dark:border-gray-500 bg-gray-900/10 dark:bg-gray-400/10;
}

/* Code — faithful to .ProseMirror pre/.inline-code in editor.css */
.note-card-preview-block.is-code {
  margin: 0.55em 0;
  @apply border bg-neutral-50 dark:bg-neutral-900 rounded-lg dark:text-neutral-200;
  color: theme('colors.neutral.700');
  padding: 0.5rem 0.75rem;
  font-family: var(--selected-font-code), 'Source Code Pro', monospace;
  font-size: 0.82rem;
  line-height: 1.45;
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
  border-radius: 0.75rem;
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
  border: 1px solid theme('colors.neutral.200 / 0.9');
  border-radius: 0.75rem;
  object-fit: cover;
  background: theme('colors.neutral.100');
}

.dark .note-card-preview-image {
  border-color: theme('colors.neutral.700 / 0.9');
  background: theme('colors.neutral.900');
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
  @apply bg-white dark:bg-neutral-900;
}

.dark .note-card-preview-table {
  background: theme('colors.zinc.900 / 0.95');
}

.note-card-preview-table-row {
  background: transparent;
}

.note-card-preview-table-cell {
  overflow: hidden;
  border: 1px solid theme('colors.neutral.200');
  background: transparent;
  padding: 0.42rem 0.48rem;
  color: theme('colors.neutral.700');
  font-size: 0.76rem;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-weight: 400;
}

.note-card-preview-table-cell:is(th) {
  background: theme('colors.neutral.100');
  font-weight: 600;
}

.dark .note-card-preview-table-cell {
  border-color: theme('colors.neutral.700');
  color: theme('colors.zinc.200');
}

.dark .note-card-preview-table-cell:is(th) {
  background: rgb(82 82 82 / 0.3);
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
</style>
