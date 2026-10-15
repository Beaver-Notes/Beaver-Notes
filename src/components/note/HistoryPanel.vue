<template>
  <div
    class="fixed inset-x-0 z-40 mx-2 bottom-4 mobile:bottom-[var(--app-mobile-floating-offset)] md:pl-16"
  >
      <ui-card
        class="relative bg-white dark:bg-neutral-900 border rounded-2xl shadow-xl overflow-hidden w-full p-2 mx-auto"
      >
        <!-- Header (shared by both tabs) -->
        <div
          class="flex items-center justify-between gap-2 px-3 md:px-4 py-2 border-b border-neutral-200 dark:border-neutral-700"
        >
          <div class="flex min-w-0 items-center gap-3">
            <h3
              class="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100"
            >
              {{ tr.noteHistory || 'Note History' }}
            </h3>
            <span
              v-if="tab === 'history' && filteredCommits.length"
              class="truncate text-xs text-neutral-400 dark:text-neutral-500 max-md:hidden"
            >
              {{
                fmt('lastEdited', {
                  time: relativeTime(filteredCommits[0]?.createdAt),
                })
              }}
            </span>
            <span
              v-else-if="tab === 'activity' && activityEntries.length"
              class="text-xs text-neutral-400 dark:text-neutral-500"
            >
              {{ activityEntries.length }}
            </span>
          </div>

          <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <select
              v-if="tab === 'history'"
              data-testid="history-time-filter"
              :value="history.timeFilter.value"
              @change="history.setFilter($event.target.value)"
              class="max-md:h-8 text-xs border border-neutral-200 dark:border-neutral-600 rounded-md px-2 py-1 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            >
              <option value="all">{{ tr.all || 'All' }}</option>
              <option value="today">{{ tr.today || 'Today' }}</option>
              <option value="week">{{ tr.thisWeek || 'This Week' }}</option>
            </select>
            <button
              v-if="tab === 'activity' && activityEntries.length"
              @click="confirmClearActivity"
              class="max-md:h-8 max-md:px-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 px-2 py-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            >
              {{ tr.clearActivity || 'Clear activity' }}
            </button>
            <div
              class="flex items-center gap-0.5 rounded-xl bg-neutral-100 p-0.5 dark:bg-neutral-800"
              role="tablist"
              :aria-label="tr.history || 'History'"
            >
              <button
                type="button"
                role="tab"
                :aria-selected="tab === 'history'"
                @click="tab = 'history'"
                class="h-8 max-md:h-9 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                :class="
                  tab === 'history'
                    ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
                "
              >
                {{ tr.history || 'History' }}
              </button>
              <button
                type="button"
                role="tab"
                data-testid="history-activity-tab"
                :aria-selected="tab === 'activity'"
                @click="tab = 'activity'"
                class="h-8 max-md:h-9 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                :class="
                  tab === 'activity'
                    ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
                "
              >
                {{ tr.activity || 'Activity' }}
              </button>
            </div>
            <button
              @click="$emit('close')"
              :aria-label="tr.close || 'Close'"
              class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            >
              <v-remixicon name="riCloseLine" class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- History -->
        <div v-if="tab === 'history'" data-testid="history-panel">
          <div
            v-if="history.loading.value && !filteredCommits.length"
            class="flex items-center justify-center py-12"
          >
            <div class="flex flex-col items-center gap-3">
              <ui-spinner size="24" color="text-primary" />
              <span class="text-sm text-neutral-500">{{
                tr.loading || 'Loading history...'
              }}</span>
            </div>
          </div>

          <div
            v-else-if="history.error.value"
            data-testid="history-error"
            class="flex items-center justify-center py-12 px-6"
          >
            <p class="text-sm text-red-600 dark:text-red-400 text-center">
              {{ history.error.value }}
            </p>
          </div>

          <div
            v-else-if="!filteredCommits.length"
            data-testid="history-empty"
            class="flex items-center justify-center py-12 px-6"
          >
            <p class="text-sm text-neutral-500">
              {{ tr.noHistory || 'No history available' }}
            </p>
          </div>

          <template v-else>
            <div class="flex flex-col md:flex-row-reverse">
              <!-- Version details -->
              <transition
                enter-active-class="transition-all duration-200 ease-out"
                enter-from-class="opacity-0 max-md:translate-y-2 md:translate-x-4"
                enter-to-class="opacity-100 md:translate-x-0"
                leave-active-class="transition-[transform,opacity] duration-150 ease-out"
                leave-from-class="opacity-100 md:translate-x-0"
                leave-to-class="opacity-0 max-md:translate-y-2 md:translate-x-4"
              >
                <div
                  v-if="
                    history.selectedCommitIndex.value >= 0 && selectedCommitData
                  "
                  class="flex flex-col overflow-auto border-t border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 ltr:md:border-l rtl:md:border-r max-md:max-h-[35vh] md:max-h-[300px] md:w-72 md:shrink-0"
                >
                  <div class="space-y-3 p-3">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p
                          class="text-sm font-semibold text-neutral-900 dark:text-neutral-100"
                        >
                          {{ tr.version || 'Version' }}
                          <span data-testid="history-panel-title">{{
                            filteredCommits.length -
                            history.selectedCommitIndex.value
                          }}</span>
                        </p>
                        <p
                          data-testid="history-panel-meta"
                          class="text-xs text-neutral-500 dark:text-neutral-400"
                        >
                          {{ formatDateTime(selectedCommitData.createdAt) }}
                          <template v-if="selectedCommitData.authorName">
                            &middot;
                            {{ selectedCommitData.authorName }}</template
                          >
                        </p>
                      </div>
                      <button
                        :aria-label="tr.deselect || 'Clear selection'"
                        @click="history.clearSelection()"
                        class="-m-1 p-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary rounded"
                      >
                        <v-remixicon name="riCloseLine" class="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <p class="text-xs text-neutral-600 dark:text-neutral-300">
                      {{ wordCount.toLocaleString() }}
                      {{ (tr.words || 'Words').toLowerCase() }}
                      <span
                        v-if="wordDiff !== null && wordDiff !== 0"
                        class="font-medium"
                        :class="
                          wordDiff > 0
                            ? 'text-primary'
                            : 'text-red-600 dark:text-red-400'
                        "
                      >
                        ({{ wordDiff > 0 ? '+' : ''
                        }}{{ wordDiff.toLocaleString() }})
                      </span>
                    </p>

                    <p
                      v-if="snippet"
                      class="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400 line-clamp-2"
                    >
                      {{ snippet }}
                    </p>

                    <div class="space-y-2">
                      <ui-button
                        v-if="!showPreview"
                        variant="primary"
                        class="w-full"
                        :loading="previewLoading"
                        @click="startPreview"
                      >
                        {{ tr.showPreview || 'Show preview' }}
                      </ui-button>
                      <template v-else>
                        <ui-button
                          variant="primary"
                          class="w-full"
                          @click="
                            $emit('restore', {
                              ...selectedCommitData,
                              ...(history.selectedCommit.value || {}),
                            })
                          "
                        >
                          {{ tr.restore || 'Restore' }}
                        </ui-button>
                        <div class="flex gap-2">
                          <ui-button
                            variant="secondary"
                            class="flex-1"
                            @click="reviewCommit"
                          >
                            {{ tr.reviewChanges || 'Review changes' }}
                          </ui-button>
                          <ui-button
                            variant="secondary"
                            class="flex-1"
                            @click="hidePreview"
                          >
                            {{ tr.hidePreview || 'Hide preview' }}
                          </ui-button>
                        </div>
                      </template>
                    </div>
                  </div>
                </div>
              </transition>

              <!-- Scrubber -->
              <div class="min-w-0 flex-1 p-2 md:p-3">
                <div class="flex items-center gap-1 md:gap-2">
                  <button
                    :disabled="olderDisabled"
                    :aria-label="tr.older || 'Older version'"
                    @click="stepButton(1)"
                    class="flex h-9 w-9 max-md:h-11 max-md:w-11 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-neutral-800 dark:hover:text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                  >
                    <v-remixicon name="riArrowLeftLine" class="w-4 h-4" />
                  </button>

                  <div
                    ref="tlRoot"
                    role="slider"
                    tabindex="0"
                    data-testid="history-timeline"
                    :aria-label="tr.timeline || 'Version timeline'"
                    aria-orientation="horizontal"
                    aria-valuemin="0"
                    :aria-valuemax="Math.max(0, filteredCommits.length - 1)"
                    :aria-valuenow="timelineValueNow"
                    :aria-valuetext="timelineValueText"
                    class="relative h-[100px] min-w-0 flex-1 cursor-ew-resize touch-none select-none rounded-lg text-neutral-900 outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:bg-primary/5 dark:text-neutral-100"
                    @pointerdown="onPointerDown"
                    @pointermove="onPointerMove"
                    @pointerup="onPointerUp"
                    @pointercancel="onPointerUp"
                    @pointerenter="onPointerEnter"
                    @pointerleave="onPointerLeave"
                    @wheel.prevent="onWheel"
                    @keydown="onKeydown"
                    @contextmenu.prevent
                  >
                    <canvas
                      ref="tlCanvas"
                      class="absolute inset-0 h-full w-full"
                    ></canvas>
                    <span
                      aria-hidden="true"
                      class="text-primary pointer-events-none absolute h-0 w-0 overflow-hidden"
                    ></span>
                    <div
                      ref="tlBubble"
                      class="pointer-events-none absolute left-0 top-0 flex h-6 items-center rounded-full bg-neutral-900 px-2.5 text-[11px] font-semibold tabular-nums text-white shadow-md transition-opacity duration-150 dark:bg-white dark:text-neutral-900"
                      :class="
                        history.selectedCommitIndex.value < 0
                          ? 'opacity-0'
                          : 'opacity-100'
                      "
                      style="will-change: transform"
                    >
                      {{ bubbleText }}
                    </div>
                  </div>

                  <button
                    :disabled="newerDisabled"
                    :aria-label="tr.newer || 'Newer version'"
                    @click="stepButton(-1)"
                    class="flex h-9 w-9 max-md:h-11 max-md:w-11 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-neutral-800 dark:hover:text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                  >
                    <v-remixicon name="riArrowRightSLine" class="w-4 h-4" />
                  </button>
                </div>

                <!-- Keyboard/screen-reader list; also the contract for history-entry -->
                <ul
                  class="sr-only"
                  :aria-label="tr.noteHistory || 'Note History'"
                >
                  <li
                    v-for="(commit, idx) in filteredCommits"
                    :key="commit.hash"
                    data-testid="history-entry"
                    :data-commit-hash="commit.hash"
                  >
                    <button type="button" @click="selectVersion(idx)">
                      {{ filteredCommits.length - idx }} &mdash;
                      {{ formatDateTime(commit.createdAt) }}
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </template>
        </div>

        <!-- Activity -->
        <div v-else>
          <div
            v-if="activity.loading.value && !activityEntries.length"
            class="flex items-center justify-center py-12"
          >
            <div
              class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"
            ></div>
          </div>

          <div
            v-else-if="activity.error.value"
            class="flex items-center justify-center py-12 px-6"
          >
            <p class="text-sm text-red-600 dark:text-red-400 text-center">
              {{ activity.error.value }}
            </p>
          </div>

          <div
            v-else-if="!activityEntries.length"
            class="flex items-center justify-center py-12 px-6"
          >
            <p class="text-sm text-neutral-500">
              {{ tr.noActivity || 'No activity yet' }}
            </p>
          </div>

          <div v-else class="max-h-[45vh] overflow-auto px-4 py-2">
            <template v-for="group in activityGroups" :key="group.day">
              <p
                class="text-[11px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500 mt-2 mb-1"
              >
                {{ group.label }}
              </p>
              <div
                v-for="entry in group.items"
                :key="entry.id"
                class="flex items-start gap-3 py-2 border-b border-neutral-100 dark:border-neutral-800 last:border-b-0"
              >
                <div class="flex-1 min-w-0">
                  <p class="text-xs text-neutral-700 dark:text-neutral-300">
                    <span class="font-medium">{{ entry.actorLabel }}</span>
                    {{ activityVerb(entry.kind) }}
                    <span
                      v-if="entry.summary"
                      class="text-neutral-500 dark:text-neutral-400"
                    >
                      &ldquo;{{ entry.summary }}&rdquo;
                    </span>
                  </p>
                  <p
                    class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5"
                  >
                    {{ relativeTime(new Date(entry.at).toISOString()) }}
                  </p>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <button
                    @click="jumpTo(entry)"
                    :disabled="!canJump(entry)"
                    class="max-md:h-11 text-[11px] font-medium px-2 py-1 rounded-md border border-neutral-200 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                  >
                    {{ tr.jumpTo || 'Jump to' }}
                  </button>
                  <button
                    @click="undoActivity(entry)"
                    :disabled="!activity.canUndo(entry)"
                    class="max-md:h-11 text-[11px] font-medium px-2 py-1 rounded-md border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                  >
                    {{ tr.undo || 'Undo' }}
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </ui-card>
    </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useNoteHistory } from '@/composable/useNoteHistory';
