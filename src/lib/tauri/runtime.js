const MOBILE_USER_AGENT_RE = /Android|iPhone|iPad|iPod/i;

export function isMobileRuntime() {
  return (
    typeof navigator !== 'undefined' &&
    MOBILE_USER_AGENT_RE.test(navigator.userAgent || '')
  );
}
