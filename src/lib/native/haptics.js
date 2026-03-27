import { isTauri } from '@tauri-apps/api/core';
import { selectionFeedback } from '@tauri-apps/plugin-haptics';
import { isMobileRuntime } from '@/lib/tauri/runtime';

export async function triggerSelectionHaptic() {
  if (!isTauri() || !isMobileRuntime()) return;

  try {
    await selectionFeedback();
  } catch {
    // Some devices do not expose selection feedback even when the plugin exists.
  }
}
