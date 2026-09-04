import { spawn } from 'node:child_process';
import net from 'node:net';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = process.cwd();

// Save terminal TMPDIR for Xcode script: Xcode overrides TMPDIR, causing mismatch.
if (process.env.TMPDIR) {
  writeFileSync(join(rootDir, 'src-tauri', '.tmpdir'), process.env.TMPDIR);
}
const isWindows = process.platform === 'win32';
const viteBin = join(
  rootDir,
  'node_modules',
  '.bin',
  isWindows ? 'vite.cmd' : 'vite'
);

if (!existsSync(viteBin)) {
  console.error(`Unable to find the local Vite CLI at ${viteBin}.`);
  process.exit(1);
}

const DEV_PORT = Number(process.env.TAURI_DEV_PORT || 5173);
const candidateHosts = [
  process.env.TAURI_DEV_HOST,
  '127.0.0.1',
  'localhost',
].filter(Boolean);

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });

    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });

    socket.once('error', () => {
      resolve(false);
    });
  });
}

async function findReachableHost() {
  for (const host of candidateHosts) {
    if (await isPortOpen(DEV_PORT, host)) {
      return host;
    }
  }

  return null;
}

let child = null;
let shuttingDown = false;

function shutdown(code = 0) {
  shuttingDown = true;
  if (child?.pid) {
    child.kill('SIGTERM');
  }
  process.exit(code);
}

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => shutdown(0));
});
// Ignore SIGHUP so terminal close keeps vite alive.
process.on('SIGHUP', () => {
  console.log('[tauri-dev-server] ignoring SIGHUP, keeping vite alive');
});

const reachableHost = await findReachableHost();

if (reachableHost) {
  console.log(
    `[tauri-dev-server] Reusing existing dev server on ${reachableHost}:${DEV_PORT}.`
  );

  // Keep alive for Tauri dev session.
  await new Promise(() => {});
}

function startVite() {
  child = spawn(viteBin, ['--config', 'vite.config.js'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    shell: isWindows,
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      process.exit(code ?? 0);
      return;
    }
    if (signal) {
      console.warn(`[tauri-dev-server] vite exited on ${signal}, restarting in 1s…`);
    } else {
      console.warn(`[tauri-dev-server] vite exited with ${code}, restarting in 1s…`);
    }
    setTimeout(startVite, 1000);
  });

  child.on('error', (error) => {
    console.error(error);
    if (shuttingDown) process.exit(1);
    console.warn('[tauri-dev-server] vite error, restarting in 1s…');
    setTimeout(startVite, 1000);
  });
}

startVite();
