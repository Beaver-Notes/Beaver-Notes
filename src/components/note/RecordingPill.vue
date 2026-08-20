<template>
  <ui-pill v-if="isRecording" role="region" aria-label="Audio recording">
    <div
      class="flex items-center gap-0.5 py-1 pl-1.5 pr-1.5"
    >
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
  </ui-pill>
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

    // Global fallback: when the recording's note is not currently open in an
    // editor, append the audio into the closed note's store content. The open
    // note page handles its own insert and marks itself via `recorder.openNoteId`
    // (authority, not the route), so the two can never race for the same note.
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
