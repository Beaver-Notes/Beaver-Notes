// src/composable/useIncomingShare.js
import { onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useShareStore } from '@/store/share';
import { invokeCommand } from '@/lib/tauri/commands';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';

let draining = false;

export function useIncomingShare() {
  const share = useShareStore();
  const router = useRouter();
  let unlisten = () => {};

  async function drain() {
    if (draining) return false;
    if (!isTauri()) return false;
    draining = true;
    try {
      const items = await invokeCommand('get_pending_shares');
      if (Array.isArray(items) && items.length) {
        share.openWithItems(items);
        // Sheet-confirmed shares skip the preview modal: save directly and open the note.
        // Invalid append targets never fork silently: openWithItems validates and
        // sets share.notice, so fall through to the modal (unconfirmed) for an
        // explicit user confirm of the announced new-note fallback.
        if (share.items.length && share.items.every((i) => i.confirmed) && !share.notice) {
          share.isOpen = false;
          try {
            await invokeCommand('clear_pending_shares');
          } catch (e) {
            console.warn('[share] clear failed:', e);
          }
          const created = await share.saveConfirmed();
          if (created?.length) {
            await share.announceSave(created[0]);
            router.push(`/note/${created[0].id}`);
          }
          await share.closeAndClear();
          return true;
        }
        if (share.notice) share.items.forEach((i) => { i.confirmed = false; });
        return true;
      }
    } catch (e) {
      console.warn('[share] drain failed:', e);
    } finally {
      draining = false;
    }
    return false;
  }

  function onVisible() {
    if (document.visibilityState === 'visible') void drain();
  }

  onMounted(async () => {
    await drain(); // covers cold start after extension launch
    document.addEventListener('visibilitychange', onVisible);
    try {
      // Existing deep-link plumbing (src-tauri/src/lib.rs) emits this for
      // every beaver-notes:// URL — covers the iOS extension's post-save launch.
      unlisten = await listen('deep-link://received', () => void drain());
    } catch { /* non-tauri */ }
  });

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisible);
    unlisten();
  });

  // Desktop dev hook for smoke-testing without a device (Task 9 Step 5)
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__simulateShare = (items) => share.openWithItems(items);
  }

  return { drain };
}
