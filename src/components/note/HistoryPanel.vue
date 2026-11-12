<template>
  <div
    :class="
      docked
        ? 'fixed inset-x-0 z-40 flex justify-center px-2 transition-all duration-300 ease-[var(--ease-standard)] bottom-4'
        : 'w-full'
    "
    :style="wrapperStyle"
  >
    <section
      class="panel w-full max-w-2xl md:mx-auto"
      data-testid="history-panel"
      :class="{ previewing: selIdx > 0 }"
    >
      <header class="ph">
        <div class="min-w-0">
          <h3>{{ tr.noteHistory || 'Note History' }}</h3>
          <p class="mut">
            <span v-if="filteredCommits.length" data-testid="history-meta">
              {{ versionsCountLabel
              }}{{
                fmt('lastEdited', {
                  time: relativeTime(filteredCommits[0]?.createdAt),
                })
              }}
            </span>
          </p>
        </div>

        <div
          ref="segEl"
          class="seg"
          role="tablist"
          :aria-label="tr.history || 'History'"
        >
          <span ref="indEl" class="ind" aria-hidden="true"></span>
          <button
            type="button"
            role="tab"
            :aria-selected="tab === 'history'"
            data-testid="history-history-tab"
            @click="tab = 'history'"
          >
            {{ tr.history || 'History' }}
          </button>
          <button
            type="button"
            role="tab"
            data-testid="history-activity-tab"
            :aria-selected="tab === 'activity'"
            @click="tab = 'activity'"
          >
            {{ tr.activity || 'Activity' }}
          </button>
        </div>

        <button
          class="ib"
          :aria-label="tr.close || 'Close'"
          @click="$emit('close')"
        >
          <v-remixicon name="riCloseLine" />
        </button>
      </header>

      <!-- History -->
      <div v-if="tab === 'history'" class="pane pane-h">
        <div
          v-if="history.loading.value && !filteredCommits.length"
          class="flex items-center justify-center gap-3 py-12"
        >
          <ui-spinner size="24" color="text-primary" />
          <span class="mut">{{ tr.loading || 'Loading history...' }}</span>
        </div>

        <div
          v-else-if="history.error.value"
          class="flex items-center justify-center py-12 px-6"
        >
          <p
            data-testid="history-error"
            class="text-sm text-red-600 dark:text-red-400 text-center"
          >
            {{ history.error.value }}
          </p>
        </div>

        <div
          v-else-if="!filteredCommits.length"
          class="flex items-center justify-center py-12 px-6"
        >
          <p data-testid="history-empty" class="mut">
            {{ tr.noHistory || 'No history available' }}
          </p>
        </div>

        <div v-else class="hbody">
          <div class="tl">
            <div class="tlrow">
              <button
                class="ib"
                :aria-label="tr.older || 'Older version'"
                @click="stepButton(1)"
              >
                <v-remixicon name="riArrowRightSLine" class="-scale-x-100" />
              </button>

              <div ref="tkRoot" class="tkw">
                <span
                  ref="bubEl"
                  class="bub"
                  :class="{ hov: hoverTick !== selTick && hoverTick !== -1 }"
                  :style="{ '--x': bubX + 'px' }"
                  >{{ bubbleLabel }}</span
                >
                <div
                  class="ticks"
                  role="slider"
                  tabindex="0"
                  data-testid="history-timeline"
                  :aria-label="tr.timeline || 'Version timeline'"
                  :aria-valuemin="1"
                  :aria-valuemax="Math.max(1, filteredCommits.length)"
                  :aria-valuenow="versionNo"
                  :aria-valuetext="timelineValueText"
                  @pointerdown="onTicksDown"
                  @pointermove="onTicksMove"
                  @pointerup="onTicksUp"
                  @pointercancel="onTicksUp"
                  @pointerleave="onTicksLeave"
                  @keydown="onKeydown"
                  @contextmenu.prevent
                >
                  <i
                    v-for="(tick, t) in tickViews"
                    :key="t"
                    :ref="(el) => (tickEls[t] = el)"
                    :class="{ m: tick.m, s: tick.s }"
                    :style="{ height: tick.h + '%' }"
                  ></i>
                </div>
                <div class="days">
                  <span>{{ oldestDay }}</span>
                  <span v-if="midDay && midDay !== oldestDay">{{
                    midDay
                  }}</span>
                  <button
                    class="lt"
                    data-testid="history-latest"
                    @click="selectLatest"
                  >
                    {{ tr.latest || 'Latest' }}
                  </button>
                </div>
              </div>

              <button
                class="ib"
                :aria-label="tr.newer || 'Newer version'"
                @click="stepButton(-1)"
              >
                <v-remixicon name="riArrowRightSLine" />
              </button>
            </div>

            <!-- Keyboard/screen-reader list; also the contract for history-entry -->
            <ul class="sr-only" :aria-label="tr.noteHistory || 'Note History'">
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

          <div :key="versionNo" class="det det-in">
            <div class="who">
              <span class="av" :style="{ '--a': detHue }">{{
                detInitials
              }}</span>
              <div class="min-w-0">
                <h4 data-testid="history-panel-title">
                  Version {{ versionNo }}
                </h4>
                <small class="mut">{{ detAuthor }}</small>
              </div>
            </div>
            <div class="chips">
              <span v-if="sizeLabel" class="chip">{{ sizeLabel }}</span>
              <span v-if="selIdx === 0" class="chip ac">{{
                tr.current || 'Current'
              }}</span>
            </div>
            <p class="snip">{{ snippet }}</p>

            <div class="acts" :class="{ on: selIdx > 0 }">
              <p v-if="selIdx === 0" class="hint mut">
                {{
                  tr.viewingCurrent ||
                  'This is the current version. Pick an earlier one on the timeline and it opens in the editor.'
                }}
              </p>
              <div v-else class="pv">
                <button
                  class="btn g"
                  data-testid="history-back"
                  @click="selectLatest"
                >
                  {{ tr.backToCurrent || 'Back to current' }}
                </button>
                <button
                  class="btn p"
                  :class="{ ok: restoreOk }"
                  :disabled="restoreBusy"
                  data-testid="history-restore"
                  @click="restoreSelected"
                >
                  <span v-if="restoreBusy" class="spin"></span>
                  <v-remixicon v-else-if="restoreOk" name="riCheckLine" />
                  <template v-if="restoreBusy">{{
                    tr.restoring || 'Restoring…'
                  }}</template>
                  <template v-else-if="restoreOk">{{
                    tr.restored || 'Restored'
                  }}</template>
                  <template v-else>{{
                    tr.restoreVersion || 'Restore this version'
                  }}</template>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Activity -->
      <div v-else class="pane pane-a">
        <div
          v-if="activity.loading.value && !activityEntries.length"
          class="flex items-center justify-center py-12"
        >
          <ui-spinner size="24" color="text-primary" />
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
          <p class="mut">{{ tr.noActivity || 'No activity yet' }}</p>
        </div>

        <div v-else class="act">
          <template v-for="group in activityGroups" :key="group.day">
            <h5>{{ group.label }}</h5>
            <div
              v-for="entry in group.items"
              :key="entry.id"
              class="ar"
              :class="{ gone: undone[entry.id] }"
              data-testid="history-activity-entry"
            >
              <span class="av" :style="{ '--a': hueOf(entry.actorLabel) }">{{
                initials(entry.actorLabel)
              }}</span>
              <p>
                <b>{{ entry.actorLabel }}</b>
                {{ activityVerb(entry.kind) }}
                <q v-if="entry.summary">{{ entry.summary }}</q>
              </p>
              <span class="b">
                <button
                  class="btn g"
                  :disabled="!canJump(entry)"
                  :title="
                    canJump(entry)
                      ? ''
                      : tr.jumpMissing || 'That text is no longer in the note'
                  "
                  @click="jumpTo(entry)"
                >
                  {{ tr.jumpTo || 'Jump to' }}
                </button>
                <button
                  class="btn g"
                  :disabled="!activity.canUndo(entry)"
                  @click="undoActivity($event, entry)"
                >
                  {{ tr.undo || 'Undo' }}
                </button>
              </span>
              <small class="mut">{{
                relativeTime(new Date(entry.at).toISOString())
              }}</small>
            </div>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>

