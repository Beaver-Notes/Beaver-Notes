<template>
  <NodeViewWrapper>
    <div
      class="mt-2 mb-2 bg-neutral-100 dark:bg-[#353333] p-3 rounded-lg flex items-center justify-between w-full"
    >
      <audio
        id="audioPlayer"
        ref="audioPlayer"
        :src="audioSrc"
        class="hidden"
        @timeupdate="updateProgress"
        @loadedmetadata="initialize"
        @ended="audioEnded"
        @error="audioError"
      ></audio>
      <div class="flex items-center border-r-2 rtl:border-none">
        <button class="py-1 px-3 rounded" @click="skipBackward">
          <v-remixicon name="riBack5" />
        </button>
        <button
          class="bg-primary text-white p-2 rounded-full hover:bg-secondary ml-2"
          @click="togglePlay"
        >
          <v-remixicon :name="isPlaying ? 'riPauseFill' : 'riPlayFill'" />
        </button>
        <button class="py-1 px-3 ml-2" @click="skipForward">
          <v-remixicon name="riFoward5" />
        </button>
      </div>
      <span
        v-if="fileName"
        class="ml-4 text-sm text-neutral-700 dark:text-neutral-300"
        >{{ fileName }}</span
      >
      <span class="ml-4 text-sm text-neutral-700 dark:text-neutral-300">{{
        formattedCurrentTime
      }}</span>
      <div
        class="flex w-full mx-4 h-1.5 bg-gray-200 rounded-full overflow-hidden dark:bg-neutral-700 relative"
        role="progressbar"
        :aria-valuenow="currentTime"
        aria-valuemin="0"
        :aria-valuemax="duration"
        @click="seek"
      >
        <div
          class="flex flex-col justify-center rounded-full bg-primary text-xs text-white text-center transition duration-500 dark:bg-primary"
          :style="{ width: progressBarWidth }"
        ></div>
        <div
          class="absolute top-0 left-0 h-full w-4 bg-secondary rounded-full transform -translate-x-1/2"
          :style="{ left: progressBarWidth }"
          @mousedown="startDrag"
        ></div>
      </div>
      <span class="ml-4 text-sm text-neutral-700 dark:text-neutral-300">{{
        formattedDuration
      }}</span>
      <input
        v-model="currentTime"
        type="range"
        class="hidden w-full appearance-none h-2 bg-gray-200 rounded-lg cursor-pointer dark:bg-gray-700"
        min="0"
        :max="duration"
      />
      <div class="flex items-center ml-4">
        <button
          class="text-black py-1 px-3 rounded dark:text-[color:var(--selected-dark-text)]"
          @click="toggleMute"
        >
          <v-remixicon
            :name="isMuted ? 'riVolumeMuteFill' : 'riVolumeDownFill'"
          />
        </button>
      </div>
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
  </NodeViewWrapper>
</template>

<script>
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { ref, onMounted, computed } from 'vue';

export default {
  components: { NodeViewWrapper },
  props: nodeViewProps,
  setup(props) {
    const fileName = ref(props.node.attrs.fileName || '');
    const audioSrc = ref('');
    const audioPlayer = ref(null);
    const isPlaying = ref(false);
    const currentTime = ref(0);
    const duration = ref(0);
    const isMuted = ref(false);
    const playbackRate = ref(1);
    const showSpeedOptions = ref(false);
    const playbackRates = [0.5, 1, 1.5, 2];

    // Read and convert audio file via IPC
    const loadAudioFile = async () => {
      try {
        const filePath = props.node.attrs.src; // Full path to audio file
        audioSrc.value = filePath;
        preloadAudio();
      } catch (error) {
        console.error('Failed to load audio file via IPC:', error);
      }
    };

    onMounted(() => {
      loadAudioFile();
    });

    const togglePlay = () => {
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
      if (progressBar) {
        const boundingRect = progressBar.getBoundingClientRect();
        const offsetX = event.clientX - boundingRect.left;
        const newTime = (offsetX / progressBar.offsetWidth) * duration.value;
        if (audioPlayer.value) {
          audioPlayer.value.currentTime = newTime;
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
      const tempAudio = new Audio(audioSrc.value);
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
      if (audioPlayer.value) {
        isMuted.value = !isMuted.value;
        audioPlayer.value.muted = isMuted.value;
      }
    };

    const skipForward = () => {
      if (audioPlayer.value) {
        audioPlayer.value.currentTime = Math.min(
          audioPlayer.value.currentTime + 5,
          duration.value
        );
        currentTime.value = audioPlayer.value.currentTime;
      }
    };

    const skipBackward = () => {
      if (audioPlayer.value) {
        audioPlayer.value.currentTime = Math.max(
          audioPlayer.value.currentTime - 5,
          0
        );
        currentTime.value = audioPlayer.value.currentTime;
      }
    };

    const toggleSpeedOptions = () => {
      showSpeedOptions.value = !showSpeedOptions.value;
    };

    const setPlaybackRate = (speed) => {
      playbackRate.value = speed;
      if (audioPlayer.value) {
        audioPlayer.value.playbackRate = speed;
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
