import { invoke } from '@tauri-apps/api/core';
import { isMobileRuntime } from '@/lib/tauri/runtime';

const suppressedSources = new Set();
let lastEnabledState = null;

async function syncScribbleState() {
  if (!isMobileRuntime()) return;

  const enabled = suppressedSources.size === 0;
  if (enabled === lastEnabledState) return;

  lastEnabledState = enabled;

  try {
    await invoke('plugin:safe-area-insets-css|set_scribble_enabled', {
      enabled,
    });
  } catch (error) {
    console.warn('Failed to update Scribble state:', error);
  }
}

export function setScribbleSuppressed(source, suppressed) {
  if (!source) return;

  if (suppressed) {
    suppressedSources.add(source);
  } else {
    suppressedSources.delete(source);
  }

  void syncScribbleState();
}

export function clearScribbleSuppressed(source) {
  setScribbleSuppressed(source, false);
}
