#!/usr/bin/env bash
# Run several isolated Tauri dev instances side by side to test cloud sync / collab.
#
# Default profiles: A B C D E (five isolated users). Override with:
#   DUO_INSTANCES="A B" bash scripts/run-duo.sh
#
# Each instance gets its own app identifier (separate WebKit store), data dir
# (separate secure blobs: tokens, device ids) and vite port. Instance A uses the
# base config; B..E get a generated per-instance config.
#
# Extra args are forwarded to every `tauri dev`, e.g. the test-only e2e bridge:
#   bash scripts/run-duo.sh --no-default-features --features webdriver-debug
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DUO_DIR="$ROOT/.duo"

SYNC_URL="${BEAVER_SYNC_URL:-http://localhost:4000}"
INSTANCES=(${DUO_INSTANCES:-A B C D E})

TAURI_BIN="$ROOT/node_modules/.bin/tauri"
VITE_BIN="$ROOT/node_modules/.bin/vite"
TARGET_B="$DUO_DIR/target-b"

lower() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }
vite_port() { case "$1" in A) echo 5173 ;; B) echo 5174 ;; C) echo 5175 ;; D) echo 5176 ;; E) echo 5177 ;; *) return 1 ;; esac; }
e2e_port() { case "$1" in A) echo 53891 ;; B) echo 53890 ;; C) echo 53892 ;; D) echo 53893 ;; E) echo 53894 ;; *) return 1 ;; esac; }

is_port_open() { nc -z 127.0.0.1 "$1" 2>/dev/null; }

