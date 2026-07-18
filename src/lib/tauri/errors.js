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
