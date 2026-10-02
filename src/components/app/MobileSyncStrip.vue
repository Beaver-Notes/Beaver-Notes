<template>
  <transition name="mobile-sync-strip">
    <div
      v-if="visible"
      data-testid="mobile-sync-strip"
      class="fixed inset-x-0 top-0 z-30 w-full border-b border-neutral-200/80 bg-white/95 px-3 pb-1.5 pt-[calc(var(--app-safe-area-top)+0.5rem)] backdrop-blur dark:border-neutral-800/80 dark:bg-neutral-900/95"
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
        <button
          type="button"
          data-testid="sync-toggle"
          class="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
          :disabled="syncProgressStore.isSyncing"
          @click="syncNow"
        >
          {{
            syncProgressStore.isSyncing
              ? translations.settings?.syncing || 'Syncing...'
              : translations.settings?.syncNow || 'Sync now'
          }}
        </button>
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
  </transition>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { useSyncProgressStore } from '@/store/sync-progress';
import { useSyncControl } from '@/composable/useSyncControl';

const AUTO_HIDE_MS = 4000;
const REVEAL_PX = 20;
const TRIGGER_PX = 64;

const { translations } = useTranslations();
const syncProgressStore = useSyncProgressStore();
const { lastSyncLabel, syncNow } = useSyncControl();

const visible = ref(false);
let startY = null;
let pullDistance = 0;
let hideTimer = null;

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

function onTouchStart(event) {
  if ((event.touches?.length ?? 0) !== 1 || !atTop()) {
    startY = null;
    return;
  }
  startY = event.touches[0].clientY;
  pullDistance = 0;
}

function onTouchMove(event) {
  if (startY === null) return;
  const dy = event.touches[0].clientY - startY;
  if (dy <= 0) {
    pullDistance = 0;
    return;
  }
  pullDistance = Math.min(dy, TRIGGER_PX * 1.5);
  if (pullDistance >= REVEAL_PX && !visible.value) reveal();
}

function onTouchEnd() {
  if (startY === null) return;
  if (pullDistance >= TRIGGER_PX) syncNow();
  startY = null;
  pullDistance = 0;
}

onMounted(() => {
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: true });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
});

onBeforeUnmount(() => {
  clearHide();
  document.removeEventListener('touchstart', onTouchStart);
  document.removeEventListener('touchmove', onTouchMove);
  document.removeEventListener('touchend', onTouchEnd);
});
</script>

<style scoped>
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
