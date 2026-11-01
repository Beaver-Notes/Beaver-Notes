import { backend } from '@/lib/tauri-bridge';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

export function getAppInfo() {
  return backend.invoke('app:info');
}

export function getAppDirectory() {
  return backend.invoke('app:directory');
}

export function getMigrationStatus() {
  return backend.invoke('migration:status');
}

export function runMigration() {
  return backend.invoke('migration:run');
}

export function probeMigrationPath(path) {
  return backend.invoke('migration:probe-path', path);
}

export function runMigrationFromPath(path) {
  return backend.invoke('migration:run-with-path', path);
}

export function readLegacyData(dir) {
  return backend.invoke('migration:read-legacy-data', { dir });
}

export function readLegacyPreferences(dir) {
  return backend.invoke('migration:read-legacy-preferences', { dir });
}

export function appReady() {
  return backend.invoke('app-ready');
}

export function getSystemFonts() {
  return backend.invoke('get-system-fonts');
}

export function getNativeDarkTheme() {
  return backend.invoke('helper:is-dark-theme');
}

export function setSpellcheck(enabled) {
  return backend.invoke('app:spellcheck', enabled);
}

export function setMenuVisibility(visible) {
  return backend.invoke('app:change-menu-visibility', visible);
}

export function updateMenu(context) {
  return backend.invoke('app:update-menu', { context });
}

export function setZoomLevel(level) {
  return backend.invoke('app:set-zoom', level);
}

export async function setReducedMotion(enabled) {
  return backend.invoke('app:set-reduced-motion', { enabled });
}

export function getHelperPath(name) {
  return backend.invoke('helper:get-path', name);
}

export function openFileExternal(path) {
  return backend.invoke('open-file-external', path);
}

export function relaunchApp() {
  return backend.invoke('helper:relaunch');
}

let _notifyPermission = null; // 'granted' | 'denied' | null (unknown)

// Where a notification points, keyed by the notification's own id. iOS drops
// `extra` on the way back — its tap payload carries only id/title/body — so the
// click handler finds the target here instead.
const _notificationTargets = new Map();
let _nextNotificationId = Date.now() % 1000000000;

export async function notify({ title, body, extra = null }) {
  try {
    if (_notifyPermission !== 'granted') {
      let granted = await isPermissionGranted();
      if (!granted) {
        const result = await requestPermission();
        granted = result === 'granted';
      }
      _notifyPermission = granted ? 'granted' : 'denied';
    }
    if (_notifyPermission !== 'granted') return false;
    // `extra` rides along to the click handler, so a tap can open what it
    // announced instead of just raising the window. iOS does not hand it back,
    // so the target is also remembered under the notification's own id.
    const id = _nextNotificationId++;
    if (extra?.noteId || extra?.workspaceId) {
      _notificationTargets.set(id, {
        noteId: extra.noteId ?? null,
        workspaceId: extra.workspaceId ?? null,
      });
      if (_notificationTargets.size > 50) {
        _notificationTargets.delete(_notificationTargets.keys().next().value);
      }
    }
    sendNotification(extra ? { id, title, body, extra } : { id, title, body });
    return true;
  } catch (error) {
    // Fail gracefully on any platform error (missing notification daemon on
    // Linux, unregistered AUMID on Windows, denied permission, etc.).
    console.warn('Notification failed:', error);
    return false;
  }
}

// Clicking a notification raises the app and opens the note it announced. The
// target comes from the in-memory map (iOS) or the `extra` the notification was
// sent with (Android); a notification with neither only raises the app.
//
// shortcut: the map lives in memory, so a tap on a notification from a previous
// session finds nothing and only raises the app. Upgrade if cold-start routing
// matters.
// One listener per process: the shell's init re-runs on workspace switches.
let _notificationClicksBound = false;

export async function initNotificationClicks() {
  if (_notificationClicksBound) return;
  _notificationClicksBound = true;
  try {
    const { onAction } = await import('@tauri-apps/plugin-notification');
    await onAction((payload) => {
      void (async () => {
        const extra = payload?.notification?.extra ?? payload?.extra ?? null;
        const target =
          _notificationTargets.get(payload?.notification?.id) ??
          (extra
            ? { noteId: extra.noteId ?? null, workspaceId: extra.workspaceId ?? null }
            : null);
        const noteId = target?.noteId || null;
        const workspaceId = target?.workspaceId || null;
        const { logger } = await import('@/utils/logger');
        logger.debug(`[native] notification clicked -> ${noteId ?? 'no-note'}`);
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          await getCurrentWindow().setFocus();
        } catch {
          // Focusing is best-effort: the route below still runs.
        }
        if (!noteId) return;
        try {
          const { useWorkspaceStore } = await import('@/store/workspace');
          const workspace = useWorkspaceStore();
          if (workspaceId && workspace.activeId !== workspaceId) {
            await workspace.switchTo(workspaceId);
          }
        } catch {
          // A workspace switch that fails must not block the note route.
        }
        location.hash = `#/note/${noteId}`;
      })();
    });
  } catch {
    // Notifications are optional on every platform.
  }
}
