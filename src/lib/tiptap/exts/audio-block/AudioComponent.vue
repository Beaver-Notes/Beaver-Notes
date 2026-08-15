<template>
  <NodeViewWrapper>
    <div class="bg-neutral-100 dark:bg-neutral-800 rounded-lg w-full">
      <!-- Hidden Audio Element -->
      <audio
        ref="audioPlayer"
        :src="audioSrc"
        class="hidden"
        preload="metadata"
        @timeupdate="updateProgress"
        @loadedmetadata="initialize"
        @durationchange="onDurationChange"
        @canplay="readDuration"
        @ended="audioEnded"
        @error="audioError"
      ></audio>

      <!-- Controls: compact row on desktop; three-tier layout on mobile -->
      <div
        class="flex items-center w-full py-3 px-1 space-x-2 mobile:flex-col mobile:items-stretch mobile:gap-2 mobile:space-x-0 mobile:px-2 mobile:py-2.5"
      >
        <!-- Transport: skip back / play-pause / skip forward -->
        <div
          class="flex items-center border-r-2 rtl:border-none mobile:border-r-0 mobile:justify-center mobile:gap-3 mobile:w-full"
        >
          <button
            type="button"
            class="flex items-center justify-center rounded-full text-neutral-700 dark:text-[color:var(--selected-dark-text)] size-9 mobile:size-11 hover:bg-black/5 dark:hover:bg-white/10 transition-colors touch-manipulation"
            aria-label="Skip backward 5 seconds"
            @click="skipBackward"
          >
            <v-remixicon name="riBack5" class="size-4 mobile:size-5" />
          </button>

          <button
            type="button"
            class="flex items-center justify-center rounded-full bg-primary text-white size-9 mobile:size-12 shadow-lg shadow-primary/25 hover:bg-primary/90 active:scale-95 transition-transform touch-manipulation"
            :aria-label="isPlaying ? 'Pause' : 'Play'"
            @click="togglePlay"
          >
            <v-remixicon
              :name="isPlaying ? 'riPauseFill' : 'riPlayFill'"
              class="size-4 mobile:size-6"
            />
          </button>

          <button
            type="button"
            class="flex items-center justify-center rounded-full text-neutral-700 dark:text-[color:var(--selected-dark-text)] size-9 mobile:size-11 hover:bg-black/5 dark:hover:bg-white/10 transition-colors touch-manipulation"
            aria-label="Skip forward 5 seconds"
            @click="skipForward"
          >
            <v-remixicon name="riFoward5" class="size-4 mobile:size-5" />
          </button>
        </div>

        <!-- Timeline: current time - progress - duration -->
        <div class="flex items-center flex-1 min-w-0 gap-1 mobile:w-full">
          <span
            class="shrink-0 tabular-nums text-neutral-700 dark:text-neutral-300 mx-2 mobile:mx-0 mobile:min-w-[3rem] mobile:text-right"
          >
            {{ formattedCurrentTime }}
          </span>

          <div
            class="flex-grow mx-2 mobile:mx-0 h-1.5 mobile:h-2 bg-neutral-200 rounded-full overflow-hidden dark:bg-neutral-700 relative cursor-pointer touch-manipulation"
            role="progressbar"
            :aria-valuenow="currentTime"
            aria-valuemin="0"
            :aria-valuemax="duration"
            @click="seek"
          >
            <div
              class="bg-primary h-full rounded-full"
              :style="{ width: progressBarWidth }"
            ></div>
            <div
              class="absolute top-0 left-0 h-full w-4 bg-secondary rounded-full transform -translate-x-1/2 cursor-grab active:cursor-grabbing"
              :style="{ left: progressBarWidth }"
              @pointerdown="startDrag"
            ></div>
          </div>

          <span
            class="shrink-0 tabular-nums text-neutral-700 dark:text-neutral-300 mx-2 mobile:mx-0 mobile:min-w-[3rem]"
          >
            {{ formattedDuration }}
          </span>
        </div>

        <!-- Secondary: mute + speed -->
        <div
          class="flex items-center mobile:w-full mobile:justify-between mobile:border-t mobile:border-neutral-200 mobile:dark:border-neutral-700 mobile:pt-1.5"
        >
          <button
            type="button"
            class="flex items-center justify-center rounded-full text-neutral-700 dark:text-[color:var(--selected-dark-text)] size-9 mobile:size-11 hover:bg-black/5 dark:hover:bg-white/10 transition-colors touch-manipulation"
            :aria-label="isMuted ? 'Unmute' : 'Mute'"
            @click="toggleMute"
          >
            <v-remixicon
              :name="isMuted ? 'riVolumeMuteFill' : 'riVolumeDownFill'"
              class="size-4 mobile:size-5"
            />
          </button>

          <div class="flex items-center ml-4 mobile:ml-0 relative">
            <button
              type="button"
              class="flex items-center rounded text-neutral-700 dark:text-[color:var(--selected-dark-text)] py-1 px-3 touch-manipulation"
              @click="toggleSpeedOptions"
            >
              <v-remixicon name="riSpeedDial" />
            </button>
            <div
              v-show="showSpeedOptions"
              class="absolute right-0 bg-white border border-gray-300 rounded mt-2 py-1 shadow-lg dark:bg-neutral-700 dark:border-gray-500"
            >
              <button
                v-for="speed in playbackRates"
                :key="speed"
                class="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 dark:text-[color:var(--selected-dark-text)] dark:hover:bg-neutral-600"
                @click="setPlaybackRate(speed)"
              >
                {{ speed }}x
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<script>
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { ref, onMounted, computed } from 'vue';

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
    const isMuted = ref(false);
    const playbackRate = ref(1);
    const showSpeedOptions = ref(false);
    const playbackRates = [0.5, 1, 1.5, 2];

    const loadAudioFromFile = async () => {
      try {
        const filePath = props.node.attrs.src;
        audioSrc.value = filePath;
      } catch (error) {
        console.error('Failed to read audio file:', error);
      }
    };

    onMounted(() => {
      audioPlayer.value.volume = 1;
      audioPlayer.value.playbackRate = playbackRate.value;
      loadAudioFromFile();
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

    const onDurationChange = () => {
      readDuration();
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

    const toggleMute = () => {
      if (!audioPlayer.value) return;
      isMuted.value = !isMuted.value;
      audioPlayer.value.muted = isMuted.value;
    };

    const skipForward = () => {
      if (!audioPlayer.value) return;
      const newTime = Math.min(
        audioPlayer.value.currentTime + 5,
        duration.value
      );
      audioPlayer.value.currentTime = newTime;
      currentTime.value = newTime;
    };

    const skipBackward = () => {
      if (!audioPlayer.value) return;
      const newTime = Math.max(audioPlayer.value.currentTime - 5, 0);
      audioPlayer.value.currentTime = newTime;
      currentTime.value = newTime;
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

    const formattedCurrentTime = computed(() => formatTime(currentTime.value));
    const formattedDuration = computed(() => formatTime(duration.value));

    const formatTime = (time) => {
      const minutes = Math.floor(time / 60);
      const seconds = Math.floor(time % 60)
        .toString()
        .padStart(2, '0');
      return `${minutes}:${seconds}`;
    };

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
      isMuted,
      togglePlay,
      updateProgress,
      initialize,
      onDurationChange,
      readDuration,
      seek,
      startDrag,
      toggleMute,
      skipForward,
      skipBackward,
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
