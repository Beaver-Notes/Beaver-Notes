#!/usr/bin/env node
/**
 * Bump version: package.json gets the full version; Cargo.toml and both Tauri configs get plain semver.
 * Both Tauri configs are kept in lockstep; notarization is per (bundle-id, version).
 * Use pre-release semver for betas so updater and tags stay unambiguous.
 */

import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(
    'Usage: node scripts/bump-version.mjs <version>\n' +
      'Examples:\n' +
      '  node scripts/bump-version.mjs 5.0.1            # stable\n' +
      '  node scripts/bump-version.mjs 5.0.1-beta.1     # beta'
  );
  process.exit(1);
}

// Tauri needs plain semver: strip pre-release for Tauri files, keep full string in package.json.
const tauriVersion = version.replace(/-.*$/, '');

const root = new URL('..', import.meta.url).pathname;

const pkgPath = root + 'package.json';
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`package.json        → ${version}`);

const cargoPath = root + 'src-tauri/Cargo.toml';
let cargo = readFileSync(cargoPath, 'utf8');
cargo = cargo.replace(/^version = ".*"/m, `version = "${tauriVersion}"`);
writeFileSync(cargoPath, cargo);
console.log(`Cargo.toml          → ${tauriVersion}`);

for (const confPath of ['src-tauri/tauri.conf.json', 'src-tauri/tauri.beta.conf.json']) {
  const fullPath = root + confPath;
  const conf = JSON.parse(readFileSync(fullPath, 'utf8'));
  conf.version = tauriVersion;
  writeFileSync(fullPath, JSON.stringify(conf, null, 2) + '\n');
  console.log(`${confPath} → ${tauriVersion}`);
}

console.log('\nDone.');
