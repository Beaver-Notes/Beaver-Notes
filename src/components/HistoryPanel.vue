<template>
  <div
    class="fixed top-0 right-0 z-50 h-full w-full max-w-5xl bg-white dark:bg-neutral-900 border-l border-neutral-200 dark:border-neutral-700 shadow-2xl flex flex-col rounded-l-xl overflow-hidden"
  >
    <!-- Header Bar -->
    <div class="flex items-center justify-between px-5 py-3 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-850">
      <div class="flex items-center gap-3">
        <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          Note History
        </h3>
        <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/40 rounded-full">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          Auto-saved
        </span>
        <span v-if="filteredCommits.length" class="text-xs text-neutral-400 dark:text-neutral-500">
          Last edited {{ relativeTime(filteredCommits[0]?.createdAt) }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <select
          :value="history.timeFilter.value"
          @change="history.setFilter($event.target.value)"
          class="text-xs border border-neutral-200 dark:border-neutral-600 rounded-md px-2 py-1 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          <option value="all">All</option>
          <option value="today">Today</option>
          <option value="week">This Week</option>
        </select>
        <button
          @click="$emit('close')"
          class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors p-1 rounded"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="history.loading.value && !filteredCommits.length" class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-3">
        <div class="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
        <span class="text-sm text-neutral-500">Loading history...</span>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="history.error.value" class="flex-1 flex items-center justify-center p-6">
      <div class="text-center">
        <div class="w-10 h-10 mx-auto mb-3 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <p class="text-sm text-red-600 dark:text-red-400">{{ history.error.value }}</p>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="!filteredCommits.length" class="flex-1 flex items-center justify-center p-6">
      <div class="text-center">
        <div class="w-10 h-10 mx-auto mb-3 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
          <svg class="w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p class="text-sm text-neutral-500">No history available</p>
      </div>
    </div>

    <!-- Main Content -->
    <div v-else class="flex-1 flex flex-col md:flex-row overflow-hidden">
      <!-- Scatter Chart -->
      <div class="flex-1 p-4 overflow-auto">
        <div class="relative w-full h-full min-h-[300px]">
          <!-- Y-axis labels -->
          <div class="absolute left-0 top-0 bottom-8 w-10 flex flex-col justify-between text-[10px] text-neutral-400 dark:text-neutral-500 pr-2">
            <span>6 AM</span>
            <span>2 PM</span>
            <span>10 PM</span>
          </div>
          <!-- Chart area -->
          <div class="ml-10 relative h-[calc(100%-32px)] border-b border-l border-neutral-200 dark:border-neutral-700">
            <!-- Horizontal grid lines -->
            <div class="absolute inset-0 flex flex-col justify-between pointer-events-none">
              <div class="border-t border-dashed border-neutral-200 dark:border-neutral-700 w-full h-0" style="top: 25%"></div>
              <div class="border-t border-dashed border-neutral-200 dark:border-neutral-700 w-full h-0" style="top: 50%"></div>
              <div class="border-t border-dashed border-neutral-200 dark:border-neutral-700 w-full h-0" style="top: 75%"></div>
            </div>
            <!-- Dots -->
            <div
              v-for="(commit, idx) in filteredCommits"
              :key="commit.hash"
              class="absolute w-3 h-3 rounded-full cursor-pointer transition-all duration-200 hover:scale-150 z-10"
              :class="[
                idx === history.selectedCommitIndex.value
                  ? 'bg-neutral-900 dark:bg-white ring-2 ring-neutral-900/30 dark:ring-white/30'
                  : 'bg-emerald-500 hover:bg-emerald-600',
              ]"
              :style="{
                left: dotPosition(commit).x + '%',
                top: dotPosition(commit).y + '%',
                transform: 'translate(-50%, -50%)',
              }"
              @mouseenter="history.selectCommit(idx)"
              @click="onDotClick(commit, idx)"
            ></div>
          </div>
          <!-- X-axis date labels -->
          <div class="ml-10 mt-1 flex justify-between text-[10px] text-neutral-400 dark:text-neutral-500">
            <span>{{ dateRangeLabel.min }}</span>
            <span v-if="dateRangeLabel.mid">{{ dateRangeLabel.mid }}</span>
            <span>{{ dateRangeLabel.max }}</span>
          </div>
        </div>
      </div>

      <!-- Inspector Card -->
      <transition
        enter-active-class="transition-all duration-200 ease-out"
        enter-from-class="translate-x-full opacity-0"
        enter-to-class="translate-x-0 opacity-100"
        leave-active-class="transition-all duration-150 ease-in"
        leave-from-class="translate-x-0 opacity-100"
        leave-to-class="translate-x-full opacity-0"
      >
        <div
          v-if="history.selectedCommitIndex.value >= 0 && selectedCommitData"
          class="w-full md:w-80 border-t md:border-t-0 md:border-l border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-850 flex flex-col overflow-auto"
        >
          <div class="p-4 space-y-4">
            <!-- Version header -->
            <div class="flex items-center justify-between">
              <div>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">Version</p>
                <p class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {{ filteredCommits.length - history.selectedCommitIndex.value }}
                </p>
              </div>
              <button
                @click="history.clearSelection()"
                class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <!-- Timestamp -->
            <div>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">Timestamp</p>
              <p class="text-sm text-neutral-700 dark:text-neutral-300">
                {{ formatDateTime(selectedCommitData.createdAt) }}
              </p>
            </div>

            <!-- Word count & diff -->
            <div class="flex gap-4">
              <div>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">Words</p>
                <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {{ wordCount.toLocaleString() }}
                </p>
              </div>
              <div v-if="wordDiff !== null">
                <p class="text-xs text-neutral-500 dark:text-neutral-400">Change</p>
                <p
                  class="text-sm font-medium"
                  :class="wordDiff > 0 ? 'text-emerald-600 dark:text-emerald-400' : wordDiff < 0 ? 'text-red-600 dark:text-red-400' : 'text-neutral-500'"
                >
                  {{ wordDiff > 0 ? '+' : '' }}{{ wordDiff.toLocaleString() }}
                </p>
              </div>
            </div>

            <!-- Snippet -->
            <div v-if="snippet">
              <p class="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Preview</p>
              <p class="text-xs text-neutral-600 dark:text-neutral-400 line-clamp-3 leading-relaxed">
                {{ snippet }}
              </p>
            </div>

            <!-- Author -->
            <div v-if="selectedCommitData.authorName">
              <p class="text-xs text-neutral-500 dark:text-neutral-400">Author</p>
              <p class="text-sm text-neutral-700 dark:text-neutral-300">
                {{ selectedCommitData.authorName }}
              </p>
            </div>

            <!-- Actions -->
            <div class="flex gap-2 pt-2">
              <button
                @click="togglePreview"
                class="flex-1 px-3 py-2 text-xs font-medium rounded-lg border border-neutral-200 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                {{ showPreview ? 'Hide Preview' : 'Preview Note' }}
              </button>
              <button
                @click="$emit('restore', selectedCommitData)"
                class="flex-1 px-3 py-2 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                Restore Version
              </button>
            </div>
          </div>

          <!-- Preview editor -->
          <div
            v-if="showPreview"
            class="border-t border-neutral-200 dark:border-neutral-700 p-4 max-h-[40vh] overflow-auto"
          >
            <div ref="previewEditorEl" class="prose prose-sm dark:prose-invert max-w-none"></div>
          </div>
        </div>
      </transition>
    </div>

    <!-- Rotary Wheel Timeline -->
    <div class="border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-850 px-4 py-3">
      <div class="flex items-center gap-3">
        <button
          @click="rotateWheel(-40)"
          class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors px-1"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div class="flex-1 overflow-hidden">
          <div class="text-center mb-1">
            <span class="text-xs font-medium text-neutral-700 dark:text-neutral-300">
              {{ activeDateLabel }}
            </span>
          </div>
          <div
            ref="rotaryContainer"
            class="relative h-8 cursor-grab active:cursor-grabbing"
            @mousedown="onDragStart"
            @wheel.prevent="onWheel"
          >
            <!-- Tick marks -->
            <svg class="w-full h-full" :viewBox="`0 0 ${wheelTickCount * 12} 32`" preserveAspectRatio="none">
              <line
                v-for="i in wheelTickCount"
                :key="i"
                :x1="i * 12 - 6"
                y1="8"
                :x2="i * 12 - 6"
                :y2="getTickHeight(i)"
                :stroke="isTickActive(i) ? '#059669' : '#d1d5db'"
                :stroke-width="isTickActive(i) ? 2 : 1"
                stroke-linecap="round"
              />
            </svg>
            <!-- Center pointer -->
            <div class="absolute left-1/2 top-0 -translate-x-1/2 w-0.5 h-full bg-emerald-500 rounded-full"></div>
          </div>
        </div>

        <button
          @click="rotateWheel(40)"
          class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors px-1"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, nextTick, onBeforeUnmount, watch } from 'vue';
