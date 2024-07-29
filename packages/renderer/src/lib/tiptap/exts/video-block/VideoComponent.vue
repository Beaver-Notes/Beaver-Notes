<template>
  <NodeViewWrapper>
    <div
      class="bg-neutral-100 dark:bg-[#353333] rounded-lg flex flex-col w-full"
    >
      <!-- Video Container -->
      <div class="relative w-full">
        <video
          id="videoPlayer"
          ref="videoPlayer"
          :src="videoSrc"
          controls
          class="w-full rounded-t-lg m-0"
          @timeupdate="updateProgress"
          @loadedmetadata="initialize"
          @ended="videoEnded"
          @error="videoError"
        ></video>
      </div>

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
            class="bg-amber-400 text-white p-2 ml-2 rounded-full"
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
            class="bg-amber-400 h-full rounded-full"
            :style="{ width: progressBarWidth }"
          ></div>
          <div
            class="absolute top-0 left-0 h-full w-4 bg-amber-500 rounded-full transform -translate-x-1/2"
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
            class="text-black py-1 px-3 rounded dark:text-[color:var(--selected-dark-text)]"
            @click="toggleSpeedOptions"
          >
            <v-remixicon name="riSpeedDial" />
          </button>
          <div
            v-show="showSpeedOptions"
            class="absolute bg-white border border-gray-300 rounded mt-2 py-1 shadow-lg dark:dark:bg-[#353333] dark:border-gray-500"
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
    const fileName = ref(props.node.attrs.fileName || '');
    const videoSrc = ref(props.node.attrs.src || '');
    const videoPlayer = ref(null);
    const isPlaying = ref(false);
    const currentTime = ref(0);
    const duration = ref(0);
    const isMuted = ref(false);
    const playbackRate = ref(1);
    const showSpeedOptions = ref(false);
    const playbackRates = [0.5, 1, 1.5, 2];

    onMounted(() => {
      videoPlayer.value.volume = 1;
      videoPlayer.value.playbackRate = playbackRate.value;
      preloadVideo();
    });

    const togglePlay = () => {
      if (isPlaying.value) {
        videoPlayer.value.pause();
      } else {
        videoPlayer.value.play();
      }
      isPlaying.value = !isPlaying.value;
    };

    const updateProgress = () => {
      if (videoPlayer.value) {
        currentTime.value = videoPlayer.value.currentTime;
      }
    };

    const seek = (event) => {
      const progressBar = event.target.closest('[role="progressbar"]');
      if (progressBar) {
        const boundingRect = progressBar.getBoundingClientRect();
        const offsetX = event.clientX - boundingRect.left;
        const newTime = (offsetX / progressBar.offsetWidth) * duration.value;
        if (videoPlayer.value) {
          videoPlayer.value.currentTime = newTime;
          currentTime.value = newTime;
        }
      }
    };

    const startDrag = (event) => {
      const progressBar = event.target.closest('[role="progressbar"]');
      const onMove = (moveEvent) => {
        const boundingRect = progressBar.getBoundingClientRect();
        const offsetX = moveEvent.clientX - boundingRect.left;
        const newTime = (offsetX / progressBar.offsetWidth) * duration.value;
        if (videoPlayer.value) {
          videoPlayer.value.currentTime = newTime;
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

    const preloadVideo = () => {
      const tempVideo = document.createElement('video');
      tempVideo.src = videoSrc.value;

      tempVideo.addEventListener('loadedmetadata', () => {
        if (!isNaN(tempVideo.duration) && tempVideo.duration > 0) {
          duration.value = tempVideo.duration;
        } else {
          console.error('Invalid video duration');
        }
      });

      tempVideo.addEventListener('error', (event) => {
        console.error('Error loading video metadata:', event);
      });
    };

    const videoEnded = () => {
      isPlaying.value = false;
    };

    const toggleMute = () => {
      if (videoPlayer.value) {
        isMuted.value = !isMuted.value;
        videoPlayer.value.muted = isMuted.value;
      }
    };

    const skipForward = () => {
      if (videoPlayer.value) {
        videoPlayer.value.currentTime = Math.min(
          videoPlayer.value.currentTime + 5,
          duration.value
        );
        currentTime.value = videoPlayer.value.currentTime;
      }
    };

    const skipBackward = () => {
      if (videoPlayer.value) {
        videoPlayer.value.currentTime = Math.max(
          videoPlayer.value.currentTime - 5,
          0
        );
        currentTime.value = videoPlayer.value.currentTime;
      }
    };

    const toggleSpeedOptions = () => {
      showSpeedOptions.value = !showSpeedOptions.value;
    };

    const setPlaybackRate = (speed) => {
      playbackRate.value = speed;
      if (videoPlayer.value) {
        videoPlayer.value.playbackRate = speed;
      }
      showSpeedOptions.value = false;
    };

    const progressBarWidth = computed(() => {
      return duration.value
        ? `${(currentTime.value / duration.value) * 100}%`
        : '0%';
    });

    const formattedCurrentTime = computed(() => {
      return formatTime(currentTime.value);
    });

    const formattedDuration = computed(() => {
      return formatTime(duration.value);
    });

    const formatTime = (time) => {
      const minutes = Math.floor(time / 60);
      const seconds = Math.floor(time % 60)
        .toString()
        .padStart(2, '0');
      return `${minutes}:${seconds}`;
    };

    return {
      fileName,
      videoSrc,
      duration,
      progressBarWidth,
      videoPlayer,
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
      videoEnded,
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

<style scoped>
video::-webkit-media-controls {
  display: none;
}

video::-webkit-media-controls-play-button {
  display: none;
}

video::-webkit-media-controls-volume-slider {
  display: none;
}

video::-webkit-media-controls-mute-button {
  display: none;
}

video::-webkit-media-controls-timeline {
  display: none;
}

video::-webkit-media-controls-current-time-display {
  display: none;
}

.relative {
  position: relative;
}

.absolute {
  position: absolute;
}
</style>
