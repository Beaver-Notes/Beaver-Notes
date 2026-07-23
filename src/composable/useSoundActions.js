/**
 * Centralised sound-action wiring.
 *
 * Listens to Pinia store actions via `$onAction` and plays the corresponding
 * sound **after** the action completes successfully
 *
 * On **mobile** (iOS/Android) the feedback is delivered via haptics
 * On **desktop** the feedback uses the Web Audio API (synthesised tones).
 *
 * Sound / haptic map
 * ------------------
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

//  Deduplication

const THROTTLE_MS = 250;
const lastPlayed = {};

function throttledPlay(name, play) {
  const now = performance.now();
  if (lastPlayed[name] && now - lastPlayed[name] < THROTTLE_MS) return;
  lastPlayed[name] = now;
  play(name);
}

//  Subscriber

export function useSoundActions() {
  const { play, enabled } = useSounds();
  const appStore = useAppStore();

  const _isMobile = isMobileRuntime();
  const _feedback = _isMobile
    ? (name) => {
        triggerInteractionHaptic(name);
      }
    : (name) => {
        play(name);
      };

  watch(
    () => appStore.setting.soundsEnabled,
    (val) => {
      enabled.value = val ?? true;
    },
    { immediate: true }
  );

  const feedback = (name) => {
    if (!enabled.value) return;
    throttledPlay(name, _feedback);
  };


  const noteStore = useNoteStore();
  noteStore.$onAction(({ name, args, after, onError }) => {
    const soundMap = {
      add: 'noteCreate',
      delete: 'delete',
      moveToFolder: 'move',
      lockNote: 'lock',
      unlockNote: 'unlock',
    };

    const sound = soundMap[name];

    if (name === 'update') {
      const [, data] = args;
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

    if (sound) {
      after(() => feedback(sound));
    }

    onError(() => {
      feedback('error');
    });
  });

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