VITE_PIDS=()
TAURI_PIDS=()
cleanup() {
  echo -e "\n[duo] stopping..."
  for pid in "${VITE_PIDS[@]}" "${TAURI_PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

# --- preflight ---
[[ -x "$TAURI_BIN" ]] || { echo "ERROR: $TAURI_BIN missing (run yarn install)"; exit 1; }
[[ -x "$VITE_BIN" ]] || { echo "ERROR: $VITE_BIN missing (run yarn install)"; exit 1; }
command -v python3 >/dev/null || { echo "ERROR: python3 required"; exit 1; }
for x in "${INSTANCES[@]}"; do
  p="$(vite_port "$x")" || { echo "ERROR: unknown instance '$x' (known: A B C D E)"; exit 1; }
  is_port_open "$p" && { echo "ERROR: port $p busy (instance $x needs it)"; exit 1; }
done
if ! curl -s -o /dev/null -m 3 "$SYNC_URL"; then
  echo "ERROR: sync server not reachable at $SYNC_URL"
  echo "  start it first, e.g.: cd ../Beaver-Sync && docker compose up -d && yarn dev"
  exit 1
fi
echo "[duo] sync server reachable at $SYNC_URL (${#INSTANCES[@]} instance(s): ${INSTANCES[*]})"

for x in "${INSTANCES[@]}"; do mkdir -p "$DUO_DIR/session-$(lower "$x")"; done

# --- per-instance tauri config (B..E): merge overrides in python so the result
# does not depend on the CLI's merge depth; merging a complete file is idempotent. ---
for x in "${INSTANCES[@]}"; do
  [[ "$x" == "A" ]] && continue
  l="$(lower "$x")"
  python3 - "$ROOT/src-tauri/tauri.conf.json" "$DUO_DIR/tauri.duo-$l.conf.json" "$(vite_port "$x")" "$x" "$l" <<'EOF'
import json, sys
base_path, out_path, port, letter, low = sys.argv[1:6]
with open(base_path) as f:
    cfg = json.load(f)
cfg["identifier"] = f"com.beavernotes.beaver-notes.duo-{low}"
cfg["productName"] = f"Beaver Notes (duo {letter})"
cfg.setdefault("build", {})["devUrl"] = f"http://127.0.0.1:{port}"
windows = cfg.setdefault("app", {}).setdefault("windows", [{}])
windows[0]["title"] = f"Beaver Notes (duo {letter})"
with open(out_path, "w") as f:
    json.dump(cfg, f, indent=2)
EOF
  echo "[duo] wrote instance $x config tauri.duo-$l.conf.json"
done

# Default the in-app server URL at build time so every window points at the
# local server out of the box (still changeable in Settings -> Account).
# VITE_DUO_SUFFIX namespaces the encrypted localStorage session mirror per
# instance: the dev windows can share one WebKit store, and without it a fresh
# instance resurrects another instance's session through the mirror.
DUO_VITE_ENV="VITE_BEAVER_SYNC_API_URL=$SYNC_URL"

# --- vite per instance (beforeDevCommand reuses it via TAURI_DEV_PORT) ---
for x in "${INSTANCES[@]}"; do
  p="$(vite_port "$x")"
  echo "[duo] starting vite for instance $x on :$p..."
  env $DUO_VITE_ENV VITE_DUO_SUFFIX="$x" \
    "$VITE_BIN" --config vite.config.js --port "$p" >"$DUO_DIR/vite-$(lower "$x").log" 2>&1 &
  VITE_PIDS+=("$!")
done
for x in "${INSTANCES[@]}"; do
  p="$(vite_port "$x")"
  for _ in $(seq 1 30); do is_port_open "$p" && break; sleep 1; done
  is_port_open "$p" || { echo "ERROR: vite for instance $x failed (see $DUO_DIR/vite-$(lower "$x").log)"; exit 1; }
done

# --- tauri per instance ---
cd "$ROOT"
for x in "${INSTANCES[@]}"; do
  l="$(lower "$x")"; p="$(vite_port "$x")"; e="$(e2e_port "$x")"
  echo "[duo] starting instance $x (:$p, e2e :$e)..."
  if [[ "$x" == "A" ]]; then
    BEAVER_NOTES_DATA_DIR="$DUO_DIR/session-$l" TAURI_DEV_PORT="$p" BEAVER_E2E_PORT="$e" \
      env $DUO_VITE_ENV VITE_DUO_SUFFIX="$x" \
      "$TAURI_BIN" dev ${1+"$@"} >"$DUO_DIR/$l.log" 2>&1 &
  else
    BEAVER_NOTES_DATA_DIR="$DUO_DIR/session-$l" CARGO_TARGET_DIR="$TARGET_B" TAURI_DEV_PORT="$p" BEAVER_E2E_PORT="$e" \
      env $DUO_VITE_ENV VITE_DUO_SUFFIX="$x" \
      "$TAURI_BIN" dev --config "$DUO_DIR/tauri.duo-$l.conf.json" ${1+"$@"} >"$DUO_DIR/$l.log" 2>&1 &
  fi
  TAURI_PIDS+=("$!")
done

LOG_LIST=""
for x in "${INSTANCES[@]}"; do LOG_LIST="$LOG_LIST$(lower "$x").log,"; done
LOG_LIST="${LOG_LIST%,}"

echo ""
echo "${#INSTANCES[@]} window(s) coming up: ${INSTANCES[*]}."
echo "  Each is an isolated user profile:"
for x in "${INSTANCES[@]}"; do
  printf '    %-2s vite :%s  e2e :%s  data %s\n' "$x" "$(vite_port "$x")" "$(e2e_port "$x")" "$DUO_DIR/session-$(lower "$x")"
done
echo "  1. Server URL is prefilled to $SYNC_URL in all (changeable in Settings -> Account)."
echo "     Use a localhost URL, not 127.0.0.1: the webview CSP only allows http://localhost:*."
echo "  2. Sign each window in with a DIFFERENT account to simulate separate users;"
echo "     all windows on the same account appear as multiple devices."
echo "     (Beaver-Sync has 'yarn seed:tier' for test tiers.)"
echo "  3. Set sync transport to Cloud in each; the workspace presence strip and"
echo "     sharing flows operate across users. E2E bridge: POST http://127.0.0.1:<e2e>/eval."
echo "Logs: $DUO_DIR/{$LOG_LIST}  Ctrl-C stops everything."
echo ""
wait
