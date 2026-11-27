/**
 * Fold geometry client. The native plugin answers once at startup and on every
 * fold; this module turns that answer into CSS variables on <html>, so layout
 * reads variables and never the plugin.
 */
import { reactive } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { computeFoldLayout } from './geometry';
import { applyFoldLayout } from './apply';

export { applyFoldLayout };

const HARDWARE_KEY = 'beaver.foldableHardware';
const COMMAND = 'plugin:safe-area-insets-css|get_fold_state';

export const foldState = reactive({
  isFoldable: false,
  source: 'none',
  orientation: 'none',
  crease: null,
  segments: [],
  segmentWidth: 0,
});

function readHardwareFlag() {
  try {
    return localStorage.getItem(HARDWARE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHardwareFlag() {
  try {
    localStorage.setItem(HARDWARE_KEY, '1');
  } catch {
    // storage unavailable: the rail just reappears on the next native answer
  }
}

function publish(state) {
  const layout = computeFoldLayout({
    state,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    // A folded Duo reports no crease. Once the hardware is known, stay foldable
    // across poses so the rail does not appear and vanish with the hinge.
    fallbackFoldable: readHardwareFlag(),
  });

  Object.assign(foldState, { isFoldable: layout.source !== 'none', ...layout });
  applyFoldLayout(layout, document.documentElement);
  return layout;
}

let started = false;

export async function initFoldState() {
  if (started) return;
  started = true;

  let lastState = null;

  const refresh = async () => {
    try {
      lastState = await invoke(COMMAND);
      if (lastState?.foldable) writeHardwareFlag();
    } catch {
      lastState = null;
    }
    publish(lastState);
  };

  await refresh();

  // No native event: a fold always resizes the webview, so the listeners below
  // already cover it. ponytail: a posture change with identical window bounds is
  // not observed, which changes nothing the layout reads.
  let timer = 0;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(refresh, 150);
  };
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
}
