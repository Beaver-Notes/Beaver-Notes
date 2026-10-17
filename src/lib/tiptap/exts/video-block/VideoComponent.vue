<template>
  <NodeViewWrapper>
    <div
      ref="cardEl"
      class="bn-video-card inline-flex flex-col w-full text-left align-top bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl"
      :title="fileName"
      :style="cardWidth"
    >
      <!-- Video Container -->
      <div class="relative w-full">
        <iframe
          v-if="youtubeEmbedSrc"
          :src="youtubeEmbedSrc"
          class="block w-full aspect-video rounded-t-xl m-0 bg-black"
          allowfullscreen
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerpolicy="strict-origin-when-cross-origin"
        ></iframe>
        <video
          v-else
          ref="videoPlayer"
          :src="videoSrc"
          playsinline
          preload="metadata"
          class="block w-full rounded-t-xl m-0 bg-black"
          @click="togglePlay"
          @timeupdate="updateProgress"
          @loadedmetadata="initialize"
          @ended="videoEnded"
          @error="videoError"
        ></video>
        <button
          type="button"
          class="bn-image-resize-handle bn-image-resize-handle--left"
          aria-label="Resize video from the left"
          @pointerdown="startResize($event, 'left')"
        ></button>
        <button
          type="button"
          class="bn-image-resize-handle bn-image-resize-handle--right"
          aria-label="Resize video from the right"
          @pointerdown="startResize($event, 'right')"
        ></button>
      </div>

      <!-- Controls Row -->
      <div v-if="!youtubeEmbedSrc" class="flex items-center gap-1 px-3 py-1.5 min-w-0">
        <button
          type="button"
          class="flex items-center justify-center shrink-0 rounded-full size-7 text-neutral-500 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10 transition-colors touch-manipulation"
          aria-label="Back 5 seconds"
          @click="skipBackward"
        >
          <v-remixicon name="riBack5" class="size-4" />
        </button>
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
        <button
          type="button"
          class="flex items-center justify-center shrink-0 rounded-full size-7 text-neutral-500 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10 transition-colors touch-manipulation"
          aria-label="Forward 5 seconds"
          @click="skipForward"
        >
          <v-remixicon name="riFoward5" class="size-4" />
        </button>
        <p
          class="video-time shrink-0 tabular-nums text-xs text-neutral-500 dark:text-neutral-400"
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
        <button
          type="button"
          class="flex items-center justify-center shrink-0 rounded-full size-8 text-neutral-500 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10 transition-colors touch-manipulation"
          :aria-label="isMuted ? 'Unmute' : 'Mute'"
          @click="toggleMute"
        >
          <v-remixicon
            :name="isMuted ? 'riVolumeMuteFill' : 'riVolumeDownFill'"
            class="size-4"
          />
        </button>
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
              type="button"
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
import { ref, onMounted, computed, watch } from 'vue';
import { formatMediaTime } from '@/utils/mediaTime.js';
import { youtubeEmbedId } from '@/lib/share/extractContent';

