/**
 * Helpers for working with structured `AppError` values returned over IPC.
 *
 * Rust now serializes `AppError` as `{ "kind": "<Variant>", "message": "..." }`.
 * During the transition some commands may still reject with a plain string; this
 * helper tolerates that and simply returns `false` rather than throwing.
 */

export function isError(err, kind) {
  if (err == null || typeof err !== 'object') return false;
  if (typeof err.kind !== 'string') return false;
  return err.kind === kind;
}

/**
 * Extract a displayable message from an error value, regardless of whether it
 * is a structured `AppError` (`{ kind, message }`), a plain string, or a
 * non-object value. Intended for user-facing surfaces (toasts, alerts) so they
 * keep working while command rejections transition from strings to structured
 * errors.
 */
export function errorMessage(err) {
  if (err != null && typeof err === 'object' && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}
