<template>
  <div
    v-if="isRecording"
    class="fixed z-[70] bottom-6 left-1/2 -translate-x-1/2 mobile:bottom-[calc(var(--app-keyboard-inset-bottom)+4.25rem)]"
    role="region"
    aria-label="Audio recording"
  >
    <div
      class="flex items-center gap-0.5 rounded-full border border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-900/95 py-1 pl-1.5 pr-1.5 shadow-xl backdrop-blur-sm"
    >
      <button
        type="button"
        class="flex items-center gap-2 rounded-full h-9 pl-2.5 pr-3 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        :aria-label="goToTargetLabel"
        @click="goToTargetNote"
      >
        <span class="rec-dot size-2.5 rounded-full bg-red-500" />
        <span
          class="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100"
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
        <v-remixicon :name="isPaused ? 'riPlayFill' : 'riPauseFill'" class="size-4" />
      </button>
      <button
        type="button"
        class="flex items-center justify-center rounded-full size-9 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        aria-label="Stop recording"
        @click.stop="stop()"
      >
        <v-remixicon name="riStopCircleLine" class="size-5 text-red-500" />
      </button>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAudioRecorder } from '@/composable/useAudioRecorder';
import { useNoteStore } from '@/store/note';
import { insertAudioIntoClosedNote } from '@/utils/assets/audioInsert';

export default {
  setup() {
    const router = useRouter();
    const noteStore = useNoteStore();
    const recorder = useAudioRecorder();
    const { isRecording, isPaused, formattedTime, targetNoteId } = recorder;

    const recordingNoteTitle = computed(() => {
      const note = noteStore.getById(targetNoteId.value);
      return note?.title || 'Recording';
    });

    const goToTargetLabel = computed(() =>
      `Go to note: ${recordingNoteTitle.value}`
    );

    function goToTargetNote() {
      const route = router.currentRoute.value;
      if (
        route.name === 'Note' &&
        route.params.id === targetNoteId.value
      ) {
        return;
      }
      router.push({ name: 'Note', params: { id: targetNoteId.value } });
    }

    // Global fallback: when the recording's note is not the currently open
    // note page, append the audio into the closed note's store content. The
    // open note page handles its own insert, so the two never race.
    recorder.onStopped(({ filePath, noteId }) => {
      const route = router.currentRoute.value;
      const openNoteId = route.name === 'Note' ? route.params.id : null;
      if (noteId === openNoteId) return;
      void insertAudioIntoClosedNote(noteId, filePath, noteStore).catch(
        (error) => {
          console.error('Failed to insert recording into note:', error);
        }
      );
    });

    return {
      isRecording,
      isPaused,
      formattedTime,
      recordingNoteTitle,
      goToTargetLabel,
      goToTargetNote,
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
