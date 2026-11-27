#!/usr/bin/env bash
#
# Materialises android/.tauri/tauri-api, the :tauri-android project that
# android/settings.gradle includes.
#
# It is a copy of the tauri crate's own mobile/android library project. Normally the
# Tauri CLI drops it there while building an app for Android — nothing in this
# repository's build does it, and it is gitignored, so a fresh checkout cannot run
# ./gradlew at all. This performs the same copy straight from the crate source cargo
# has already downloaded, which is what makes `./gradlew test` runnable in CI without
# building an entire Android app first.
#
# Safe to re-run: an existing copy is replaced.
set -euo pipefail

cd "$(dirname "$0")/.."

tauri_src=$(
  cargo metadata --format-version 1 | python3 -c '
import json, os, sys

meta = json.load(sys.stdin)
manifests = [p["manifest_path"] for p in meta["packages"] if p["name"] == "tauri"]
if len(manifests) != 1:
    sys.exit(f"expected exactly one tauri package, found {len(manifests)}")
print(os.path.dirname(manifests[0]))
'
)

android_src="$tauri_src/mobile/android"
if [ ! -d "$android_src" ]; then
  echo "tauri crate at $tauri_src has no mobile/android directory" >&2
  exit 1
fi

dest="android/.tauri/tauri-api"
mkdir -p "$(dirname "$dest")"
rm -rf "$dest"
cp -R "$android_src" "$dest"

echo "Materialised $dest from $android_src"
