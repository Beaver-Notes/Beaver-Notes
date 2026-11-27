#!/usr/bin/env bash
# Run every gate that guards a release, in parallel, and print one pass/fail table.
#
#   bash scripts/verify-all.sh
#
# Prerequisites (only the server gate needs them):
#   cd ../Beaver-Sync && docker compose -f docker-compose.test.yml up -d
#     -> postgres on :5432, seaweedfs on :9000, api on :4000, ws-relay on :8080
#   Without them the server gate is SKIPPED, not failed.
#
# Cross-process behaviour (real login, real sync, real websocket) is NOT covered
# here. For that: boot the compose stack, then `bash scripts/run-e2e.sh`.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SYNC="${BEAVER_SYNC_DIR:-$ROOT/../Beaver-Sync}"
LOG_DIR="$(mktemp -d)"
trap 'rm -rf "$LOG_DIR"' EXIT

port_open() { nc -z 127.0.0.1 "$1" 2>/dev/null; }

# tauri-plugin-iap 0.10.0-rc.10's build.rs points cargo at a swift-build
# directory SwiftPM never creates, so `cargo test` cannot find its static lib.
# The real .a lives one level up. This symlink is inside target/, so it is
# throwaway and `cargo clean` discards it.
fix_iap_link() {
  for profile in debug release; do
    for dir in "$ROOT"/src-tauri/target/"$profile"/build/tauri-plugin-iap-*/out/swift-build/arm64-apple-macosx; do
      [ -d "$dir" ] || continue
      [ -e "$dir/$profile" ] || ln -s "../$profile" "$dir/$profile" 2>/dev/null
    done
  done
}

run() { # name, workdir, command...
  local name="$1" dir="$2"; shift 2
  ( cd "$dir" && "$@" >"$LOG_DIR/$name.log" 2>&1 )
  echo $? >"$LOG_DIR/$name.code"
}

fix_iap_link
run lint    "$ROOT" yarn lint
run unit    "$ROOT" npx vitest run
run rust    "$ROOT/src-tauri" cargo test --lib --quiet
if port_open 5432 && port_open 9000; then
  run server "$SYNC" node --test --test-concurrency=1
  SERVER_STATE=run
else
  SERVER_STATE=skip
fi

printf '\n%-8s %-6s %s\n' GATE RESULT SUMMARY
printf '%s\n' '----------------------------------------'
fail=0
for g in lint unit rust server; do
  case "$g" in
    lint)   label='client lint + typecheck' ;;
    unit)   label='client vitest' ;;
    rust)   label='cargo test --lib' ;;
    server) label='server node --test' ;;
  esac
  if [ "$g" = server ] && [ "$SERVER_STATE" = skip ]; then
    printf '%-8s %-6s %s\n' "$g" SKIP 'no postgres/seaweedfs on :5432/:9000 — start docker-compose.test.yml'
    continue
  fi
  code="$(cat "$LOG_DIR/$g.code" 2>/dev/null || echo 1)"
  if [ "$code" = 0 ]; then
    printf '%-8s %-6s %s\n' "$g" PASS "$label"
  else
    printf '%-8s %-6s %s (exit %s) — see below\n' "$g" FAIL "$label" "$code"
    tail -25 "$LOG_DIR/$g.log"
    printf '%s\n' '----------------------------------------'
    fail=1
  fi
done

if [ "$fail" = 0 ]; then
  printf '\nAll gates green. For cross-process coverage: docker compose -f docker-compose.test.yml up -d (in %s) then bash scripts/run-e2e.sh\n' "$SYNC"
fi
exit "$fail"
