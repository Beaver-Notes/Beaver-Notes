import { invoke } from '@tauri-apps/api/core';
import { isIOSRuntime } from '@/lib/tauri/runtime';

const suppressedSources = new Set();
let lastEnabledState = null;
let targetCount = 0;

async function syncScribbleState() {
  if (!isIOSRuntime()) return;

  const enabled = suppressedSources.size === 0 && targetCount > 0;
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

export function collectScribbleTargets(root = document) {
  const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const clip = (rect) => ({
    left: Math.max(viewport.left, rect.left),
    top: Math.max(viewport.top, rect.top),
    right: Math.min(viewport.right, rect.right),
    bottom: Math.min(viewport.bottom, rect.bottom),
  });
  const subtract = (rect, hole) => {
    const overlap = {
      left: Math.max(rect.left, hole.left),
      top: Math.max(rect.top, hole.top),
      right: Math.min(rect.right, hole.right),
      bottom: Math.min(rect.bottom, hole.bottom),
    };
    if (overlap.left >= overlap.right || overlap.top >= overlap.bottom) return [rect];

    return [
      { ...rect, bottom: overlap.top },
      { ...rect, top: overlap.bottom },
      { ...rect, right: overlap.left, top: overlap.top, bottom: overlap.bottom },
      { ...rect, left: overlap.right, top: overlap.top, bottom: overlap.bottom },
    ].filter((piece) => piece.left < piece.right && piece.top < piece.bottom);
  };

  return [...root.querySelectorAll('textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="number"], [contenteditable]:not([contenteditable="false"])')]
    .filter((element) => !element.disabled && !element.readOnly)
    .filter((element) => !element.closest('[contenteditable="false"]'))
    .flatMap((element) => {
      const rect = clip(element.getBoundingClientRect());
      if (rect.left >= rect.right || rect.top >= rect.bottom) return [];

      const exclusions = [...element.querySelectorAll('[contenteditable="false"]')]
        .map((excluded) => clip(excluded.getBoundingClientRect()));
      const visibleRects = exclusions.reduce(
        (rects, exclusion) => rects.flatMap((part) => subtract(part, exclusion)),
        [rect]
      );

      return visibleRects.map(({ left, top, right, bottom }) => ({
        left,
        top,
        width: right - left,
        height: bottom - top,
      }));
    });
}

export function updateScribbleTargets() {
  if (!isIOSRuntime()) return;

  const targets = collectScribbleTargets();
  targetCount = targets.length;
  void invoke('plugin:safe-area-insets-css|set_scribble_targets', { targets })
    .catch((error) => {
      console.warn('Failed to update Scribble targets:', error);
      targetCount = 0;
      lastEnabledState = null;
    })
    .finally(() => syncScribbleState());
}

export function initScribbleTargets() {
  if (!isIOSRuntime()) return;

  updateScribbleTargets();
  document.addEventListener('focusin', updateScribbleTargets);
  document.addEventListener('focusout', updateScribbleTargets);
  document.addEventListener('scroll', updateScribbleTargets, true);
  window.addEventListener('resize', updateScribbleTargets);
  new MutationObserver(updateScribbleTargets).observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
  });
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
