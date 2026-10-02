#!/usr/bin/env bash
# Run two isolated Tauri dev instances side by side to test cloud sync.
#
# Sign in with the SAME Beaver-Sync account in both windows: they appear as
# two devices. Isolation comes from a suffixed app identifier (separate
# WebKit store, settings, single-instance lock) plus BEAVER_NOTES_DATA_DIR
# (separate secure blobs: tokens, device ids).
#
# Usage: BEAVER_SYNC_URL=http://localhost:3000 bash scripts/run-duo.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DUO_DIR="$ROOT/.duo"
SESSION_A="$DUO_DIR/session-a"
SESSION_B="$DUO_DIR/session-b"
TARGET_B="$DUO_DIR/target-b"

A_PORT=5173
B_PORT="${DUO_B_PORT:-5174}"
SYNC_URL="${BEAVER_SYNC_URL:-http://localhost:4000}"

TAURI_BIN="$ROOT/node_modules/.bin/tauri"
VITE_BIN="$ROOT/node_modules/.bin/vite"

is_port_open() {
  nc -z 127.0.0.1 "$1" 2>/dev/null
}

cleanup() {
  echo -e "\n[duo] stopping..."
  [[ -n "${VITE_B_PID:-}" ]] && kill "$VITE_B_PID" 2>/dev/null || true
  [[ -n "${TAURI_A_PID:-}" ]] && kill "$TAURI_A_PID" 2>/dev/null || true
  [[ -n "${TAURI_B_PID:-}" ]] && kill "$TAURI_B_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- preflight ---
[[ -x "$TAURI_BIN" ]] || { echo "ERROR: $TAURI_BIN missing (run yarn install)"; exit 1; }
[[ -x "$VITE_BIN" ]] || { echo "ERROR: $VITE_BIN missing (run yarn install)"; exit 1; }
command -v python3 >/dev/null || { echo "ERROR: python3 required"; exit 1; }
is_port_open "$A_PORT" && { echo "ERROR: port $A_PORT busy (instance A needs it)"; exit 1; }
is_port_open "$B_PORT" && { echo "ERROR: port $B_PORT busy (override with DUO_B_PORT=...)"; exit 1; }
if ! curl -s -o /dev/null -m 3 "$SYNC_URL"; then
  echo "ERROR: sync server not reachable at $SYNC_URL"
  echo "  start it first, e.g.: cd ../Beaver-Sync && docker compose up -d && yarn dev"
  exit 1
fi
echo "[duo] sync server reachable at $SYNC_URL"

mkdir -p "$SESSION_A" "$SESSION_B"

# --- instance B config: merge overrides in python so the result does not
# depend on the CLI's merge depth; merging a complete file is idempotent. ---
B_CONFIG="$DUO_DIR/tauri.duo-b.conf.json"
python3 - "$ROOT/src-tauri/tauri.conf.json" "$B_CONFIG" "$B_PORT" <<'EOF'
import json, sys
base_path, out_path, port = sys.argv[1], sys.argv[2], sys.argv[3]
with open(base_path) as f:
    cfg = json.load(f)
cfg["identifier"] = "com.beavernotes.beaver-notes.duo-b"
cfg["productName"] = "Beaver Notes (duo B)"
cfg.setdefault("build", {})["devUrl"] = f"http://127.0.0.1:{port}"
windows = cfg.setdefault("app", {}).setdefault("windows", [{}])
windows[0]["title"] = "Beaver Notes (duo B)"
with open(out_path, "w") as f:
    json.dump(cfg, f, indent=2)
EOF
echo "[duo] wrote instance B config"

# Default the in-app server URL at build time so both windows point at the
# local server out of the box (still changeable in Settings -> Account).
# VITE_DUO_SUFFIX namespaces the encrypted localStorage session mirror per
# instance: both dev windows share one WebKit store, and without it a fresh
# instance resurrects the other instance's session through the mirror.
DUO_VITE_ENV="VITE_BEAVER_SYNC_API_URL=$SYNC_URL"

# --- vite for B (beforeDevCommand reuses it via TAURI_DEV_PORT) ---
echo "[duo] starting vite for instance B on :$B_PORT..."
env $DUO_VITE_ENV VITE_DUO_SUFFIX=B \
  "$VITE_BIN" --config vite.config.js --port "$B_PORT" >"$DUO_DIR/vite-b.log" 2>&1 &
VITE_B_PID=$!
for _ in $(seq 1 30); do is_port_open "$B_PORT" && break; sleep 1; done
is_port_open "$B_PORT" || { echo "ERROR: vite for B failed (see $DUO_DIR/vite-b.log)"; exit 1; }

# --- instance A (normal dev, isolated data dir) ---
echo "[duo] starting instance A (normal identifier, :$A_PORT)..."
cd "$ROOT"
BEAVER_NOTES_DATA_DIR="$SESSION_A" env $DUO_VITE_ENV VITE_DUO_SUFFIX=A \
  "$TAURI_BIN" dev ${1+"$@"} >"$DUO_DIR/a.log" 2>&1 &
TAURI_A_PID=$!

# --- instance B (own identifier, data dir, and cargo target dir) ---
echo "[duo] starting instance B (duo-b identifier, :$B_PORT)..."
BEAVER_NOTES_DATA_DIR="$SESSION_B" CARGO_TARGET_DIR="$TARGET_B" TAURI_DEV_PORT="$B_PORT" \
  env $DUO_VITE_ENV VITE_DUO_SUFFIX=B \
  "$TAURI_BIN" dev --config "$B_CONFIG" ${1+"$@"} >"$DUO_DIR/b.log" 2>&1 &
TAURI_B_PID=$!

echo ""
echo "Two windows coming up: 'Beaver Notes' (A) and 'Beaver Notes (duo B)' (B)."
echo "  1. Server URL is prefilled to $SYNC_URL in both (changeable in Settings -> Account)."
echo "     Use a localhost URL, not 127.0.0.1: the webview CSP only allows http://localhost:*."
echo "  2. Sign in with the SAME account in both (cloud needs a paid plan;"
echo "     Beaver-Sync has 'yarn seed:tier' for test tiers)."
echo "  3. Set sync transport to Cloud in both, create/edit a note in A, watch B."
echo "Logs: $DUO_DIR/{a,b,vite-b}.log   Ctrl-C stops everything."
echo ""
wait