<script>
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
} from 'vue';
import { useNoteHistory } from '@/composable/useNoteHistory';
import { useActivityLog } from '@/composable/useActivityLog';
import { useSidebar } from '@/composable/useSidebar';
import { useTranslations } from '@/composable/useTranslations';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export default {
  props: {
    noteId: { type: String, required: true },
    workspaceId: { type: String, default: '' },
    editor: { type: Object, default: null },
    // true = fixed dock above the editor; false = fill the parent (mobile sheet)
    docked: { type: Boolean, default: true },
  },
  emits: ['close', 'restore', 'preview'],
  // `emit` comes from the setup context: `$emit` only resolves in the template.
  setup(props, { emit }) {
    const history = useNoteHistory();
    const activity = useActivityLog();
    const { translations } = useTranslations();
    const { expanded: sidebarExpanded } = useSidebar();
    // Docked only on desktop (the phone sheet passes :docked="false"), so the
    // only offset left to compute is the sidebar-aware one.
    const wrapperStyle = computed(() =>
      props.docked
        ? { paddingLeft: sidebarExpanded.value ? '16rem' : '4rem' }
        : {},
    );
    const tr = computed(() => translations.value?.history || {});
    const tab = ref('history');
    const previewActive = ref(false);
    const previewLoading = ref(false);
    const restoreBusy = ref(false);
    const restoreOk = ref(false);
    const undone = ref({});

    const filteredCommits = computed(() => history.filteredCommits.value);
    const activityEntries = computed(() => activity.entries.value);
    const selIdx = computed(() => history.selectedCommitIndex.value);
    const nVersions = computed(() => filteredCommits.value.length);
    const versionNo = computed(() => nVersions.value - selIdx.value);

    // Real version count first in the meta line; only when there is history.
    const versionsCountLabel = computed(() => {
      const count = nVersions.value;
      if (!count) return '';
      return (
        tr.value.versionsCount?.replace('{n}', String(count)) ||
        `${count} versions · `
      );
    });

    function fmt(key, params) {
      const raw = tr.value[key] ?? key;
      if (!params) return raw;
      return Object.entries(params).reduce(
        (s, [k, v]) => s.replace(`{${k}}`, String(v)),
        raw,
      );
    }

    // tick t (display order old→new) ↔ commit index n-1-t (newest-first list)
    const selTick = computed(() => {
      const n = nVersions.value;
      if (!n || selIdx.value < 0) return -1;
      return clamp(n - 1 - selIdx.value, 0, n - 1);
    });

    const tickViews = computed(() => {
      const commits = filteredCommits.value;
      const n = commits.length;
      // Bar height = that version's word count, scaled into the tick rail
      // (32–70% of 64px). All-equal counts collapse to a mid bar.
      const counts = commits.map((c) => c.wordCount || 0);
      const min = Math.min(...counts, Infinity);
      const max = Math.max(...counts, -Infinity);
      const span = max - min;
      const dayOf = (c) => new Date(c.createdAt).toDateString();
      return Array.from({ length: n }, (_, t) => {
        const idx = n - 1 - t;
        // major (darker) = last commit of its day in the chronological sweep
        const m = idx === 0 || dayOf(commits[idx]) !== dayOf(commits[idx - 1]);
        const h = span ? 32 + ((counts[idx] - min) / span) * 38 : 50;
        return {
          h: Math.round(h),
          m,
          s: t === selTick.value,
          commit: commits[idx],
        };
      });
    });

    // Tick-label helpers: date labels for bubble and day row
    function dayLabel(dateStr) {
      return new Date(dateStr).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
    }
    const oldestDay = computed(() =>
      filteredCommits.value.length
        ? dayLabel(
            filteredCommits.value[filteredCommits.value.length - 1].createdAt,
          )
        : '',
    );
    const midDay = computed(() => {
      const commits = filteredCommits.value;
      if (commits.length < 3) return '';
      return dayLabel(commits[Math.floor((commits.length - 1) / 2)].createdAt);
    });

    // Selection auto-opens the version in the editor (debounced while scrubbing)
    async function loadAndPreview() {
      const idx = history.selectedCommitIndex.value;
      const commit = filteredCommits.value[idx];
      if (!commit?.hash || previewLoading.value) return;
      previewLoading.value = true;
      try {
        await history.loadSnapshot(commit.hash, props.noteId);
        if (history.selectedCommitIndex.value !== idx) return;
        const snapshot = history.selectedCommit.value;
        if (!snapshot?.content) return;
        previewActive.value = true;
        emit('preview', {
          ...snapshot,
          hash: commit.hash,
          createdAt: commit.createdAt,
        });
      } finally {
        previewLoading.value = false;
      }
    }

    async function restoreSelected() {
      const commit = filteredCommits.value[selIdx.value];
      if (!commit?.hash || restoreBusy.value || restoreOk.value) return;
      restoreBusy.value = true;
      try {
        if (navigator.vibrate) navigator.vibrate([10, 40, 12]);
      } catch {}
      let snapshot = history.selectedCommit.value;
      if (!snapshot?.content) {
        await history.loadSnapshot(commit.hash, props.noteId);
        snapshot = history.selectedCommit.value;
      }
      if (!snapshot?.content) {
        restoreBusy.value = false;
        return;
      }
      emit('restore', {
        ...commit,
        ...snapshot,
        hash: commit.hash,
        createdAt: commit.createdAt,
      });
      restoreTimer = setTimeout(() => {
        restoreBusy.value = false;
        restoreOk.value = true;
        restoreOkTimer = setTimeout(() => {
          restoreOk.value = false;
          selectLatest();
          history.loadCommits(props.noteId);
        }, 820);
      }, 650);
    }

    function selectLatest() {
      history.selectCommit(0);
    }

    function hidePreview() {
      previewActive.value = false;
      emit('preview', null);
    }

    const wordCount = computed(() => {
      if (history.selectedCommit.value?.content) {
        return history.selectedCommit.value.content
          .replace(/<[^>]*>/g, ' ')
          .split(/\s+/)
          .filter(Boolean).length;
      }
      return filteredCommits.value[selIdx.value]?.wordCount || 0;
    });

    const wordDiff = computed(() => {
      const idx = selIdx.value;
      if (idx < 0) return null;
      const commits = filteredCommits.value;
      if (idx >= commits.length - 1) return null;
      return (
        (commits[idx]?.wordCount || 0) - (commits[idx + 1]?.wordCount || 0)
      );
    });

    // One chip instead of two: the size, plus the delta when it is meaningful.
    // Server rows carry no word count, so hide it until a snapshot gives us one
    // rather than claiming "0 words".
    const sizeLabel = computed(() => {
      if (!wordCount.value) return '';
      const words = `${wordCount.value.toLocaleString()} ${(
        tr.value.words || 'Words'
      ).toLowerCase()}`;
      if (!wordDiff.value) return words;
      const sign = wordDiff.value > 0 ? '+' : '';
      return `${words} (${sign}${wordDiff.value.toLocaleString()})`;
    });

    const snippet = computed(() => {
      if (history.selectedCommit.value?.content) {
        return history.selectedCommit.value.content
          .replace(/<[^>]*>/g, '')
          .slice(0, 120);
      }
      return filteredCommits.value[selIdx.value]?.snippet || '';
    });

    const detAuthor = computed(() => {
      const commit = filteredCommits.value[selIdx.value];
      if (!commit) return '';
      const who = commit.authorName ? `${commit.authorName} · ` : '';
      return `${who}${formatDateTime(commit.createdAt)}`;
    });

    const detHue = computed(() =>
      hueOf(filteredCommits.value[selIdx.value]?.authorName || '?'),
    );
    const detInitials = computed(() =>
      initials(filteredCommits.value[selIdx.value]?.authorName || ''),
    );

    // Formatting helpers
    function formatDateTime(dateStr) {
      if (!dateStr) return '';
      return new Date(dateStr).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
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

    // ---- segmented control: measured sliding thumb ----
    const segEl = ref(null);
    const indEl = ref(null);

    function placeSeg(animate) {
      if (!segEl.value || !indEl.value || document.hidden) return;
      const active = segEl.value.querySelector('[aria-selected="true"]');
      if (!active) return;
      if (!animate) indEl.value.style.transition = 'none';
      indEl.value.style.left = `${active.offsetLeft}px`;
      indEl.value.style.width = `${active.offsetWidth}px`;
      if (!animate) {
        void indEl.value.offsetWidth;
        indEl.value.style.transition = '';
      }
    }

    // ---- tick scrubber ----
    const tkRoot = ref(null);
    const bubEl = ref(null);
    const tickEls = ref([]);
    const bubX = ref(0);
    const hoverTick = ref(-1);

    const bubbleLabel = computed(() => {
      const t =
        hoverTick.value !== -1 && hoverTick.value !== selTick.value
          ? hoverTick.value
          : selTick.value;
      const commit = typedCommit(t);
      return commit ? formatDateTime(commit.createdAt) : '';
    });

    function typedCommit(t) {
      if (t < 0) return null;
      const commits = filteredCommits.value;
      return commits[commits.length - 1 - t] || null;
    }

    function placeBubble(t) {
      if (!tkRoot.value || !bubEl.value || !tickEls.value.length) return;
      const tick = tickEls.value[t];
      if (!tick) return;
      const width = bubEl.value.offsetWidth / 2 || 0;
      const px = tick.offsetLeft + tick.offsetWidth / 2;
      bubX.value = Math.max(
        width,
        Math.min(tkRoot.value.clientWidth - width, px),
      );
    }

    function fish(cx) {
      if (!tkRoot.value) return;
      for (const t of tickEls.value) {
        if (!t) continue;
        if (cx == null) {
          t.style.transform = '';
          continue;
        }
        const r = t.getBoundingClientRect();
        const d = cx - (r.left + r.width / 2);
        t.style.transform = `scaleY(${1 + 0.45 * Math.exp(-(d * d) / 1600)})`;
      }
    }

    function tickAt(e) {
      const r = tkRoot.value.getBoundingClientRect();
      const rel = (e.clientX - r.left) / r.width;
      return clamp(Math.floor(rel * nVersions.value), 0, nVersions.value - 1);
    }

    // blueprints: tick t → commit idx n-1-t
    const selectTick = (t) => {
      history.selectCommit(
        clamp(nVersions.value - 1 - t, 0, nVersions.value - 1),
      );
    };

    let dragging = false;

    function onTicksDown(e) {
      if (!nVersions.value) return;
      dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      try {
        if (navigator.vibrate) navigator.vibrate(2);
      } catch {}
      selectTick(tickAt(e));
      placeBubble(tickAt(e));
      fish(e.clientX);
    }

    function onTicksMove(e) {
      if (!nVersions.value) return;
      if (dragging) {
        selectTick(tickAt(e));
        placeBubble(tickAt(e));
      } else if (e.pointerType !== 'touch') {
        const t = tickAt(e);
        hoverTick.value = t;
        placeBubble(t);
      }
      fish(e.clientX);
    }

    function onTicksUp(e) {
      if (!dragging) return;
      dragging = false;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
      if (e.pointerType !== 'mouse') fish(null);
    }

    function onTicksLeave() {
      if (dragging) return;
      hoverTick.value = -1;
      fish(null);
      placeBubble(selTick.value);
    }

    function stepButton(delta) {
      if (!nVersions.value) return;
      const next = clamp(
        (selIdx.value < 0 ? 0 : selIdx.value) + delta,
        0,
        nVersions.value - 1,
      );
      history.selectCommit(next);
    }

    function onKeydown(e) {
      const s = e.shiftKey ? 5 : 1;
      let handled = true;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') stepButton(s);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') stepButton(-s);
      else if (e.key === 'Home') selectLatest();
      else if (e.key === 'End') history.selectCommit(nVersions.value - 1);
      else handled = false;
      if (handled) e.preventDefault();
    }

    const timelineValueText = computed(() => {
      const commit = filteredCommits.value[selIdx.value];
      return commit ? new Date(commit.createdAt).toLocaleString() : '';
    });

    // Attach/detach the DOM-measured pieces (bubbles, thumb, ticks) as panes toggle
    let bubRo = null;
    let segRo = null;

    function attachMeasure() {
      detachMeasure();
      placeSeg(false);
      if (segEl.value && 'ResizeObserver' in window) {
        segRo = new ResizeObserver(() => placeSeg(false));
        segRo.observe(segEl.value);
      }
      if (tkRoot.value && 'ResizeObserver' in window) {
        bubRo = new ResizeObserver(() => placeBubble(selTick.value));
        bubRo.observe(tkRoot.value);
      }
    }

    function detachMeasure() {
      segRo?.disconnect();
      bubRo?.disconnect();
      segRo = bubRo = null;
    }

    watch(
      [tkRoot, tab],
      ([el]) => {
        if (el && tab.value === 'history') nextTick(() => attachMeasure());
        else detachMeasure();
      },
      { flush: 'post' },
    );

    watch(tab, () => {
      nextTick(() => placeSeg(true));
      if (tab.value === 'history')
        nextTick(() => {
          attachMeasure();
          placeBubble(selTick.value);
        });
    });

    watch(selTick, () => {
      hoverTick.value = -1;
      placeBubble(selTick.value);
    });

    // Default selection: latest (index 0) on first data, so det/acts render
    watch(
      filteredCommits,
      (commits) => {
        if (commits.length && selIdx.value < 0) history.selectCommit(0);
      },
      { immediate: true },
    );

    // Activity log: newest first, grouped by day. "Jump to" and "Undo" act on the
    // live editor and are disabled when the anchor no longer resolves.
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

    function undoActivity(event, entry) {
      undone.value = { ...undone.value, [entry.id]: true };
      activity.undo(entry, props.editor);
    }

    // Deterministic hue for recycled initial chips
    function hueOf(name) {
      let h = 0;
      for (const ch of String(name || ''))
        h = (h * 31 + ch.charCodeAt(0)) % 360;
      return h || 210;
    }

    function initials(name) {
      return String(name || '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join('');
    }

    onMounted(() => {
      history.loadCommits(props.noteId);
      activity.loadIfNeeded(props.noteId);
      if (segEl.value && 'ResizeObserver' in window) {
        segRo = new ResizeObserver(() => placeSeg(false));
        segRo.observe(segEl.value);
      }
    });

    onBeforeUnmount(() => {
      clearTimeout(previewTimer);
      clearTimeout(restoreTimer);
      clearTimeout(restoreOkTimer);
      detachMeasure();
      if (previewActive.value) emit('preview', null);
    });

    let previewTimer = 0;
    let restoreTimer = 0;
    let restoreOkTimer = 0;

    // Selecting a version auto-opens it in the editor. Index 0 is the latest
    // version (= the live doc), so it exits the preview instead.
    watch(selIdx, () => {
      history.selectedCommit.value = null;
      if (previewActive.value) hidePreview();
      clearTimeout(previewTimer);
      if (selIdx.value > 0) previewTimer = setTimeout(loadAndPreview, 150);
    });

    return {
      history,
      wrapperStyle,
      filteredCommits,
      versionsCountLabel,
      activity,
      activityEntries,
      activityGroups,
      tab,
      selIdx,
      selTick,
      versionNo,
      tickViews,
      oldestDay,
      midDay,
      bubbleLabel,
      bubX,
      hoverTick,
      tickEls,
      tkRoot,
      bubEl,
      segEl,
      indEl,
      detAuthor,
      detHue,
      detInitials,
      wordCount,
      sizeLabel,
      wordDiff,
      snippet,
      previewActive,
      previewLoading,
      restoreBusy,
      restoreOk,
      loadAndPreview,
      hidePreview,
      restoreSelected,
      selectLatest,
      selectVersion: (idx) => history.selectCommit(idx),
      undone,
      activityVerb,
      canJump,
      jumpTo,
      undoActivity,
      hueOf,
      initials,
      formatDateTime,
      relativeTime,
      timelineValueText,
      fmt,
      tr,
      onTicksDown,
      onTicksMove,
      onTicksUp,
      onTicksLeave,
      stepButton,
      onKeydown,
    };
  },
};
</script>

<style scoped>
/* Blueprint tokens, mapped onto the app palette */
.panel {
  --p-s1: #ffffff;
  --p-s2: #f5f5f4;
  --p-line: #e7e5e4;
  --p-ink: #1c1917;
  --p-mut: #68625c;
  --p-ok: #15803d;
  --p-ac: hsl(var(--twc-primary));
  --p-acs: hsl(var(--twc-primary) / 0.2);
  --p-on: #ffffff;
  --p-sh: 0 1px 2px rgba(0, 0, 0, 0.06), 0 12px 28px -10px rgba(0, 0, 0, 0.16);
  --p-spring: var(--ease-spring);
  --p-smooth: var(--ease-standard);

  background: var(--p-s1);
  color: var(--p-ink);
  font-size: 14px;
  overflow: hidden;
  border: 1px solid var(--p-line);
  border-radius: 18px;
  box-shadow: var(--p-sh);
}
:root.dark .panel {
  --p-s1: #1c1b1a;
  --p-s2: #262524;
  --p-line: #363431;
  --p-ink: #f5f4f2;
  --p-mut: #a8a29c;
  --p-ok: #4ade80;
  --p-acs: hsl(var(--twc-primary) / 0.3);
  --p-sh: 0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 28px -10px rgba(0, 0, 0, 0.6);
}

.mut {
  color: var(--p-mut);
}

/* header */
.ph {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px 12px;
}
.ph h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.ph p {
  margin: 0;
  font-size: 12px;
}
.ph .seg {
  margin-left: auto;
}

/* sliding segmented control */
.seg {
  position: relative;
  display: inline-flex;
  background: var(--p-s2);
  border-radius: 11px;
  padding: 3px;
}
.seg .ind {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  width: 0;
  background: var(--p-s1);
  border-radius: 8px;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.125),
    0 2px 8px -2px rgba(0, 0, 0, 0.125);
  transition:
    left 0.4s var(--p-spring),
    width 0.4s var(--p-spring);
}
.seg button {
  position: relative;
  z-index: 1;
  font: inherit;
  color: var(--p-mut);
  border: 0;
  background: transparent;
  border-radius: 8px;
  min-height: 30px;
  padding: 0 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.seg button[aria-selected='true'] {
  color: var(--p-ink);
}

/* shared controls */
.ib {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  border-radius: 10px;
  color: var(--p-mut);
  cursor: pointer;
}
.ib:hover,
.btn.g:hover {
  background: var(--p-s2);
  color: var(--p-ink);
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid var(--p-line);
  background: var(--p-s1);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.btn.p {
  background: var(--p-ac);
  border-color: var(--p-ac);
  color: var(--p-on);
}
.btn.ok {
  background: var(--p-ok);
  border-color: var(--p-ok);
  color: #fff;
}
.btn.g {
  border-color: transparent;
  background: transparent;
  color: var(--p-mut);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.spin {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-right-color: transparent;
  animation: hp-rot 0.7s linear infinite;
  flex: none;
}
@keyframes hp-rot {
  to {
    transform: rotate(360deg);
  }
}

/* history layout: timeline beside the inspector on desktop, stacked on phones */
.hbody {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 17rem;
  align-items: stretch;
  border-top: 1px solid var(--p-line);
}
.tl {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  padding: 22px 12px 16px 24px;
}
.tlrow {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tlrow > div {
  flex: 1;
  min-width: 0;
}
.tkw {
  position: relative;
  padding-top: 38px;
}
.bub {
  position: absolute;
  top: 0;
  left: 0;
  white-space: nowrap;
  margin: 0;
  background: var(--p-ink);
  color: var(--p-s1);
  border-radius: 99px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 600;
  transform: translateX(var(--x, 50%)) translateX(-50%);
  transition:
    transform 0.4s var(--p-spring),
    background 0.2s,
    color 0.2s;
}
.bub.hov {
  background: var(--p-s1);
  color: var(--p-ink);
  box-shadow:
    0 0 0 1px var(--p-line),
    var(--p-sh);
}
.ticks {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 64px;
  margin: 0 0 4px;
  cursor: ew-resize;
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
  border-radius: 6px;
}
.ticks i {
  flex: 1;
  border-radius: 2px;
  background: var(--p-line);
  transform-origin: bottom;
  transition:
    transform 0.32s var(--p-spring),
    background 0.2s;
}
.ticks i.m {
  background: var(--p-mut);
}
.ticks i.s {
  background: var(--p-ac);
  outline: 3px solid var(--p-acs);
}
.days {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--p-mut);
  margin-top: 4px;
  gap: 8px;
}
.lt {
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 11px;
  color: var(--p-mut);
  padding: 2px 6px;
  margin: -2px -6px;
  border-radius: 6px;
  cursor: pointer;
}
.lt:hover {
  color: var(--p-ink);
}
.previewing .lt {
  color: var(--p-ac);
  font-weight: 600;
}

/* inspector: what you are looking at, and what you can do with it */
.det {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  background: var(--p-s2);
  padding: 16px;
  border-left: 1px solid var(--p-line);
}
.who {
  display: flex;
  gap: 10px;
  align-items: center;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.snip {
  margin: 0;
  color: var(--p-mut);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.det-in .who,
.det-in .chips,
.det-in .snip {
  animation: det-in 0.32s var(--p-spring) backwards;
}
.det-in .chips {
  animation-delay: 40ms;
}
.det-in .snip {
  animation-delay: 80ms;
}
@keyframes det-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.who h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.who small {
  font-size: 12px;
}
.av {
  --z: 28px;
  width: var(--z);
  height: var(--z);
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: hsl(var(--a, 210) 50% 40%);
  color: #fff;
  font-size: calc(var(--z) * 0.38);
  font-weight: 600;
  flex: none;
}
.det .av {
  --z: 32px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 99px;
  background: var(--p-s1);
  color: var(--p-mut);
}
.chip.ac {
  background: var(--p-acs);
  color: var(--p-ac);
}

/* actions live inside the inspector, below the snippet */
.acts {
  margin-top: auto;
  padding-top: 4px;
}
.pv {
  display: flex;
  gap: 8px;
}
.pv .btn {
  white-space: nowrap;
}
.hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
}

/* activity pane */
.act {
  padding: 4px 16px 16px;
  display: grid;
  max-height: 380px;
  overflow: auto;
}
.act h5 {
  margin: 14px 0 4px;
  font-size: 12px;
  color: var(--p-mut);
  font-weight: 600;
}
.ar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 2px 12px;
  padding: 10px 0;
  border-top: 1px solid var(--p-line);
  align-items: start;
  transition: opacity 0.25s var(--p-smooth);
}
.ar.gone {
  opacity: 0;
}
.ar > .av {
  grid-row: span 2;
}
.ar p {
  margin: 0;
}
.ar q {
  color: var(--p-mut);
  quotes: '“' '”';
}
.ar .b {
  display: flex;
  gap: 2px;
  grid-column: 3;
  grid-row: 1 / span 2;
  align-self: center;
}
.ar .b .btn {
  min-height: 0;
  padding: 4px 8px;
  border-radius: 8px;
  font-size: 12px;
}
.ar small {
  grid-column: 2;
  grid-row: 2;
  font-size: 11px;
}

/* pane switch-in */
.pane > * {
  animation: pane-in 0.34s var(--p-smooth) backwards;
}
@keyframes pane-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

/* Phone layout */
.runtime-mobile .panel {
  border-radius: 24px 24px 0 0;
  border-bottom: 0;
  /* The sheet slot is not scrollable, so the panel owns its own overflow. */
  max-height: calc(100dvh - 0.75rem);
  overflow-y: auto;
}
.runtime-mobile .ph {
  flex-wrap: wrap;
}
.runtime-mobile .seg {
  order: 3;
  width: 100%;
  margin: 0;
}
.runtime-mobile .seg button {
  flex: 1;
  min-height: 40px;
}
.runtime-mobile .ph .ib {
  margin-left: auto;
}
/* Stacked in the order you act: pick a version, read it, then restore it. */
.runtime-mobile .hbody {
  grid-template-columns: minmax(0, 1fr);
}
.runtime-mobile .tl {
  padding: 14px 12px 8px;
}
.runtime-mobile .det {
  border-left: 0;
  border-top: 1px solid var(--p-line);
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
}
.runtime-mobile .pv {
  display: grid;
  gap: 8px;
}
.runtime-mobile .pv .btn {
  width: 100%;
  min-height: 48px;
}
.runtime-mobile .ib {
  width: 44px;
  height: 44px;
}
.runtime-mobile .lt {
  font-size: 13px;
  padding: 8px 10px;
  margin: -8px -10px;
}
.runtime-mobile .ar {
  grid-template-columns: auto 1fr;
}
.runtime-mobile .ar .b {
  grid-column: 2;
  grid-row: auto;
  margin-left: -10px;
}
.runtime-mobile .ar .b .btn {
  min-height: 40px;
  padding: 0 12px;
}
.runtime-mobile .ar small {
  grid-column: 2;
  grid-row: auto;
}

@media print {
  .panel {
    display: none;
  }
}
</style>
