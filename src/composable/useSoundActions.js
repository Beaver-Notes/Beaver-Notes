/**
 * Centralised sound-action wiring.
 *
 * Listens to Pinia store actions via `$onAction` and plays the corresponding
 * sound **after** the action completes successfully.  This guarantees that
 * every entry point (single card, batch toolbar, keyboard shortcut, …) plays
 * the same sound without each component having to call `play()` manually.
 *
 * On **mobile** (iOS/Android) the feedback is delivered via haptics (Taptic
 * Engine / vibrator) instead of audio — this respects the silent switch and
 * never interferes with music playback.
 *
 * On **desktop** the feedback uses the Web Audio API (synthesised tones).
 *
 * Usage
 * -----
 * Call once at the app root (e.g. App.vue).  It self-initialises.
 *
 *   useSoundActions();
 *
 * Sound / haptic map
 * ------------------
 * Note store                          Folder store
 * ────────────────────────────        ─────────────────────
 * add              → noteCreate       add    → folderCreate
 * delete           → delete           delete → delete
 * update           → (see payload)    move   → move
 * moveToFolder     → move
 * lockNote         → lock
 * unlockNote       → unlock
 */

import { watch } from 'vue';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { useAppStore } from '@/store/app';
import { useSounds } from './useSounds';
import { triggerInteractionHaptic } from '@/lib/native/haptics';
import { isMobileRuntime } from '@/lib/tauri/runtime';

// ── Deduplication ────────────────────────────────────────────────────────────
// Rapid successive calls of the same feedback (e.g. bulk-delete looping over
// many items) should only produce one cue.

const THROTTLE_MS = 250;
const lastPlayed = {};

function throttledPlay(name, play) {
  const now = performance.now();
  if (lastPlayed[name] && now - lastPlayed[name] < THROTTLE_MS) return;
  lastPlayed[name] = now;
  play(name);
}

// ── Subscriber initialisation ────────────────────────────────────────────────

export function useSoundActions() {
  const { play, enabled } = useSounds();
  const appStore = useAppStore();

  // Decide which playback function to use based on platform.
  // On mobile -> haptics; on desktop -> Web Audio API sounds.
  const _isMobile = isMobileRuntime();
  const _feedback = _isMobile
    ? (name) => {
        triggerInteractionHaptic(name);
      }
    : (name) => {
        play(name);
      };

  // 1. Keep the shared `enabled` ref in sync with the persistent setting.
  watch(
    () => appStore.setting.soundsEnabled,
    (val) => {
      enabled.value = val ?? true;
    },
    { immediate: true }
  );

  // Wrap the throttled call so it respects the enabled flag.
  const feedback = (name) => {
    if (!enabled.value) return;
    throttledPlay(name, _feedback);
  };

  // 2. Subscribe to note store actions ──────────────────────────────────

  const noteStore = useNoteStore();
  noteStore.$onAction(({ name, args, after, onError }) => {
    // ── Deterministic action → feedback mappings ───────────────────────
    const soundMap = {
      add: 'noteCreate',
      delete: 'delete',
      moveToFolder: 'move',
      lockNote: 'lock',
      unlockNote: 'unlock',
    };

    const sound = soundMap[name];

    // ── Context-dependent: inspect the update payload ──────────────────
    if (name === 'update') {
      const [, data] = args; // (id, data)
      if (data) {
        if (data.isArchived !== undefined) {
          after(() => feedback(data.isArchived ? 'archive' : 'unarchive'));
          return;
        }
        if (data.isBookmarked !== undefined) {
          after(() => feedback('bookmark'));
          return;
        }
        if (data.isLocked !== undefined) {
          after(() => feedback(data.isLocked ? 'lock' : 'unlock'));
          return;
        }
      }
    }

    // ── Standard mapping ───────────────────────────────────────────────
    if (sound) {
      after(() => feedback(sound));
    }

    // ── Error feedback on action failure ───────────────────────────────
    onError(() => {
      feedback('error');
    });
  });

  // 3. Subscribe to folder store actions ────────────────────────────────

  const folderStore = useFolderStore();
  folderStore.$onAction(({ name, after, onError }) => {
    const soundMap = {
      add: 'folderCreate',
      delete: 'delete',
      move: 'move',
    };

    const sound = soundMap[name];

    if (sound) {
      after(() => feedback(sound));
    }

    onError(() => {
      feedback('error');
    });
  });
}
