import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

const ROOT = import.meta.dirname;
const DEBUG_BINARY = resolve(ROOT, 'src-tauri', 'target', 'debug', 'beaver-notes');
const TauriWd = resolve(process.env.HOME, '.cargo', 'bin', 'tauri-wd');
const VITE_BIN = resolve(ROOT, 'node_modules', '.bin', 'vite');

const WD_PORT = 4444;
const VITE_PORT = 5173;

let tauriWdProcess = null;
let viteProcess = null;

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    socket.once('connect', () => { socket.end(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

function waitForPort(port, { timeout = 30000, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const check = async () => {
      if (Date.now() > deadline) return reject(new Error(`Port ${port} not open after ${timeout}ms`));
      if (await isPortOpen(port, host)) return resolve();
      setTimeout(check, 500);
    };
    check();
  });
}

function spawnProcess(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      ...opts,
    });
    proc.on('error', reject);
    resolve(proc);
  });
}

async function ensureDevServer() {
  if (await isPortOpen(VITE_PORT)) {
    console.log(`  [setup] Vite dev server already running on :${VITE_PORT}`);
    return null;
  }

  console.log(`  [setup] Starting Vite dev server on :${VITE_PORT}...`);
  const proc = await spawnProcess(VITE_BIN, ['--config', 'vite.config.js'], {
    cwd: ROOT,
  });
  proc.stdout.on('data', (d) => process.stdout.write(d));
  proc.stderr.on('data', (d) => process.stderr.write(d));

  await waitForPort(VITE_PORT, { timeout: 30000 });
  console.log(`  [setup] Vite dev server ready`);
  return proc;
}

async function startTauriWd() {
  if (await isPortOpen(WD_PORT)) {
    console.log(`  [setup] tauri-wd already running on :${WD_PORT}`);
    return null;
  }

  console.log(`  [setup] Starting tauri-wd on :${WD_PORT}...`);
  const proc = await spawnProcess(TauriWd, ['--port', String(WD_PORT), '--max-sessions', '1']);
  proc.stdout.on('data', (d) => {
    const msg = d.toString();
    if (msg.includes('[webdriver]')) process.stdout.write(msg);
  });
  proc.stderr.on('data', (d) => process.stderr.write(d));

  await waitForPort(WD_PORT, { timeout: 30000 });
  console.log(`  [setup] tauri-wd ready on :${WD_PORT}`);
  return proc;
}

export const config = {
  runner: 'local',
  port: WD_PORT,
  hostname: '127.0.0.1',

  specs: ['./tests/e2e/**/*.spec.js'],

  maxInstances: 1,

  capabilities: [
    {
      'tauri:options': {
        binary: DEBUG_BINARY,
        args: [],
        windowActivationDelay: 1000,
      },
    },
  ],

  logLevel: 'warn',
  bail: 0,

  waitforTimeout: 30000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 5,

  services: [],

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  reporters: ['spec'],

  onPrepare: async function () {
    console.log(`\n  Beaver Notes E2E Test Suite`);
    console.log(`  Binary: ${DEBUG_BINARY}\n`);

    viteProcess = await ensureDevServer();
    tauriWdProcess = await startTauriWd();
  },

  onComplete: function () {
    if (tauriWdProcess) {
      console.log('\n  [cleanup] Stopping tauri-wd...');
      tauriWdProcess.kill('SIGTERM');
    }
    if (viteProcess) {
      console.log('  [cleanup] Stopping Vite dev server...');
      viteProcess.kill('SIGTERM');
    }
  },

  afterTest: async function (test, context, result) {
    if (result && result.error) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const title = typeof test.fullTitle === 'function' ? test.fullTitle() : (test.fullTitle || test.title || 'unknown');
      const name = title.replace(/\s+/g, '-').toLowerCase();
      try {
        await browser.saveScreenshot(
          resolve(ROOT, 'screenshots', `${name}-${timestamp}.png`)
        );
      } catch {
        // screenshot may fail if session is already dead
      }
    }
  },
};
