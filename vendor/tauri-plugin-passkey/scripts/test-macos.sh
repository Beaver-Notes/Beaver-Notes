#!/bin/sh
# Runs the Rust test suite on macOS. Plain `swift` here is an old swiftly
# toolchain that cannot build the WebauthnBridge package, and the devenv `cc`
# cannot see macOS system libraries — override both.
set -e
cd "$(dirname "$0")/.."
PATH="$(dirname "$(xcrun --find swift)"):$PATH" \
RUSTFLAGS="-C linker=/usr/bin/cc" \
exec cargo test "$@"
