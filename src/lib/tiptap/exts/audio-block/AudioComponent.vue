<template>
  <NodeViewWrapper>
    <div
      class="bg-neutral-50 dark:bg-neutral-900 border rounded-xl w-full px-3 py-1.5"
      :title="fileName"
    >
      <audio
        ref="audioPlayer"
        :src="audioSrc"
        class="hidden"
        preload="metadata"
        @timeupdate="updateProgress"
        @loadedmetadata="initialize"
        @durationchange="readDuration"
        @canplay="readDuration"
        @ended="audioEnded"
        @error="audioError"
      ></audio>

      <div class="flex items-center gap-3 min-w-0">
        <button
          type="button"
          class="flex items-center justify-center shrink-0 rounded-full size-8 active:scale-95 transition touch-manipulation"
          :class="
            isPlaying
              ? 'text-primary hover:bg-black/5 dark:hover:bg-white/10'
              : 'text-neutral-700 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/10'
          "
          :aria-label="isPlaying ? 'Pause' : 'Play'"
          @click="togglePlay"
        >
          <v-remixicon
            :name="isPlaying ? 'riPauseFill' : 'riPlayFill'"
            class="size-4"
          />
        </button>
        <p
          class="shrink-0 tabular-nums text-xs text-neutral-500 dark:text-neutral-400"
        >
          {{ formattedCurrentTime }}/{{ formattedDuration }}
        </p>
        <div
          class="group h-3 flex flex-1 items-center cursor-pointer touch-manipulation min-w-12"
          role="progressbar"
          :aria-valuenow="currentTime"
          aria-valuemin="0"
          :aria-valuemax="duration"
          @click="seek"
        >
          <div
            class="relative h-1 w-full rounded-full bg-neutral-200 dark:bg-neutral-700"
          >
            <div
              class="absolute inset-y-0 left-0 rounded-full bg-primary"
              :style="{ width: progressBarWidth }"
            ></div>
            <div
              class="absolute top-1/2 size-3 rounded-full bg-primary cursor-grab active:cursor-grabbing -translate-x-1/2 -translate-y-1/2 transition-transform group-hover:scale-125"
              :style="{ left: progressBarWidth }"
              @pointerdown="startDrag"
            ></div>
          </div>
        </div>
        <div class="relative shrink-0">
          <button
            type="button"
            class="flex items-center justify-center rounded-full text-neutral-500 hover:bg-black/5 size-8 tabular-nums text-xs font-semibold dark:text-neutral-400 dark:hover:bg-white/10 transition-colors touch-manipulation"
            :aria-label="`Playback speed ${playbackRate}x`"
            @click="toggleSpeedOptions"
          >
            {{ playbackRate }}x
          </button>
          <div
            v-show="showSpeedOptions"
            class="absolute top-full mt-1 right-0 bg-white border border-neutral-200 rounded-lg py-1 shadow-lg dark:bg-neutral-700 dark:border-neutral-600 z-10"
          >
            <button
              v-for="speed in playbackRates"
              :key="speed"
              class="block w-full text-left px-4 py-1.5 text-sm tabular-nums transition-colors"
              :class="
                speed === playbackRate
                  ? 'font-semibold text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10'
              "
              @click="setPlaybackRate(speed)"
            >
              {{ speed }}x
            </button>
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<script>
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { ref, onMounted, computed } from 'vue';
import { formatMediaTime } from '@/utils/mediaTime.js';

export default {
  components: {
    NodeViewWrapper,
  },
  props: nodeViewProps,
  setup(props) {
    const audioSrc = ref('');
    const audioPlayer = ref(null);
    const isPlaying = ref(false);
    const currentTime = ref(0);
    const duration = ref(0);
    const playbackRate = ref(1);
    const showSpeedOptions = ref(false);
    const playbackRates = [0.5, 1, 1.5, 2];

    onMounted(() => {
      audioPlayer.value.volume = 1;
      audioPlayer.value.playbackRate = playbackRate.value;
      audioSrc.value = props.node.attrs.src;
    });

    const readDuration = () => {
      const el = audioPlayer.value;
      if (!el) return;
      const d = el.duration;
      // Some engines report Infinity until the media fully loads; only trust
      // finite, positive durations so the label never shows garbage.
      if (Number.isFinite(d) && d > 0) {
        duration.value = d;
      }
    };

    const initialize = () => {
      readDuration();
      const el = audioPlayer.value;
      if (el) currentTime.value = el.currentTime || 0;
    };

    const togglePlay = () => {
      if (!audioPlayer.value) return;
      if (isPlaying.value) {
        audioPlayer.value.pause();
      } else {
        audioPlayer.value.play();
      }
      isPlaying.value = !isPlaying.value;
    };

    const updateProgress = () => {
      if (audioPlayer.value) {
        currentTime.value = audioPlayer.value.currentTime;
      }
    };

    const seek = (event) => {
      const progressBar = event.target.closest('[role="progressbar"]');
      if (!progressBar) return;

      const boundingRect = progressBar.getBoundingClientRect();
      const offsetX = event.clientX - boundingRect.left;
      const newTime = (offsetX / progressBar.offsetWidth) * duration.value;

      if (audioPlayer.value) {
        audioPlayer.value.currentTime = newTime;
        currentTime.value = newTime;
      }
    };

    const startDrag = (event) => {
      if (event.cancelable) event.preventDefault();
      const progressBar = event.currentTarget.closest('[role="progressbar"]');
      if (!progressBar) return;
      const onMove = (moveEvent) => {
        const rect = progressBar.getBoundingClientRect();
        const offsetX = moveEvent.clientX - rect.left;
        const newTime = (offsetX / progressBar.offsetWidth) * duration.value;
        if (audioPlayer.value) {
          audioPlayer.value.currentTime = newTime;
          currentTime.value = newTime;
        }
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    };

    const audioEnded = () => {
      isPlaying.value = false;
    };

    const toggleSpeedOptions = () => {
      showSpeedOptions.value = !showSpeedOptions.value;
    };

    const setPlaybackRate = (rate) => {
      playbackRate.value = rate;
      if (audioPlayer.value) {
        audioPlayer.value.playbackRate = rate;
      }
      showSpeedOptions.value = false;
    };

    const progressBarWidth = computed(() => {
      return duration.value
        ? `${(currentTime.value / duration.value) * 100}%`
        : '0%';
    });

    const formattedCurrentTime = computed(() =>
      formatMediaTime(currentTime.value),
    );
    const formattedDuration = computed(() => formatMediaTime(duration.value));
    const fileName = computed(
      () => props.node.attrs.fileName || 'Audio recording',
    );

    const audioError = (event) => {
      const src = audioSrc.value || 'unknown';
      console.error('Audio playback error:', src, event);
    };

    return {
      audioSrc,
      duration,
      progressBarWidth,
      audioPlayer,
      isPlaying,
      currentTime,
      fileName,
      togglePlay,
      updateProgress,
      initialize,
      readDuration,
      seek,
      startDrag,
      audioEnded,
      audioError,
      formattedCurrentTime,
      formattedDuration,
      playbackRate,
      showSpeedOptions,
      playbackRates,
      toggleSpeedOptions,
      setPlaybackRate,
    };
  },
};
</script>
