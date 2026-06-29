import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@tauri-apps/api/core';
import { isMobileRuntime } from '@/lib/tauri/runtime';

export async function shareFileViaNative(path, mimeType) {
  if (!isTauri() || !isMobileRuntime()) return false;
  try {
    await invoke('plugin:sharesheet|share_file', { path, mimeType });
    return true;
  } catch (e) {
    console.error('[shareFileViaNative]', e);
    return false;
  }
}

export async function shareTextViaNative(text, mimeType) {
  if (!isTauri() || !isMobileRuntime()) return false;
  try {
    await invoke('plugin:sharesheet|share_text', { text, mimeType });
    return true;
  } catch (e) {
    console.error('[shareTextViaNative]', e);
    return false;
  }
}
