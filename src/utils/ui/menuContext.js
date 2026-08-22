import { backend } from '@/lib/tauri-bridge';
import { updateMenu } from '@/lib/native/app';

export function buildMenuContext({
  routeName,
  noteEditable,
  noteLocked,
  inReaderMode,
}) {
  let screen = 'home';
  if (inReaderMode) {
    screen = 'reader';
  } else if (routeName === 'Note') {
    screen = 'note';
  } else if (routeName === 'Settings' || String(routeName || '').toLowerCase().startsWith('settings')) {
    screen = 'settings';
  } else if (routeName) {
    screen = String(routeName).toLowerCase();
  }
  return {
    screen,
    noteEditable: Boolean(noteEditable),
    noteLocked: Boolean(noteLocked),
  };
}

const MENU_UPDATE_DEBOUNCE_MS = 150;

let menuContextTimer = null;

export function pushMenuContext(context) {
  if (!backend.isDesktopRuntime()) return;
  if (menuContextTimer) clearTimeout(menuContextTimer);
  menuContextTimer = setTimeout(() => {
    menuContextTimer = null;
    updateMenu(context).catch(() => {});
  }, MENU_UPDATE_DEBOUNCE_MS);
}
