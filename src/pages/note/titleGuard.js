export function isTitleFocused(titleEl) {
  if (!titleEl) return false;
  return document.activeElement === titleEl;
}
