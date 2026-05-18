import { isTauri } from '@tauri-apps/api/core';
import {
  selectionFeedback,
  impactFeedback,
  notificationFeedback,
} from '@tauri-apps/plugin-haptics';
import { isMobileRuntime } from '@/lib/tauri/runtime';

export async function triggerSelectionHaptic() {
  if (!isTauri() || !isMobileRuntime()) return;

  try {
    await selectionFeedback();
  } catch {
    // Some devices do not expose selection feedback even when the plugin exists.
  }
}

/**
 * Map interaction sound names to haptic feedback types.
 *
 * On mobile (iOS / Android) these play through the device's Taptic Engine /
 * vibrator — no audio is produced, so they respect the silent switch and
 * never interfere with music.
 */
const hapticMap = {
  noteCreate: () => impactFeedback('light'),
  delete: () => impactFeedback('medium'),
  archive: () => impactFeedback('soft'),
  unarchive: () => impactFeedback('soft'),
  bookmark: () => impactFeedback('light'),
  folderCreate: () => impactFeedback('light'),
  sync: () => selectionFeedback(),
  lock: () => impactFeedback('medium'),
  unlock: () => impactFeedback('light'),
  move: () => selectionFeedback(),
  danger: () => notificationFeedback('warning'),
  error: () => notificationFeedback('error'),
  intro: () => notificationFeedback('success'),
};

export async function triggerInteractionHaptic(name) {
  if (!isTauri() || !isMobileRuntime()) return;

  const fn = hapticMap[name];
  if (!fn) return;

  try {
    await fn();
  } catch {
    // Haptics not available on this device.
  }
}
