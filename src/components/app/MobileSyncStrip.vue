<template>
  <div
    v-show="visible || pullDistance > 0"
    :style="stripStyle"
    data-testid="mobile-sync-strip"
    class="mx-4 rounded-2xl px-3 py-2"
  >
    <div
      role="status"
      aria-live="polite"
      class="flex w-full items-center gap-2"
    >
      <v-remixicon
        data-testid="sync-icon"
        :data-tone="tone"
        :name="statusIcon"
        size="16"
        aria-hidden="true"
        class="shrink-0"
        :class="[iconToneClass, { 'animate-spin': syncProgressStore.isSyncing }]"
      />
      <span
        data-testid="sync-status"
        class="min-w-0 flex-1 truncate text-sm text-neutral-800 dark:text-neutral-200"
      >
        {{ statusText }}
      </span>
      <span
        v-if="showLastSync"
        data-testid="sync-last"
        class="shrink-0 text-xs text-neutral-500 dark:text-neutral-400"
      >
        {{ lastSyncLabel }}
      </span>
    </div>

    <div
      v-if="syncProgressStore.hasProgress"
      class="mt-1.5 h-1 rounded bg-primary/20"
    >
      <div
        data-testid="sync-progress"
        class="h-1 rounded bg-primary transition-all duration-200"
        :style="{ width: syncProgressStore.progress + '%' }"
      />
    </div>

    <p
      v-if="syncProgressStore.attention?.detail"
      data-testid="sync-attention-detail"
      class="mt-1 break-words font-mono text-[11px] text-neutral-500 dark:text-neutral-400"
    >
      {{ syncProgressStore.attention.detail }}
    </p>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { useSyncProgressStore } from '@/store/sync-progress';
import { useSyncControl } from '@/composable/useSyncControl';

const AUTO_HIDE_MS = 1500;
const REVEAL_PX = 20;
const TRIGGER_PX = 64;
const RUBBER_BAND_MAX = 96;
const FLICK_VELOCITY = 0.5;

const { translations } = useTranslations();
const syncProgressStore = useSyncProgressStore();
const { lastSyncLabel, syncNow } = useSyncControl();

const visible = ref(false);
let startY = null;
let pullDistance = 0;
let hideTimer = null;
let lastY = 0;
let lastTime = 0;
let velocity = 0;

const isActive = computed(
  () =>
    syncProgressStore.isSyncing ||
    Boolean(syncProgressStore.attention) ||
    syncProgressStore.lastAttemptFailed,
);

const statusText = computed(() => {
  if (syncProgressStore.isSyncing) return syncProgressStore.phaseMessage;
  if (syncProgressStore.attention) return syncProgressStore.attention.text;
  return lastSyncLabel.value;
});

const showLastSync = computed(
  () =>
    (syncProgressStore.isSyncing || Boolean(syncProgressStore.attention)) &&
    Boolean(lastSyncLabel.value),
);

const tone = computed(() => {
  if (syncProgressStore.isSyncing) return 'syncing';
  if (syncProgressStore.attention) return syncProgressStore.attention.tone;
  return 'calm';
});

const statusIcon = computed(() => {
  if (syncProgressStore.isSyncing) return 'riLoopRightLine';
  if (syncProgressStore.attention?.tone === 'action') return 'riAlertLine';
  if (syncProgressStore.attention) return 'riCloudLine';
  return 'riCheckLine';
});

const ICON_TONE_CLASSES = {
  syncing: 'text-primary',
  action: 'text-red-600 dark:text-red-400',
  transient: 'text-amber-600 dark:text-amber-400',
  calm: 'text-emerald-600 dark:text-emerald-400',
};

const iconToneClass = computed(
  () => ICON_TONE_CLASSES[tone.value] || ICON_TONE_CLASSES.calm,
);

const stripStyle = computed(() => {
  if (visible.value) return { opacity: 1, transform: 'translateY(0)' };
  const offset = Math.min(pullDistance, TRIGGER_PX * 1.5);
  if (offset <= 0) return { opacity: 0, transform: 'translateY(-8px)' };
  // 1:1 tracking while pulling; opacity ramps from 0 at 0px to 1 at REVEAL_PX
  return {
    opacity: Math.min(1, offset / REVEAL_PX),
    transform: `translateY(${Math.max(-8 + offset, -8)}px)`,
  };
});

