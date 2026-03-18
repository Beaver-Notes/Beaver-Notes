#!/bin/sh

set -eu

# Xcode GUI builds often omit user-installed toolchains from PATH.
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo not found. Install Rust with rustup or add ~/.cargo/bin to Xcode's PATH."
  exit 1
fi

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
