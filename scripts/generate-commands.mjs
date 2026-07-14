#!/usr/bin/env node
/**
 * Validate and regenerate the commandAliases block in src/lib/tauri/commands.js.
 *
 * The normalizePayload function is hand-maintained because it contains
 * command-specific logic that cannot be derived from parameter names alone.
 * This script only handles the commandAliases map at the top of the file.
 *
 * Usage:
 *   node scripts/generate-commands.mjs          # regenerate aliases block in commands.js
 *   node scripts/generate-commands.mjs --check  # validate only (no write, exits non-zero on drift)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALIASES_PATH = resolve(ROOT, 'scripts', 'command-aliases.json');
const MANIFEST_PATH = resolve(ROOT, 'src-tauri', 'generated-commands.json');
const COMMANDS_JS_PATH = resolve(ROOT, 'src', 'lib', 'tauri', 'commands.js');

const checkMode = process.argv.includes('--check');

const aliases = JSON.parse(readFileSync(ALIASES_PATH, 'utf8'));
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const commandsJs = readFileSync(COMMANDS_JS_PATH, 'utf8');

// ── Validate alias map against manifest ──────────────────────────────────────

const errors = [];

// Commands defined in external plugin crates (not in our manifest)
const pluginCommands = new Set([
  'enable_indexing', 'index_items', 'delete_items', 'delete_domain',
  'is_supported', 'get_name', 'change', 'reset',
]);

// Commands that exist in Rust but have no JS-facing alias
// (internal-only, not exposed, or work via mapCommand fallback)
const internalCommands = new Set([
  'migration_read_legacy_data', 'migration_write_legacy_data',
  'show_notification', 'fs_remove', 'encryption_rotate_key',
  'is_encrypted_asset', 'get_installation_source',
]);

// Check every alias points to a known Rust command
for (const [jsName, rustName] of Object.entries(aliases)) {
  if (pluginCommands.has(rustName) || internalCommands.has(rustName)) continue;
  if (!manifest[rustName]) {
    errors.push(`Alias "${jsName}" → "${rustName}" has no matching Rust command in manifest`);
  }
}

// Check every non-plugin/internal Rust command has at least one alias
for (const rustName of Object.keys(manifest)) {
  if (pluginCommands.has(rustName) || internalCommands.has(rustName)) continue;
  const hasAlias = Object.values(aliases).includes(rustName);
  if (!hasAlias) {
    errors.push(`Rust command "${rustName}" has no JS alias in the alias map`);
  }
}

// ── Validate commands.js contains the aliases ────────────────────────────────

// Extract the current aliases block from commands.js
const aliasesBlockMatch = commandsJs.match(/const commandAliases = \{[\s\S]*?\};/);
if (!aliasesBlockMatch) {
  errors.push('Could not find commandAliases block in commands.js');
} else {
  // Check every alias is present in commands.js
  for (const [jsName, rustName] of Object.entries(aliases)) {
    if (!commandsJs.includes(`'${jsName}': '${rustName}'`)) {
      errors.push(`Alias "${jsName}" → "${rustName}" missing from commands.js`);
    }
  }
}

if (errors.length > 0) {
  console.error('IPC command map validation failed:\n');
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

if (checkMode) {
  console.log(`IPC command map OK — ${Object.keys(aliases).length} aliases, ${Object.keys(manifest).length} commands`);
  process.exit(0);
}

// ── Regenerate aliases block in commands.js ──────────────────────────────────

function generateAliasesBlock() {
  const lines = [];
  lines.push('const commandAliases = {');
  for (const [jsName, rustName] of Object.entries(aliases)) {
    lines.push(`  '${jsName}': '${rustName}',`);
  }
  lines.push('};');
  return lines.join('\n');
}

const newAliasesBlock = generateAliasesBlock();
const updated = commandsJs.replace(
  /const commandAliases = \{[\s\S]*?\};/,
  newAliasesBlock
);

writeFileSync(COMMANDS_JS_PATH, updated, 'utf8');
console.log(`Updated commandAliases block in ${COMMANDS_JS_PATH}`);
console.log(`  ${Object.keys(aliases).length} command aliases`);
console.log(`  ${Object.keys(manifest).length} Rust commands in manifest`);