import { useActivityLog } from '@/composable/useActivityLog';
import { useDialog } from '@/lib/dialog';
import { useTranslations } from '@/composable/useTranslations';

// Timeline tuning
const PADX = 24; // horizontal inset of the track
const MIN_STEP = 3.5; // px between ticks before commits get grouped
const SIGMA = 30; // px, width of the magnifier wave
const LIFT = 24; // extra tick height under the magnifier
const LEN = { minor: 8, major: 16 };
const BASELINE = 28; // px from the bottom edge to the tick baseline
const LABEL_Y = 10; // px from the bottom edge to the label centre

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dayKey = (d) => d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate();

// Critically damped spring, frame-rate independent
function spring(s, target, w, dt) {
  const d = s.x - target;
  const e = Math.exp(-w * dt);
  const k = (s.v + w * d) * dt;
  s.x = target + (d + k) * e;
  s.v = (s.v - w * k) * e;
}

export default {
  props: {
    noteId: { type: String, required: true },
    workspaceId: { type: String, default: '' },
    editor: { type: Object, default: null },
    sound: { type: Boolean, default: true },
  },
  emits: ['close', 'restore', 'preview', 'review'],
  // `emit` comes from the setup context: `$emit` only resolves in the template.
  setup(props, { emit }) {
    const history = useNoteHistory();
    const activity = useActivityLog();
    const dialog = useDialog();
    const { translations } = useTranslations();
    const tr = computed(() => translations.value?.history || {});
    const tab = ref('history');
    const showPreview = ref(false);
    const previewLoading = ref(false);

    const filteredCommits = computed(() => history.filteredCommits.value);
    const activityEntries = computed(() => activity.entries.value);

    function fmt(key, params) {
      const raw = tr.value[key] ?? key;
      if (!params) return raw;
      return Object.entries(params).reduce(
        (s, [k, v]) => s.replace(`{${k}}`, String(v)),
        raw,
      );
    }

    // Selection alone doesn't fetch the snapshot, so load it before opening the review.
    async function reviewCommit() {
      const commit = selectedCommitData.value;
      if (!commit?.hash) return;
      await history.loadSnapshot(commit.hash, props.noteId);
      const snapshot = history.selectedCommit.value;
      if (!snapshot?.content) return;
      emit('review', {
        ...commit,
        ...snapshot,
        hash: commit.hash,
        createdAt: commit.createdAt,
      });
    }

    // ---------------------------------------------------------------
    // Version details
    // ---------------------------------------------------------------
    const selectedCommitData = computed(() => {
      const idx = history.selectedCommitIndex.value;
      if (idx < 0) return null;
      return filteredCommits.value[idx] || null;
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
      const commits = filteredCommits.value;
      if (idx >= commits.length - 1) return null;
      return (
        (commits[idx]?.wordCount || 0) - (commits[idx + 1]?.wordCount || 0)
      );
    });

    const snippet = computed(() => {
      if (history.selectedCommit.value?.content) {
        return history.selectedCommit.value.content
          .replace(/<[^>]*>/g, '')
          .slice(0, 120);
      }
      return selectedCommitData.value?.snippet || '';
    });

    // Preview: selection only highlights; the snapshot is loaded explicitly.
    async function startPreview() {
      const commit = selectedCommitData.value;
      if (!commit?.hash || previewLoading.value) return;
      previewLoading.value = true;
      try {
        await history.loadSnapshot(commit.hash, props.noteId);
        if (selectedCommitData.value?.hash !== commit.hash) return;
        const snapshot = history.selectedCommit.value;
        if (!snapshot?.content) return;
        showPreview.value = true;
        emit('preview', {
          ...snapshot,
          hash: commit.hash,
          createdAt: commit.createdAt,
        });
      } finally {
        previewLoading.value = false;
      }
    }

    function hidePreview() {
      showPreview.value = false;
      emit('preview', null);
    }

    function selectVersion(idx) {
      history.selectCommit(idx);
    }

    // ---------------------------------------------------------------
    // Formatting helpers
    // ---------------------------------------------------------------
    function formatDateTime(dateStr) {
      if (!dateStr) return '';
      return new Date(dateStr).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    function formatTime(dateStr) {
      if (!dateStr) return '';
      return new Date(dateStr).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    function relativeTime(dateStr) {
      if (!dateStr) return '';
      const mins = Math.floor(
        (Date.now() - new Date(dateStr).getTime()) / 60000,
      );
      if (mins < 1) return tr.value.justNow || 'just now';
      if (mins < 60) return fmt('minutesAgo', { count: mins });
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return fmt('hoursAgo', { count: hrs });
      return fmt('daysAgo', { count: Math.floor(hrs / 24) });
    }

    // ---------------------------------------------------------------
    // Horizontal timeline: one tick per version, oldest left, latest right.
    // Ticks stay put; a spring-driven magnifier wave lifts the ones near your finger.
    // ---------------------------------------------------------------
    const tlRoot = ref(null);
    const tlCanvas = ref(null);
    const tlBubble = ref(null);

    let ctx = null;
    let W = 300;
    let H = 100;
    let step = 0;
    let ticks = [];
    let group = 1;
    let n = 0;
    let colors = { ink: '17,17,17', accent: '17,17,17' };
    let dirty = true;
    let raf = 0;
    let last = 0;
    let dragging = false;
    let hovering = false;
    let fPtr = null;
    let reduceMotion = false;
    let lastSelAt = 0;
    let lastSelIdx = -1;
    let wheelAcc = 0;
    let ro = null;
    let mo = null;
    let mq = null;
    const fx = { x: 0, v: 0 }; // magnifier centre, in tick units
    const amp = { x: 0.35, v: 0 }; // magnifier strength

    const selIdx = () => history.selectedCommitIndex.value;

    const bubbleText = computed(() => {
      const c = filteredCommits.value[selIdx()];
      return c ? formatTime(c.createdAt) : '';
    });
    const timelineValueNow = computed(() =>
      selIdx() >= 0 ? filteredCommits.value.length - 1 - selIdx() : 0,
    );
    const timelineValueText = computed(() => {
      const c = filteredCommits.value[selIdx()];
      return c ? new Date(c.createdAt).toLocaleString() : '';
    });
    const olderDisabled = computed(
      () => selIdx() >= filteredCommits.value.length - 1,
    );
    const newerDisabled = computed(() => selIdx() <= 0);

    // Sound + haptics: the soft "round" tick
    let ac = null;
    let master = null;
    let lastSound = 0;

    function initAudio() {
      if (!props.sound || typeof window === 'undefined') return;
      if (!ac) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        ac = new Ctx();
        const comp = ac.createDynamicsCompressor();
        master = ac.createGain();
        master.gain.value = 0.7;
        master.connect(comp);
        comp.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume();
    }

    function tone(t, type, f0, f1, peak, dec, a) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dec);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + dec + a + 0.01);
    }

    function playTick(major, rate) {
      if (!ac || !props.sound) return;
      const t = ac.currentTime;
      if (t - lastSound < 0.014) return; // never machine-gun
      lastSound = t;
      const v = clamp(1.15 - rate / 90, 0.45, 1); // quieter when scrubbing fast
      const r = 1 + (Math.random() - 0.5) * 0.08;
      tone(
        t,
        'sine',
        (major ? 330 : 440) * r,
        (major ? 300 : 400) * r,
        0.55 * v,
        0.032,
        0.002,
      );
      tone(
        t,
        'triangle',
        (major ? 660 : 880) * r,
        (major ? 600 : 800) * r,
        0.1 * v,
        0.014,
        0.001,
      );
    }

    // Model: ticks are grouped when there are more commits than fit
    function rebuild() {
      const commits = filteredCommits.value;
      n = commits.length;
      ticks = [];
      if (!n) return;
      const cap = Math.max(2, Math.floor((W - PADX * 2) / MIN_STEP) + 1);
      group = Math.max(1, Math.ceil(n / cap));
      const T = Math.ceil(n / group);
      step = T > 1 ? (W - PADX * 2) / (T - 1) : 0;
      let prevDay = null;
      for (let t = 0; t < T; t++) {
        // newest commit of the group, as a newest-first index
        const idx = n - 1 - Math.min(n - 1, (t + 1) * group - 1);
        const d = new Date(commits[idx].createdAt);
        const dk = dayKey(d);
        const major = dk !== prevDay;
        prevDay = dk;
        ticks.push({
          idx,
          major,
          label:
            t === T - 1
              ? tr.value.latest || 'Latest'
              : major
                ? d.toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })
                : null,
        });
      }
      dirty = true;
    }

    const tickOf = (idx) =>
      Math.min(ticks.length - 1, Math.floor((n - 1 - idx) / group));
    const selTick = () =>
      !ticks.length ? 0 : selIdx() >= 0 ? tickOf(selIdx()) : ticks.length - 1;
    const xPos = (f) => (ticks.length > 1 ? PADX + f * step : W / 2);

    function readColors() {
      if (!tlRoot.value) return;
      const c = (
        getComputedStyle(tlRoot.value).color.match(/[\d.]+/g) || [17, 17, 17]
      )
        .slice(0, 3)
        .map(Number);
      // Accent comes from the text-primary swatch, not a hard-coded hue.
      const el = tlRoot.value.querySelector('.text-primary') || tlRoot.value;
      const a = (getComputedStyle(el).color.match(/[\d.]+/g) || []).slice(0, 3);
      colors = {
        ink: c.join(','),
        accent: a.length === 3 ? a.map(Math.round).join(',') : c.join(','),
      };
      dirty = true;
    }

    function resize() {
      if (!tlRoot.value || !tlCanvas.value) return;
      const dpr = window.devicePixelRatio || 1;
      W = tlRoot.value.clientWidth;
      H = tlRoot.value.clientHeight;
      tlCanvas.value.width = Math.round(W * dpr);
      tlCanvas.value.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rebuild();
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const T = ticks.length;
      if (!T) return;

      ctx.lineCap = 'round';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const base = H - BASELINE;
      const sel = selTick();
      const hasSel = selIdx() >= 0;

      // Labels: walk from the latest leftward and skip any that would overlap
      const show = Array.from({ length: T }, () => false);
      let lastX = Infinity;
      for (let t = T - 1; t >= 0; t--) {
        if (!ticks[t].label) continue;
        const x = xPos(t);
        if (lastX - x >= 46) {
          show[t] = true;
          lastX = x;
        }
      }

      for (let t = 0; t < T; t++) {
        const tk = ticks[t];
        const x = xPos(t);
        const dpx = (t - fx.x) * step;
        const g = Math.exp(-(dpx * dpx) / (2 * SIGMA * SIGMA)) * amp.x;
        const isSel = hasSel && t === sel;
        const len =
          (tk.major ? LEN.major : LEN.minor) + LIFT * g + (isSel ? 4 : 0);

        ctx.lineWidth = (isSel ? 3 : 2) + g * 1.2;
        ctx.strokeStyle = isSel
          ? `rgb(${colors.accent})`
          : `rgba(${colors.ink},${Math.min(1, (tk.major ? 0.6 : 0.3) + g * 0.55)})`;
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.lineTo(x, base - len);
        ctx.stroke();

        if (show[t]) {
          ctx.font = `500 ${11 + g * 2.5}px ui-sans-serif, system-ui, sans-serif`;
          ctx.fillStyle =
            g > 0.3 ? `rgb(${colors.ink})` : `rgba(${colors.ink},0.55)`;
          ctx.fillText(tk.label, x, H - LABEL_Y);
        }
      }

      // The bubble glides with the magnifier above the ticks
      if (tlBubble.value) {
        const bw = tlBubble.value.offsetWidth;
        const bx = clamp(xPos(fx.x) - bw / 2, 0, W - bw);
        tlBubble.value.style.transform = `translate3d(${bx}px,2px,0)`;
      }
    }

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const active = dragging || hovering;
      const fT = active && fPtr !== null ? fPtr : selTick();
      const aT = dragging ? 1 : hovering ? 0.85 : 0.35;

      if (reduceMotion) {
        fx.x = fT;
        fx.v = 0;
        amp.x = aT;
        amp.v = 0;
      } else {
        spring(fx, fT, active ? 38 : 16, dt);
        spring(amp, aT, 14, dt);
      }

      const moving =
        Math.abs(fx.x - fT) > 0.0005 ||
        Math.abs(fx.v) > 0.001 ||
        Math.abs(amp.x - aT) > 0.001 ||
        Math.abs(amp.v) > 0.001;
      if (moving || dirty) {
        dirty = false;
        draw();
      }
      raf = requestAnimationFrame(frame);
    }

    function choose(idx) {
      idx = clamp(idx, 0, n - 1);
      if (!n || idx === selIdx()) return;
      const now = performance.now();
      const rate =
        Math.abs(idx - lastSelIdx) / Math.max(0.001, (now - lastSelAt) / 1000);
      lastSelIdx = idx;
      lastSelAt = now;
      playTick(ticks[tickOf(idx)]?.major, rate);
      try {
        if (navigator.vibrate) navigator.vibrate(2);
      } catch {}
      history.selectCommit(idx);
    }

    function toTickF(e) {
      if (ticks.length <= 1) return 0;
      const r = tlRoot.value.getBoundingClientRect();
      return clamp((e.clientX - r.left - PADX) / step, 0, ticks.length - 1);
    }

    function onPointerDown(e) {
      if (!ticks.length) return;
      initAudio();
      dragging = true;
      tlRoot.value.setPointerCapture(e.pointerId);
      fPtr = toTickF(e);
      choose(ticks[Math.round(fPtr)].idx);
    }

    function onPointerMove(e) {
      if (!ticks.length) return;
      fPtr = toTickF(e);
      if (e.pointerType === 'mouse' && !dragging) hovering = true;
      if (dragging) choose(ticks[Math.round(fPtr)].idx);
    }

    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      if (tlRoot.value.hasPointerCapture(e.pointerId))
        tlRoot.value.releasePointerCapture(e.pointerId);
      if (e.pointerType !== 'mouse') {
        hovering = false;
        fPtr = null;
      }
    }

    function onPointerEnter(e) {
      if (e.pointerType === 'mouse' && ticks.length) {
        hovering = true;
        fPtr = toTickF(e);
      }
    }

    function onPointerLeave() {
      if (!dragging) hovering = false;
    }

    // delta > 0 moves to an older version
    function stepSelection(delta) {
      if (!n) return;
      const next = clamp((selIdx() < 0 ? 0 : selIdx()) + delta, 0, n - 1);
      choose(next);
    }

    function stepButton(delta) {
      initAudio();
      stepSelection(delta);
    }

    function onWheel(e) {
      wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const steps = Math.trunc(wheelAcc / 40);
      if (!steps) return;
      wheelAcc -= steps * 40;
      // scrolling right or down moves toward the latest version
      stepSelection(-Math.sign(steps) * Math.min(3, Math.abs(steps)));
    }

    function onKeydown(e) {
      const s = e.shiftKey ? 5 : 1;
      let handled = true;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') stepSelection(s);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
        stepSelection(-s);
      else if (e.key === 'Home') {
        choose(n - 1);
      } else if (e.key === 'End') {
        choose(0);
      } else handled = false;
      if (handled) {
        e.preventDefault();
        initAudio();
      }
    }

    function attachTimeline() {
      ctx = tlCanvas.value.getContext('2d');
      reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      readColors();
      resize();
      fx.x = selTick();
      last = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);

      ro = new ResizeObserver(resize);
      ro.observe(tlRoot.value);
      mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', readColors);
      mo = new MutationObserver(readColors);
      mo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme'],
      });
    }

    function detachTimeline() {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      mo?.disconnect();
      mq?.removeEventListener('change', readColors);
      ro = mo = mq = null;
    }

    // The timeline lives behind v-if (loading, empty, activity tab), so attach when it appears
    watch(
      tlRoot,
      (el) => {
        if (el) attachTimeline();
        else detachTimeline();
      },
      { flush: 'post' },
    );
    watch(
      () => [filteredCommits.value, tr.value.latest],
      () => {
        if (tlRoot.value) rebuild();
      },
      { flush: 'post' },
    );
    watch(selIdx, () => {
      dirty = true;
    });

    // ---------------------------------------------------------------
    // Activity log: newest first, grouped by day. "Jump to" and "Undo" act on the
    // live editor and are disabled when the anchor no longer resolves.
    // ---------------------------------------------------------------
    const activityGroups = computed(() => {
      const groups = [];
      let current = null;
      for (const entry of activityEntries.value) {
        const day = new Date(entry.at).toDateString();
        if (!current || current.day !== day) {
          current = { day, label: formatActivityDay(entry.at), items: [] };
          groups.push(current);
        }
        current.items.push(entry);
      }
      return groups;
    });

    function formatActivityDay(at) {
      const d = new Date(at);
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      if (d.toDateString() === today.toDateString())
        return tr.value.today || 'Today';
      if (d.toDateString() === yesterday.toDateString())
        return tr.value.yesterday || 'Yesterday';
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }

    function activityVerb(kind) {
      if (kind === 'insert') return tr.value.activityAdded || 'added';
      if (kind === 'delete') return tr.value.activityDeleted || 'deleted';
      if (kind === 'replace') return tr.value.activityChanged || 'changed';
      return tr.value.activityEdited || 'edited';
    }

    // A snippet is the stable-enough anchor: positions drift after later edits,
    // so a miss disables the action instead of selecting the wrong range.
    function findTextRange(doc, rawNeedle) {
      const needle = String(rawNeedle || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!doc || !needle) return null;
      let found = null;
      doc.descendants((node, pos) => {
        if (found) return false;
        if (!node.isText || !node.text) return true;
        const idx = node.text.indexOf(needle);
        if (idx >= 0) {
          found = { from: pos + idx, to: pos + idx + needle.length };
          return false;
        }
        return true;
      });
      return found;
    }

    function canJump(entry) {
      return !!findTextRange(
        props.editor?.state?.doc,
        entry?.anchorHint || entry?.summary,
      );
    }

    function jumpTo(entry) {
      const range = findTextRange(
        props.editor?.state?.doc,
        entry?.anchorHint || entry?.summary,
      );
      if (!range) return false;
      try {
        props.editor
          .chain()
          .focus()
          .setTextSelection(range)
          .scrollIntoView()
          .run();
        return true;
      } catch {
        return false;
      }
    }

    function undoActivity(entry) {
      activity.undo(entry, props.editor);
    }

    function confirmClearActivity() {
      dialog.confirm({
        title: tr.value.clearActivityTitle || 'Clear activity?',
        body:
          tr.value.clearActivityBody ||
          'This removes the activity log for this note. The note itself is not changed.',
        icon: 'riDeleteBinLine',
        okText: translations.value?.dialog?.confirm || 'Clear',
        cancelText: translations.value?.dialog?.cancel || 'Cancel',
        okVariant: 'danger',
        onConfirm: () => activity.clear(),
      });
    }

    // ---------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------
    onMounted(() => {
      history.loadCommits(props.noteId);
      activity.loadIfNeeded(props.noteId);
    });

    onBeforeUnmount(() => {
      detachTimeline();
      if (showPreview.value) emit('preview', null);
      if (ac) ac.close();
    });

    // Changing the selected version drops any loaded snapshot and exits preview.
    // selectCommit() alone never clears selectedCommit, so clear it here.
    watch(
      () => history.selectedCommitIndex.value,
      () => {
        history.selectedCommit.value = null;
        if (showPreview.value) {
          showPreview.value = false;
          emit('preview', null);
        }
      },
    );

    return {
      history,
      filteredCommits,
      activity,
      activityEntries,
      activityGroups,
      tab,
      activityVerb,
      canJump,
      jumpTo,
      undoActivity,
      confirmClearActivity,
      showPreview,
      previewLoading,
      startPreview,
      hidePreview,
      selectVersion,
      reviewCommit,
      selectedCommitData,
      wordCount,
      wordDiff,
      snippet,
      formatDateTime,
      relativeTime,
      tr,
      fmt,
      // timeline
      tlRoot,
      tlCanvas,
      tlBubble,
      bubbleText,
      timelineValueNow,
      timelineValueText,
      olderDisabled,
      newerDisabled,
      stepButton,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerEnter,
      onPointerLeave,
      onWheel,
      onKeydown,
    };
  },
};
</script>

<style>
.slide-up-enter-active,
.slide-up-leave-active {
  transition:
    transform 300ms var(--ease-standard),
    opacity 300ms var(--ease-standard);
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(20px);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .slide-up-enter-active,
  .slide-up-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
