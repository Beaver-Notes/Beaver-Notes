#!/usr/bin/env node
/**
 * Bump version: stable updates package.json, Cargo.toml, tauri.conf.json; beta updates tauri.beta.conf.json.
 * Notarization is per (bundle-id, version); use pre-release semver for betas so updater and tags stay unambiguous.
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

// Beta if pre-release identifier or --beta flag.
const isBeta = isBetaFlag || version.includes('-');

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

if (isBeta) {
  // Beta: only tauri.beta.conf.json, stable conf untouched.
  const betaConfPath = root + 'src-tauri/tauri.beta.conf.json';
  const betaConf = JSON.parse(readFileSync(betaConfPath, 'utf8'));
  betaConf.version = tauriVersion;
  writeFileSync(betaConfPath, JSON.stringify(betaConf, null, 2) + '\n');
  console.log(`tauri.beta.conf.json → ${tauriVersion}`);
  console.log(
    '\ntauri.conf.json left unchanged (stable version preserved).'
  );
} else {
  // Stable: only tauri.conf.json, beta conf untouched.
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