function clearHide() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleHide() {
  clearHide();
  if (isActive.value) return;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (!isActive.value) visible.value = false;
  }, AUTO_HIDE_MS);
}

function reveal() {
  visible.value = true;
  scheduleHide();
}

watch(isActive, (active) => {
  if (!visible.value) return;
  if (active) clearHide();
  else scheduleHide();
});

function atTop() {
  const scroller =
    typeof document !== 'undefined'
      ? document.getElementById('app-main')
      : null;
  return !scroller || scroller.scrollTop <= 0;
}

function dialogOpen() {
  return Boolean(
    typeof document !== 'undefined' &&
      document.querySelector('[role="dialog"]'),
  );
}

function pullTouch(event) {
  const touch = event.touches?.[0];
  if (!touch) return null;
  // Apple Pencil / stylus: iPadOS reports pencil contacts as touches, so a
  // downward ink stroke at the top of a note would read as pull-to-sync
  // (revealing the strip and kicking a sync). Stylus never pulls.
  if (touch.type === 'stylus') return null;
  // Ink surfaces (paper blocks, pdf rail, fullscreen markup) consume touches
  // for drawing — a pull that starts there is a stroke, even with a finger.
  if (event.target?.closest?.('[data-paper-surface]')) return null;
  return touch;
}

function onTouchCancel() {
  startY = null;
  pullDistance = 0;
  lastY = 0;
  lastTime = 0;
  velocity = 0;
}

function onTouchStart(event) {
  const touch = pullTouch(event);
  // Modals close by swipe-down; that gesture must never also pull-to-sync.
  if (!touch || (event.touches?.length ?? 0) !== 1 || dialogOpen() || !atTop()) {
    startY = null;
    return;
  }
  startY = touch.clientY;
  lastY = touch.clientY;
  lastTime = performance.now();
  pullDistance = 0;
  velocity = 0;
}

function onTouchMove(event) {
  if (startY === null) return;
  const touch = event.touches?.[0];
  if (!touch) return;
  const now = performance.now();
  const dy = touch.clientY - startY;
  const dx = touch.clientX - (event.touches?.[0]?.clientX ?? touch.clientX);

  // Horizontal intent: if the gesture goes mostly horizontal, cancel
  if (Math.abs(dx) > Math.abs(dy) * 1.5) {
    startY = null;
    pullDistance = 0;
    return;
  }

  if (dy <= 0) {
    pullDistance = 0;
    return;
  }

  // Rubber-band past RUBBER_BAND_MAX
  pullDistance = dy <= RUBBER_BAND_MAX ? dy : RUBBER_BAND_MAX + (dy - RUBBER_BAND_MAX) * 0.3;

  // Velocity from recent move (not whole-gesture average)
  velocity = (touch.clientY - lastY) / Math.max(now - lastTime, 1);
  lastY = touch.clientY;
  lastTime = now;

  if (pullDistance >= REVEAL_PX && !visible.value) reveal();
}

function onTouchEnd() {
  if (startY === null) return;
  if (pullDistance >= TRIGGER_PX || velocity > FLICK_VELOCITY) syncNow();
  startY = null;
  pullDistance = 0;
  lastY = 0;
  lastTime = 0;
  velocity = 0;
}

onMounted(() => {
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: true });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('touchcancel', onTouchCancel, { passive: true });
});

onBeforeUnmount(() => {
  clearHide();
  document.removeEventListener('touchstart', onTouchStart);
  document.removeEventListener('touchmove', onTouchMove);
  document.removeEventListener('touchend', onTouchEnd);
  document.removeEventListener('touchcancel', onTouchCancel);
});
</script>

<style scoped>
/* Strip uses v-show with computed style for 1:1 pull tracking.
   When visible becomes true (after threshold or sync), it fades in. */
.mobile-sync-strip-enter-active,
.mobile-sync-strip-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.mobile-sync-strip-enter-from,
.mobile-sync-strip-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
