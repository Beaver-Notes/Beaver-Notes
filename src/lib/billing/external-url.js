/**
 * Trust rule for URLs opened from billing flows (checkout portal links, invoice
 * emails, deep links shared between devices).
 *
 * Allowed: https only, a known billing host, or the account's own sync server
 * (passed per call so multi-account switches are respected). One rule for
 * PaywallDialog (checkout) and Account.vue (billing portal) so a new billing
 * host can't silently break one path while working in the other.
 */
export const BILLING_HOSTS = new Set([
  'checkout.stripe.com',
  'billing.stripe.com',
  'js.stripe.com',
]);

export function isAllowedBillingUrl(url, serverUrl) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (BILLING_HOSTS.has(parsed.hostname)) return true;
  try {
    return parsed.hostname === new URL(serverUrl).hostname;
  } catch {
    /* no custom server configured */
    return false;
  }
}

/** Returns true when the URL passed the trust rule and was opened. */
export async function openBillingUrl(url, serverUrl) {
  if (!isAllowedBillingUrl(url, serverUrl)) return false;
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return true;
}
