#!/usr/bin/env node
/**
 * Composable check: use* with Vue reactivity. ERROR if file in composable/ is not composable, WARN if use* outside.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const COMPOSABLE_DIR = join(SRC, 'composable');
// Pinia store factories are named `use*` but are stores, not composables.
const STORE_DIR = join(SRC, 'store');

const REACTIVITY_NAMES = [
  'ref', 'shallowRef', 'computed', 'watch', 'watchEffect', 'reactive',
  'shallowReactive', 'readonly', 'toRef', 'toRefs', 'isRef', 'unref',
  'markRaw', 'toRaw', 'defineModel', 'nextTick', 'inject', 'provide',
  'onMounted', 'onBeforeMount', 'onUpdated', 'onBeforeUpdate',
  'onUnmounted', 'onBeforeUnmount', 'onActivated', 'onDeactivated',
];
const REACTIVITY_RE = new RegExp(
  `\\b(${REACTIVITY_NAMES.join('|')})\\s*\\(`
);

const VUE_NAMED_IMPORT_RE = /from\s*['"]vue['"]/;

const USE_EXPORT_RES = [
  /export\s+(?:async\s+)?function\s+(use[A-Z]\w*)/g,
  /export\s+default\s+(?:async\s+)?function\s+(use[A-Z]\w*)/g,
  /export\s+\{\s*([^}]*\bus[A-Z]\w*[^}]*)\s*\}/g,
  /const\s+(use[A-Z]\w*)\s*=/g, // const useX = ... (exported later)
];

function usesReactivity(source) {
  if (!VUE_NAMED_IMPORT_RE.test(source)) return false;
  return REACTIVITY_RE.test(source);
}

function exportedUseNames(source) {
  const names = new Set();
  for (const res of USE_EXPORT_RES) {
    for (const match of source.matchAll(res)) {
      const captured = match[1] ?? '';
      const found = captured.match(/\buse[A-Z]\w*/g) ?? [];
      for (const name of found) names.add(name);
    }
  }
  return names;
}

function isComposableSource(source) {
  return usesReactivity(source) && exportedUseNames(source).size > 0;
}

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else if (/\.(js|ts)$/.test(entry) && !entry.endsWith('.spec.js') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

function walkSrc() {
  return collectFiles(SRC).filter(
    (f) => !f.startsWith(COMPOSABLE_DIR) && !f.startsWith(STORE_DIR)
  );
}

const errors = [];
const warnings = [];

for (const file of collectFiles(COMPOSABLE_DIR)) {
  const source = readFileSync(file, 'utf8');
  const rel = relative(SRC, file);
  const usesReact = usesReactivity(source);
  const useNames = exportedUseNames(source);

  if (useNames.size === 0) {
    errors.push(`${rel}: file in composable/ exports no \`use*\` function`);
  } else if (!usesReact) {
    errors.push(
      `${rel}: \`${[...useNames].join(', ')}\` uses no Vue reactivity — not a composable (move to src/utils/ or src/lib/)`
    );
  }
}

for (const file of walkSrc()) {
  const source = readFileSync(file, 'utf8');
  if (!usesReactivity(source)) continue;
  const useNames = exportedUseNames(source);
  if (useNames.size === 0) continue;
  const rel = relative(SRC, file);
  warnings.push(
    `${rel}: \`${[...useNames].join(', ')}\` uses Vue reactivity outside composable/`
  );
}

if (warnings.length > 0) {
  console.error(`[check-composables] ${warnings.length} composable(s) outside composable/:`);
  for (const w of warnings) console.error(`  warn  ${w}`);
}
if (errors.length > 0) {
  console.error(`[check-composables] ${errors.length} file(s) in composable/ that are not composables:`);
  for (const e of errors) console.error(`  error ${e}`);
}

process.exitCode = errors.length > 0 ? 1 : 0;
