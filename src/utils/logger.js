import { invoke } from '@tauri-apps/api/core';

// Forwards every log line to the Rust log bridge (`beaver.log`) in batches.
// Console output is unchanged; the file bridge is best-effort and never throws.
const shipBuffer = [];
let shipTimer = null;
let shipAlive = true;

function serialize(arg) {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || String(arg);
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

async function flushShipBuffer() {
  shipTimer = null;
  if (!shipBuffer.length || !shipAlive) return;
  const lines = shipBuffer.splice(0, shipBuffer.length);
  try {
    await invoke('push_js_logs', { lines });
  } catch {
    // Backend unavailable (browser dev, tests): console only from here on.
    shipAlive = false;
  }
}

function ship(level, args) {
  if (!shipAlive) return;
  const text = args.map(serialize).join(' ');
  shipBuffer.push(`[${new Date().toISOString()}] [js] [${level}] ${text}`);
  if (level === 'warn' || level === 'error' || shipBuffer.length >= 200) {
    if (shipTimer) {
      clearTimeout(shipTimer);
      shipTimer = null;
    }
    flushShipBuffer().catch(() => {});
  } else if (!shipTimer) {
    shipTimer = setTimeout(() => flushShipBuffer().catch(() => {}), 2000);
  }
}

function makeMethod(level) {
  return (...args) => {
    // Dynamic lookup so console spies installed after import still observe.
    // eslint-disable-next-line no-console
    console[level](...args);
    ship(level, args);
  };
}

export const logger = {
  // eslint-disable-next-line no-console
  debug: makeMethod('debug'),
  // eslint-disable-next-line no-console
  info: makeMethod('info'),
  // eslint-disable-next-line no-console
  warn: makeMethod('warn'),
  // eslint-disable-next-line no-console
  error: makeMethod('error'),
};
