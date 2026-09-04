import { isTauri } from '@tauri-apps/api/core';
import {
  selectionFeedback,
  impactFeedback,
  notificationFeedback,
} from '@tauri-apps/plugin-haptics';
import { isPhoneRuntime } from '@/lib/tauri/runtime';

export async function triggerSelectionHaptic() {
  if (!isTauri() || !isPhoneRuntime()) return;

  try {
    await selectionFeedback();
  } catch {
    // Some devices do not expose selection feedback even when the plugin exists.
  }
}

/** Map sound names to haptics. On mobile plays via Taptic/vibrator, no audio, respects silent switch. */
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
  if (!isTauri() || !isPhoneRuntime()) return;

  const fn = hapticMap[name];
  if (!fn) return;

  try {
    await fn();
  } catch {
    // Haptics not available on this device.
  }
}
