<template>
  <NodeViewWrapper>
    <div class="bg-neutral-100 dark:bg-neutral-800 rounded-lg w-full">
      <!-- Hidden Audio Element -->
      <audio
        ref="audioPlayer"
        :src="audioSrc"
        class="hidden"
        @timeupdate="updateProgress"
        @loadedmetadata="initialize"
        @ended="audioEnded"
        @error="audioError"
      ></audio>

      <!-- Controls Row -->
      <div class="flex items-center py-3 px-1 w-full space-x-2">
        <div class="border-r-2 rtl:border-none">
          <!-- Skip Backward Button -->
          <button
            class="text-neutral-700 dark:text-[color:var(--selected-dark-text)] py-1 px-3 rounded-full"
            @click="skipBackward"
          >
            <v-remixicon name="riBack5" />
          </button>

          <!-- Play/Pause Button -->
          <button
            class="bg-primary text-white p-2 ml-2 rounded-full"
            @click="togglePlay"
          >
            <v-remixicon :name="isPlaying ? 'riPauseFill' : 'riPlayFill'" />
          </button>

          <!-- Skip Forward Button -->
          <button
            class="text-neutral-700 dark:text-[color:var(--selected-dark-text)] py-1 px-3 ml-2 rounded-full"
            @click="skipForward"
          >
            <v-remixicon name="riFoward5" />
          </button>
        </div>

        <!-- Time Display -->
        <span class="text-neutral-700 dark:text-neutral-300 mx-2">
          {{ formattedCurrentTime }}
        </span>

        <!-- Progress Bar -->
        <div
          class="flex-grow mx-2 h-1.5 bg-neutral-200 rounded-full overflow-hidden dark:bg-neutral-700 relative"
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
            class="absolute top-0 left-0 h-full w-4 bg-secondary rounded-full transform -translate-x-1/2"
            :style="{ left: progressBarWidth }"
            @mousedown="startDrag"
          ></div>
        </div>

        <span class="text-neutral-700 dark:text-neutral-300 mx-2">
          {{ formattedDuration }}
        </span>

        <!-- Mute Button -->
        <button
          class="text-neutral-700 dark:text-[color:var(--selected-dark-text)] p-2"
          @click="toggleMute"
        >
          <v-remixicon
            :name="isMuted ? 'riVolumeMuteFill' : 'riVolumeDownFill'"
          />
        </button>

        <!-- Playback Speed -->
        <div class="flex items-center ml-4 relative">
          <button
            class="text-neutral-700 dark:text-[color:var(--selected-dark-text)] py-1 px-3 rounded"
            @click="toggleSpeedOptions"
          >
            <v-remixicon name="riSpeedDial" />
          </button>
          <div
            v-show="showSpeedOptions"
            class="absolute bg-white border border-gray-300 rounded mt-2 py-1 shadow-lg dark:bg-neutral-700 dark:border-gray-500"
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
        preloadAudio();
      } catch (error) {
        console.error('Failed to read audio file:', error);
      }
    };

    onMounted(() => {
      audioPlayer.value.volume = 1;
      audioPlayer.value.playbackRate = playbackRate.value;
      loadAudioFromFile();
    });

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
      const progressBar = event.target.closest('[role="progressbar"]');
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
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    const preloadAudio = () => {
      const tempAudio = document.createElement('audio');
      tempAudio.src = audioSrc.value;
      tempAudio.addEventListener('loadedmetadata', () => {
        if (!isNaN(tempAudio.duration) && tempAudio.duration > 0) {
          duration.value = tempAudio.duration;
        }
      });
      tempAudio.addEventListener('error', (event) => {
        console.error('Error loading audio metadata:', event);
      });
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
      seek,
      startDrag,
      toggleMute,
      skipForward,
      skipBackward,
      audioEnded,
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
