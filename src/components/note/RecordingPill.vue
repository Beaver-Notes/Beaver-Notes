<template>
  <teleport to="#pill-dock" :disabled="!dockTarget">
    <ui-pill
      v-if="isRecording"
      :fixed="false"
      role="region"
      aria-label="Audio recording"
    >
      <!-- Solo (word count pill absent): full controls, tap behaves as before. -->
      <div v-if="isSolo" class="flex items-center gap-0.5 py-1 pl-1.5 pr-1.5">
        <button
          type="button"
          class="flex min-w-0 items-center gap-2 rounded-full h-9 pl-2.5 pr-3 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          :aria-label="goToTargetLabel"
          @click="goToTargetNote"
        >
          <span class="rec-dot size-2.5 shrink-0 rounded-full bg-red-500" />
          <span
            class="shrink-0 text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100"
            >{{ formattedTime }}</span
          >
          <span
            class="max-w-[11rem] truncate text-sm text-neutral-500 dark:text-neutral-400"
            >{{ recordingNoteTitle }}</span
          >
        </button>
        <button
          type="button"
          class="flex items-center justify-center rounded-full size-9 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-neutral-500 dark:text-neutral-400"
          :aria-label="isPaused ? 'Resume recording' : 'Pause recording'"
          @click.stop="pauseResume()"
        >
          <v-remixicon
            :name="isPaused ? 'riPlayFill' : 'riPauseFill'"
            class="size-4"
          />
        </button>
        <button
          type="button"
          class="flex items-center justify-center rounded-full size-9 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-neutral-500 dark:text-neutral-400"
          aria-label="Stop recording"
          @click.stop="stop()"
        >
          <v-remixicon name="riStopCircleLine" class="size-5 text-red-500" />
        </button>
      </div>
      <!-- Docked: Dynamic Island — dot toggle plus collapsible controls. -->
      <div v-else class="flex items-center py-1 pl-1.5 pr-1.5">
        <button
          type="button"
          class="flex h-9 shrink-0 items-center rounded-full px-2 transition-transform duration-200 ease-[var(--ease-snappy)] active:scale-95 motion-reduce:transition-none"
          :aria-expanded="isExpanded ? 'true' : 'false'"
          :aria-label="
            isExpanded ? 'Hide recording controls' : 'Show recording controls'
          "
          @click="toggle('recording')"
        >
          <span class="rec-dot size-2.5 shrink-0 rounded-full bg-red-500" />
        </button>
        <div
          class="flex items-center gap-0.5 overflow-hidden transition-[max-width,opacity] duration-300 ease-[var(--ease-snappy)] motion-reduce:transition-none"
          :class="isExpanded ? 'max-w-[20rem] opacity-100' : 'max-w-0 opacity-0'"
          :inert="!isExpanded"
        >
          <button
            type="button"
            class="flex h-9 shrink-0 min-w-0 items-center gap-2 rounded-full pl-2 pr-3 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            :aria-label="goToTargetLabel"
            @click="goToTargetNote"
          >
            <span
              class="shrink-0 text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100"
              >{{ formattedTime }}</span
            >
            <span
              class="max-w-[11rem] truncate text-sm text-neutral-500 dark:text-neutral-400"
              >{{ recordingNoteTitle }}</span
            >
          </button>
          <button
            type="button"
            class="flex shrink-0 items-center justify-center rounded-full size-9 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-neutral-500 dark:text-neutral-400"
            :aria-label="isPaused ? 'Resume recording' : 'Pause recording'"
            @click.stop="pauseResume()"
          >
            <v-remixicon
              :name="isPaused ? 'riPlayFill' : 'riPauseFill'"
              class="size-4"
            />
          </button>
          <button
            type="button"
            class="flex shrink-0 items-center justify-center rounded-full size-9 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-neutral-500 dark:text-neutral-400"
            aria-label="Stop recording"
            @click.stop="stop()"
          >
            <v-remixicon name="riStopCircleLine" class="size-5 text-red-500" />
          </button>
        </div>
      </div>
    </ui-pill>
  </teleport>
</template>

<script>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAudioRecorder } from '@/composable/useAudioRecorder';
import { usePillDock } from '@/composable/usePillDock';
import { useNoteStore } from '@/store/note';
import { insertAudioIntoClosedNote } from '@/utils/assets/audioInsert';

export default {
  setup() {
    const router = useRouter();
    const noteStore = useNoteStore();
    const recorder = useAudioRecorder();
    const { isRecording, isPaused, formattedTime, targetNoteId } = recorder;
    const { expandedPill, toggle } = usePillDock();

    // Dock target renders before any pill mounts; fall back inline when absent (isolated tests).
    const dockTarget =
      typeof document !== 'undefined' &&
      !!document.getElementById('pill-dock');

    // The word count pill only docks on the note page.
    const isSolo = computed(() => router.currentRoute.value.name !== 'Note');
    const isExpanded = computed(
      () => isSolo.value || (expandedPill.value ?? 'recording') === 'recording'
    );

    const recordingNoteTitle = computed(() => {
      const note = noteStore.getById(targetNoteId.value);
      return note?.title || 'Recording';
    });

    const goToTargetLabel = computed(
      () => `Go to note: ${recordingNoteTitle.value}`,
    );

    function goToTargetNote() {
      const route = router.currentRoute.value;
      if (route.name === 'Note' && route.params.id === targetNoteId.value) {
        return;
      }
      router.push({ name: 'Note', params: { id: targetNoteId.value } });
    }

    // Global fallback when the recording's note is not open in an editor. The
    // open note page claims itself via `recorder.openNoteId` (authority, not
    // the route), so the two paths can never race for the same note.
    recorder.onStopped((payload) => {
      const { filePath, noteId, cursorPos } = payload;
      if (noteId === recorder.openNoteId.value) return;
      payload.markConsumed();
      void insertAudioIntoClosedNote(
        noteId,
        filePath,
        noteStore,
        cursorPos,
      ).catch((error) => {
        console.error('Failed to insert recording into note:', error);
      });
    });

    return {
      isRecording,
      isPaused,
      formattedTime,
      recordingNoteTitle,
      goToTargetLabel,
      goToTargetNote,
      dockTarget,
      isSolo,
      isExpanded,
      toggle,
      pauseResume: recorder.pauseResume,
      stop: recorder.stop,
    };
  },
};
</script>

<style scoped>
.rec-dot {
  animation: recording-pulse 1.5s ease-in-out infinite;
}

@keyframes recording-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rec-dot {
    animation: none;
  }
}
</style>
