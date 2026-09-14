const PHONE_USER_AGENT_RE = /Android|iPhone|iPod/i;
const IPAD_USER_AGENT_RE = /iPad/i;
const MOBILE_USER_AGENT_RE = /Android|iPhone|iPad|iPod|Mobile/i;
const IOS_USER_AGENT_RE = /iPhone|iPad|iPod/i;
const MACOS_USER_AGENT_RE = /Macintosh/i;

export function isMobileRuntime() {
  if (typeof navigator === 'undefined') return false;
  return (
    MOBILE_USER_AGENT_RE.test(navigator.userAgent || '') || isIPadRuntime()
  );
}

export function isPhoneRuntime() {
  return (
    typeof navigator !== 'undefined' &&
    PHONE_USER_AGENT_RE.test(navigator.userAgent || '')
  );
}

export function isIPadRuntime() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (IPAD_USER_AGENT_RE.test(ua)) return true;
  // ponytail: iPadOS 13+ sends desktop-class UA (Macintosh, no iPad token); touch discriminates it from Mac
  return (
    MACOS_USER_AGENT_RE.test(ua) && (navigator.maxTouchPoints ?? 0) > 1
  );
}

export function isTabletRuntime() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined')
    return false;
  return isIPadRuntime() || (isFoldablePhoneRuntime() && window.innerWidth >= 768);
}

export function isFoldablePhoneRuntime() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined')
    return false;
  if (!isPhoneRuntime()) return false;
  // ponytail: live viewport, never window.screen (static across folds, deprecated per Apple 111461)
  const w = window.visualViewport?.width ?? window.innerWidth;
  const h = window.visualViewport?.height ?? window.innerHeight;
  return Math.min(w, h) >= 600;
}

export function isIOSRuntime() {
  if (typeof navigator === 'undefined') return false;
  return (
    IOS_USER_AGENT_RE.test(navigator.userAgent || '') || isIPadRuntime()
  );
}

export function isMacOSRuntime() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (
    MACOS_USER_AGENT_RE.test(ua) &&
    !IOS_USER_AGENT_RE.test(ua) &&
    !/Mobile/.test(ua) &&
    !isIPadRuntime()
  );
}

export function isAppleRuntime() {
  return isIOSRuntime() || isMacOSRuntime();
}

export function isTouchRuntime() {
  return isMobileRuntime();
}

export function isDesktopRuntime() {
  return !isTouchRuntime();
}
