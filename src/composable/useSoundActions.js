/**
 * Centralised sound-action wiring: listens to Pinia store actions via
 * `$onAction` and plays the corresponding sound after the action succeeds.
 * Mobile feedback uses haptics; desktop uses synthesised Web Audio tones.
 */

import { watch } from 'vue';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { useAppStore } from '@/store/app';
import { useSounds } from './useSounds';
import { triggerInteractionHaptic } from '@/lib/native/haptics';
import { isMobileRuntime } from '@/lib/tauri/runtime';

// Throttle: skip identical sounds within 250ms.
const THROTTLE_MS = 250;
const lastPlayed = {};

function throttledPlay(name, play) {
  const now = performance.now();
  if (lastPlayed[name] && now - lastPlayed[name] < THROTTLE_MS) return;
  lastPlayed[name] = now;
  play(name);
}

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
