import { spawn } from 'node:child_process';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = process.cwd();
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

function shutdown(code = 0) {
  if (child?.pid) {
    child.kill('SIGTERM');
  }
  process.exit(code);
}

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
  process.on(signal, () => shutdown(0));
});

const reachableHost = await findReachableHost();

if (reachableHost) {
  console.log(
    `[tauri-dev-server] Reusing existing dev server on ${reachableHost}:${DEV_PORT}.`
  );

  // Keep this helper alive so Tauri can manage the dev session normally.
  await new Promise(() => {});
}

child = spawn(viteBin, ['--config', 'vite.config.js'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
