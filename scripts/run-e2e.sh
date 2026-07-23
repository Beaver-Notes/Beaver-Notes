#!/usr/bin/env bash
# Run E2E tests serially — one spec at a time.
# WDIO v9's local runner ignores maxInstances, so we orchestrate serial execution ourselves.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TauriWd="$HOME/.cargo/bin/tauri-wd"
VITE_BIN="$ROOT/node_modules/.bin/vite"
WD_PORT=4444
VITE_PORT=5173

cleanup() {
  echo -e "\n[cleanup] Stopping services..."
  [[ -n "${TAURI_WD_PID:-}" ]] && kill "$TAURI_WD_PID" 2>/dev/null || true
  [[ -n "${VITE_PID:-}" ]] && kill "$VITE_PID" 2>/dev/null || true
}
trap cleanup EXIT

is_port_open() {
  nc -z 127.0.0.1 "$1" 2>/dev/null
}

# Start Vite dev server if not already running
if is_port_open $VITE_PORT; then
  echo "[setup] Vite dev server already running on :$VITE_PORT"
else
  echo "[setup] Starting Vite dev server on :$VITE_PORT..."
  "$VITE_BIN" --config vite.config.js &
  VITE_PID=$!
  for i in $(seq 1 30); do
    is_port_open $VITE_PORT && break
    sleep 1
  done
  is_port_open $VITE_PORT || { echo "ERROR: Vite dev server failed to start"; exit 1; }
  echo "[setup] Vite dev server ready"
fi

# Start tauri-wd if not already running
if is_port_open $WD_PORT; then
  echo "[setup] tauri-wd already running on :$WD_PORT"
else
  echo "[setup] Starting tauri-wd on :$WD_PORT..."
  "$TauriWd" --port $WD_PORT --max-sessions 1 &
  TAURI_WD_PID=$!
  for i in $(seq 1 30); do
    is_port_open $WD_PORT && break
    sleep 1
  done
  is_port_open $WD_PORT || { echo "ERROR: tauri-wd failed to start"; exit 1; }
  echo "[setup] tauri-wd ready"
fi

echo ""
echo "========================================="
echo "  Beaver Notes E2E Test Suite"
echo "========================================="
echo ""

# Run each spec file serially
SPECS=("$ROOT"/tests/e2e/*.spec.js)
PASSED=0
FAILED=0
FAILED_SPECS=()

for spec in "${SPECS[@]}"; do
  spec_name="$(basename "$spec")"
  echo ""
  echo ">>> Running: $spec_name"
  echo "---"

  if npx wdio run "$ROOT/wdio.conf.mjs" --spec "$spec" 2>&1; then
    echo ">>> PASSED: $spec_name"
    PASSED=$((PASSED + 1))
  else
    echo ">>> FAILED: $spec_name"
    FAILED=$((FAILED + 1))
    FAILED_SPECS+=("$spec_name")
  fi
done

echo ""
echo "========================================="
echo "  Results: $PASSED passed, $FAILED failed"
echo "========================================="

if [[ $FAILED -gt 0 ]]; then
  echo ""
  echo "Failed specs:"
  for s in "${FAILED_SPECS[@]}"; do
    echo "  - $s"
  done
  exit 1
fi

echo ""
echo "All tests passed!"