import { useNoteHistory } from '@/composable/useNoteHistory';

export default {
  props: {
    noteId: { type: String, required: true },
    workspaceId: { type: String, default: '' },
  },
  emits: ['close', 'restore'],
  setup(props, { emit }) {
    const history = useNoteHistory();
    const showPreview = ref(false);
    const previewEditorEl = ref(null);
    const rotaryContainer = ref(null);
    const wheelOffset = ref(0);
    let previewEditor = null;

    // --- Scatter chart ---
    function dotPosition(commit) {
      const d = new Date(commit.createdAt);
      const hours = d.getHours() + d.getMinutes() / 60;
      const y = (hours / 24) * 100;
      const commits = history.filteredCommits.value;
      if (commits.length <= 1) return { x: 50, y };
      const timestamps = commits.map((c) => new Date(c.createdAt).getTime());
      const minTs = Math.min(...timestamps);
      const maxTs = Math.max(...timestamps);
      const range = maxTs - minTs || 1;
      const x = ((d.getTime() - minTs) / range) * 80 + 10;
      return { x, y };
    }

    const dateRangeLabel = computed(() => {
      const commits = history.filteredCommits.value;
      if (!commits.length) return { min: '', mid: '', max: '' };
      const timestamps = commits.map((c) => new Date(c.createdAt).getTime());
      const minTs = Math.min(...timestamps);
      const maxTs = Math.max(...timestamps);
      const min = formatShortDate(new Date(minTs));
      const max = formatShortDate(new Date(maxTs));
      const mid = minTs !== maxTs ? formatShortDate(new Date((minTs + maxTs) / 2)) : '';
      return { min, mid, max };
    });

    function formatShortDate(d) {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    async function onDotClick(commit, idx) {
      history.selectCommit(idx);
      await history.loadSnapshot(commit.hash);
    }

    // --- Inspector card ---
    const selectedCommitData = computed(() => {
      const idx = history.selectedCommitIndex.value;
      if (idx < 0) return null;
      return history.filteredCommits.value[idx] || null;
    });

    const wordCount = computed(() => {
      if (history.selectedCommit.value?.content) {
        return history.selectedCommit.value.content
          .replace(/<[^>]*>/g, ' ')
          .split(/\s+/)
          .filter(Boolean).length;
      }
      return selectedCommitData.value?.wordCount || 0;
    });

    const wordDiff = computed(() => {
      const idx = history.selectedCommitIndex.value;
      if (idx < 0) return null;
      const commits = history.filteredCommits.value;
      const current = commits[idx]?.wordCount || 0;
      if (idx >= commits.length - 1) return null;
      const prev = commits[idx + 1]?.wordCount || 0;
      return current - prev;
    });

    const snippet = computed(() => {
      if (history.selectedCommit.value?.content) {
        return history.selectedCommit.value.content.replace(/<[^>]*>/g, '').slice(0, 120);
      }
      return selectedCommitData.value?.snippet || '';
    });

    // --- Preview editor ---
    async function togglePreview() {
      showPreview.value = !showPreview.value;
      if (showPreview.value && history.selectedCommit.value?.content) {
        await nextTick();
        const { Editor } = await import('@tiptap/core');
        const { extensions } = await import('@/lib/tiptap');
        destroyPreviewEditor();
        previewEditor = new Editor({
          element: previewEditorEl.value,
          editable: false,
          extensions,
          content: history.selectedCommit.value.content,
        });
      } else {
        destroyPreviewEditor();
      }
    }

    function destroyPreviewEditor() {
      if (previewEditor) {
        previewEditor.destroy();
        previewEditor = null;
      }
    }

    // --- Rotary wheel ---
    const wheelTickCount = computed(() => Math.max(history.filteredCommits.value.length, 20));

    function getTickHeight(i) {
      const commits = history.filteredCommits.value;
      const total = wheelTickCount.value;
      const mappedIdx = Math.round(((i - 1) / (total - 1)) * (commits.length - 1));
      if (commits[mappedIdx]) return 28;
      return 16;
    }

    function isTickActive(i) {
      const commits = history.filteredCommits.value;
      const total = wheelTickCount.value;
      const mappedIdx = Math.round(((i - 1) / (total - 1)) * (commits.length - 1));
      return mappedIdx === history.selectedCommitIndex.value;
    }

    const activeDateLabel = computed(() => {
      const idx = history.selectedCommitIndex.value;
      if (idx >= 0 && history.filteredCommits.value[idx]) {
        return formatDateTime(history.filteredCommits.value[idx].createdAt);
      }
      if (history.filteredCommits.value.length) {
        return formatDateTime(history.filteredCommits.value[0].createdAt);
      }
      return '';
    });

    function rotateWheel(delta) {
      wheelOffset.value += delta;
    }

    function onDragStart(e) {
      let isDragging = true;
      let dragStartX = e.clientX;
      const onMove = (ev) => {
        if (!isDragging) return;
        rotateWheel((ev.clientX - dragStartX) * 0.5);
        dragStartX = ev.clientX;
      };
      const onUp = () => {
        isDragging = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    function onWheel(e) {
      rotateWheel(e.deltaX || e.deltaY);
    }

    // --- Formatting helpers ---
    function formatDateTime(dateStr) {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    function relativeTime(dateStr) {
      if (!dateStr) return '';
      const now = Date.now();
      const then = new Date(dateStr).getTime();
      const diff = now - then;
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      return `${days}d ago`;
    }

    // --- Lifecycle ---
    onMounted(() => {
      history.loadCommits(props.workspaceId, props.noteId);
    });

    onBeforeUnmount(() => {
      destroyPreviewEditor();
    });

    // Reload when snapshot loaded for preview
    watch(
      () => history.selectedCommit.value,
      async (val) => {
        if (showPreview.value && val?.content) {
          await nextTick();
          const { Editor } = await import('@tiptap/core');
          const { extensions } = await import('@/lib/tiptap');
          destroyPreviewEditor();
          previewEditor = new Editor({
            element: previewEditorEl.value,
            editable: false,
            extensions,
            content: val.content,
          });
        }
      }
    );

    return {
      history,
      showPreview,
      previewEditorEl,
      rotaryContainer,
      wheelOffset,
      dotPosition,
      dateRangeLabel,
      onDotClick,
      selectedCommitData,
      wordCount,
      wordDiff,
      snippet,
      togglePreview,
      wheelTickCount,
      getTickHeight,
      isTickActive,
      activeDateLabel,
      rotateWheel,
      onDragStart,
      onWheel,
      formatDateTime,
      relativeTime,
    };
  },
};
</script>
