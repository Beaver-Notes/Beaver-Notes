#!/usr/bin/env node
/**
 * bump-version.mjs
 *
 * Usage:
 *   node scripts/bump-version.mjs <version> [--beta]
 *
 * Examples:
 *   node scripts/bump-version.mjs 5.0.0             # stable release
 *   node scripts/bump-version.mjs 5.0.0-beta.1      # beta release
 *   node scripts/bump-version.mjs 5.0.0 --beta      # stable version, beta channel (e.g. first beta for an upcoming release)
 *
 * Stable release  → updates package.json, Cargo.toml, tauri.conf.json
 * Beta release    → updates package.json, Cargo.toml, tauri.beta.conf.json
 *                   tauri.conf.json is left at its current stable version
 *
 * Apple notarization note:
 *   The beta bundle ID is com.danielerolli.beaver-notes.beta, which is
 *   separate from the stable com.danielerolli.beaver-notes. Apple tracks
 *   notarization per (bundle-id, version), so beta and stable versions
 *   never conflict — even if they share the same base semver number.
 *   Using pre-release semver (5.0.0-beta.1) for betas is still recommended
 *   so the Tauri updater and GitHub release tags are unambiguous.
 */

import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));
const isBetaFlag = args.includes('--beta');

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(
    'Usage: node scripts/bump-version.mjs <version> [--beta]\n' +
      'Examples:\n' +
      '  node scripts/bump-version.mjs 5.0.1            # stable\n' +
      '  node scripts/bump-version.mjs 5.0.0-beta.1     # beta\n' +
      '  node scripts/bump-version.mjs 5.0.0 --beta     # stable ver, beta channel'
  );
  process.exit(1);
}

// A version is treated as "beta" if it contains a pre-release identifier OR --beta is passed.
const isBeta = isBetaFlag || version.includes('-');

// Tauri requires a plain semver for its version field (no pre-release suffixes).
// We strip the pre-release part for the files that Tauri reads at build time,
// but keep the full string in package.json so the GitHub release tag is correct.
const tauriVersion = version.replace(/-.*$/, '');

const root = new URL('..', import.meta.url).pathname;

// ── package.json ────────────────────────────────────────────────────────────
const pkgPath = root + 'package.json';
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`package.json        → ${version}`);

// ── Cargo.toml ──────────────────────────────────────────────────────────────
// Cargo also requires plain semver, so we use tauriVersion here.
const cargoPath = root + 'src-tauri/Cargo.toml';
let cargo = readFileSync(cargoPath, 'utf8');
cargo = cargo.replace(/^version = ".*"/m, `version = "${tauriVersion}"`);
writeFileSync(cargoPath, cargo);
console.log(`Cargo.toml          → ${tauriVersion}`);

// ── tauri config ─────────────────────────────────────────────────────────────
if (isBeta) {
  // Beta builds: update tauri.beta.conf.json only.
  // tauri.conf.json is left at its current stable version so a stable build
  // can be cut from the same commit without version confusion.
  const betaConfPath = root + 'src-tauri/tauri.beta.conf.json';
  const betaConf = JSON.parse(readFileSync(betaConfPath, 'utf8'));
  betaConf.version = tauriVersion;
  writeFileSync(betaConfPath, JSON.stringify(betaConf, null, 2) + '\n');
  console.log(`tauri.beta.conf.json → ${tauriVersion}`);
  console.log(
    '\ntauri.conf.json left unchanged (stable version preserved).'
  );
} else {
  // Stable builds: update tauri.conf.json only.
  // tauri.beta.conf.json is left alone; the next beta bump will update it.
  const confPath = root + 'src-tauri/tauri.conf.json';
  const conf = JSON.parse(readFileSync(confPath, 'utf8'));
  conf.version = tauriVersion;
  writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');
  console.log(`tauri.conf.json     → ${tauriVersion}`);
  console.log(
    '\ntauri.beta.conf.json left unchanged (beta version preserved).'
  );
}

console.log('\nDone.');
