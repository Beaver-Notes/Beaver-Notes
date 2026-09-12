import { readDir, writeFile } from '@/lib/native/fs';
import { path } from '@/lib/tauri-bridge';
import { YJS_UPDATE_EXT } from './constants.js';
import { writeInitialSnapshots } from './transports/seed.js';

export function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

export function toUpdateBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every((byte) => isNonNegativeInteger(byte) && byte <= 255)) {
    return new Uint8Array(value);
  }
  return null;
}

export function buildAadSuffix(parsed) {
  return parsed?.isSnapshot
    ? `${parsed.docId}-snapshot-${parsed.ts}`
    : `${parsed.docId}-${parsed.ts}`;
}

/** Idempotent seed guarded by ._seeded marker: safe to repeat. */
export async function seedOnce(commitsDir) {
  try {
    const files = await readDir(commitsDir).catch(() => []);
    if (files.some((f) => f === '._seeded')) return;

    const wroteMarker = await writeFile(
      path.join(commitsDir, '._seeded'),
      ''
    ).then(() => true, () => false);
    if (!wroteMarker) return;

    const hasYjsFiles = files.some((f) => f.endsWith(YJS_UPDATE_EXT));
    if (!hasYjsFiles) {
      await writeInitialSnapshots(commitsDir);
    }
  } catch {
    // best-effort
  }
}
