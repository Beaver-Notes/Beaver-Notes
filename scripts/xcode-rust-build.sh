#!/bin/sh

set -eu

# Xcode GUI builds often omit user-installed toolchains from PATH.
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Xcode overrides TMPDIR for build phases, but `cargo tauri ios dev` writes
# the server-addr file to the terminal's TMPDIR. Restore it so xcode-script
# can find the file.
_SAVED_TMPDIR="${PROJECT_DIR:?}/../../.tmpdir"
if [ -f "$_SAVED_TMPDIR" ]; then
  export TMPDIR="$(cat "$_SAVED_TMPDIR")"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo not found. Install Rust with rustup or add ~/.cargo/bin to Xcode's PATH."
  exit 1
fi

cd "$(dirname "$0")/../src-tauri"

set -- tauri ios xcode-script -v \
  --platform "${PLATFORM_DISPLAY_NAME:?}" \
  --sdk-root "${SDKROOT:?}" \
  --framework-search-paths "${FRAMEWORK_SEARCH_PATHS:?}" \
  --header-search-paths "${HEADER_SEARCH_PATHS:?}" \
  --gcc-preprocessor-definitions "${GCC_PREPROCESSOR_DEFINITIONS:-}" \
  --configuration "${CONFIGURATION:?}"

if [ -n "${FORCE_COLOR:-}" ]; then
  set -- "$@" "${FORCE_COLOR}"
fi

set -- "$@" "${ARCHS:?}"

exec cargo "$@"
