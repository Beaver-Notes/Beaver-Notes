import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = process.cwd();
const isWindows = process.platform === 'win32';
const tauriBin = join(
  rootDir,
  'node_modules',
  '.bin',
  isWindows ? 'tauri.cmd' : 'tauri',
);

if (!existsSync(tauriBin)) {
  console.error(`Unable to find the local Tauri CLI at ${tauriBin}.`);
  process.exit(1);
}

const signalExitCodes = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};

let shutdownSignal = null;
let shutdownStarted = false;
let sigtermTimer = null;
let sigkillTimer = null;

const child = spawn(tauriBin, ['dev'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env,
  detached: !isWindows,
});

function clearShutdownTimers() {
  if (sigtermTimer) {
    clearTimeout(sigtermTimer);
    sigtermTimer = null;
  }

  if (sigkillTimer) {
    clearTimeout(sigkillTimer);
    sigkillTimer = null;
  }
}

function killTree(signal) {
  if (!child.pid) {
    return;
  }

  if (isWindows) {
    const args = ['/pid', String(child.pid), '/T'];
    if (signal === 'SIGKILL') {
      args.push('/F');
    }

    spawn('taskkill', args, { stdio: 'ignore' });
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
  }
}

function beginShutdown(signal = 'SIGTERM') {
  shutdownSignal ||= signal;

  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  killTree(signal);

  sigtermTimer = setTimeout(() => {
    killTree('SIGTERM');
  }, 3000);

  sigkillTimer = setTimeout(() => {
    killTree('SIGKILL');
  }, 8000);
}

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
  process.on(signal, () => {
    beginShutdown(signal);
  });
});

process.on('uncaughtException', (error) => {
  beginShutdown('SIGTERM');
  throw error;
});

process.on('unhandledRejection', (error) => {
  beginShutdown('SIGTERM');
  throw error;
});

child.on('exit', (code, signal) => {
  clearShutdownTimers();

  if (shutdownSignal) {
    process.exit(signalExitCodes[shutdownSignal] || 1);
  }

  if (code !== null) {
    process.exit(code);
  }

  process.exit(signalExitCodes[shutdownSignal] || signalExitCodes[signal] || 1);
});

child.on('error', (error) => {
  clearShutdownTimers();
  console.error(error);
  process.exit(1);
});