export default {
  components: {
    NodeViewWrapper,
  },
  props: nodeViewProps,
  setup(props) {
    const fileName = ref(props.node.attrs.fileName || '');
    const videoSrc = ref('');
    const youtubeEmbedSrc = computed(() => {
      const id = youtubeEmbedId(videoSrc.value || props.node.attrs.src || '');
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : '';
    });
    const videoPlayer = ref(null);
    const cardEl = ref(null);
    const isPlaying = ref(false);
    const currentTime = ref(0);
    const duration = ref(0);
    const isMuted = ref(false);
    const playbackRate = ref(1);
    const showSpeedOptions = ref(false);
    const playbackRates = [0.5, 1, 1.5, 2];

    const cardWidth = computed(() => {
      const w = Number(props.node.attrs.width);
      return Number.isFinite(w) && w > 0
        ? { width: `${w}px`, maxWidth: '100%' }
        : {};
    });

    const videoLayout = computed(() => {
      const layout = props.node.attrs.layout;
      return layout === 'wrap-left' || layout === 'wrap-right'
        ? layout
        : 'block';
    });

    const syncVideoLayout = () => {
      // cardEl's parent is the NodeViewWrapper root — mirror the image
      // layout convention so the same editor.css float rules apply.
      const wrapper = cardEl.value?.parentElement;
      if (!wrapper) return;
      wrapper.classList.add('bn-video-node');
      wrapper.dataset.layout = videoLayout.value;
      // Mirror the vanilla image view's selectNode(): tiptap only exposes
      // selection as a prop, so sync the class the resize handles gate on.
      wrapper.classList.toggle('is-selected', !!props.selected);
    };

    onMounted(() => {
      if (videoPlayer.value) {
        videoPlayer.value.volume = 1;
        videoPlayer.value.playbackRate = playbackRate.value;
      }
      videoSrc.value = props.node.attrs.src;
      syncVideoLayout();
    });

    watch(
      [() => props.node.attrs.layout, () => props.selected],
      syncVideoLayout,
    );

    // Background-saved assets swap src after insert; follow the attr so the
    // player picks up the final assets:// URL without a remount.
    watch(
      () => props.node.attrs.src,
      (src) => {
        videoSrc.value = src;
      },
    );

    const readDuration = () => {
      const el = videoPlayer.value;
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
      const el = videoPlayer.value;
      if (el) currentTime.value = el.currentTime || 0;
    };

    const togglePlay = () => {
      if (!videoPlayer.value) return;
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
      if (!progressBar) return;

      const boundingRect = progressBar.getBoundingClientRect();
      const offsetX = event.clientX - boundingRect.left;
      const newTime = (offsetX / progressBar.offsetWidth) * duration.value;

      if (videoPlayer.value) {
        videoPlayer.value.currentTime = newTime;
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
        if (videoPlayer.value) {
          videoPlayer.value.currentTime = newTime;
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

    const startResize = (event, side) => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      const el = cardEl.value;
      if (!el) return;
      const startX = event.clientX;
      const startWidth = Number(props.node.attrs.width) || el.offsetWidth;
      const parentWidth = el.parentElement ? el.parentElement.offsetWidth : 0;
      const maxWidth = parentWidth > 0 ? parentWidth : startWidth;
      el.parentElement?.classList.add('is-resizing');
      const onMove = (moveEvent) => {
        const delta =
          side === 'right'
            ? moveEvent.clientX - startX
            : startX - moveEvent.clientX;
        // 280px floor: the control row needs ~250px even with time hidden.
        const newWidth = Math.min(
          Math.max(Math.round(startWidth + delta), 280),
          Math.max(maxWidth, 280),
        );
        props.updateAttributes({ width: newWidth });
      };
      const onUp = () => {
        el.parentElement?.classList.remove('is-resizing');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    };

    const videoEnded = () => {
      isPlaying.value = false;
    };

    const videoError = (event) => {
      const src = videoSrc.value || 'unknown';
      console.error('Video playback error:', src, event);
    };

    const toggleMute = () => {
      if (!videoPlayer.value) return;
      isMuted.value = !isMuted.value;
      videoPlayer.value.muted = isMuted.value;
    };

    const skipForward = () => {
      if (!videoPlayer.value) return;
      const newTime = Math.min(
        videoPlayer.value.currentTime + 5,
        duration.value,
      );
      videoPlayer.value.currentTime = newTime;
      currentTime.value = newTime;
    };

    const skipBackward = () => {
      if (!videoPlayer.value) return;
      const newTime = Math.max(videoPlayer.value.currentTime - 5, 0);
      videoPlayer.value.currentTime = newTime;
      currentTime.value = newTime;
    };

    const toggleSpeedOptions = () => {
      showSpeedOptions.value = !showSpeedOptions.value;
    };

    const setPlaybackRate = (rate) => {
      playbackRate.value = rate;
      if (videoPlayer.value) {
        videoPlayer.value.playbackRate = rate;
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

    return {
      fileName,
      videoSrc,
      youtubeEmbedSrc,
      duration,
      progressBarWidth,
      videoPlayer,
      cardEl,
      cardWidth,
      isPlaying,
      currentTime,
      isMuted,
      togglePlay,
      updateProgress,
      seek,
      startDrag,
      startResize,
      toggleMute,
      skipForward,
      skipBackward,
      videoEnded,
      initialize,
      videoError,
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
