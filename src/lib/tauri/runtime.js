const PHONE_USER_AGENT_RE = /Android|iPhone|iPod/i;
const IPAD_USER_AGENT_RE = /iPad/i;
const MOBILE_USER_AGENT_RE = /Android|iPhone|iPad|iPod/i;
const IOS_USER_AGENT_RE = /iPhone|iPad|iPod/i;
const MACOS_USER_AGENT_RE = /Macintosh/i;

export function isMobileRuntime() {
  return (
    typeof navigator !== 'undefined' &&
    MOBILE_USER_AGENT_RE.test(navigator.userAgent || '')
  );
}

export function isPhoneRuntime() {
  return (
    typeof navigator !== 'undefined' &&
    PHONE_USER_AGENT_RE.test(navigator.userAgent || '')
  );
}

export function isIPadRuntime() {
  return (
    typeof navigator !== 'undefined' &&
    IPAD_USER_AGENT_RE.test(navigator.userAgent || '')
  );
}

export function isTabletRuntime() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined')
    return false;
  return isIPadRuntime() || (isPhoneRuntime() && window.innerWidth >= 768);
}

export function isIOSRuntime() {
  return (
    typeof navigator !== 'undefined' &&
    IOS_USER_AGENT_RE.test(navigator.userAgent || '')
  );
}

export function isMacOSRuntime() {
  return (
    typeof navigator !== 'undefined' &&
    MACOS_USER_AGENT_RE.test(navigator.userAgent || '') &&
    !IOS_USER_AGENT_RE.test(navigator.userAgent || '')
  );
}

export function isAppleRuntime() {
  return isIOSRuntime() || isMacOSRuntime();
}
