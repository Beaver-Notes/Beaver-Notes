import { listen } from '@tauri-apps/api/event';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { bindCloseHandlers, addCloseHandler } from '@/lib/tauri/close-handlers';
import {
  buildPath,
  dirnameSync,
  basenameSync,
  extnameSync,
  parseSync,
} from '@/lib/tauri/path';
import {
  isMobileRuntime,
  isPhoneRuntime,
  isIPadRuntime,
  isIOSRuntime,
  isMacOSRuntime,
  isAppleRuntime,
} from '@/lib/tauri/runtime';
import { invokeWithScopedSupport } from '@/lib/tauri/scoped-storage';

export const backend = {
  async invoke(channel, payload) {
    return invokeWithScopedSupport(channel, payload);
  },
  listen(channel, callback) {
    return listen(channel, (event) => callback(event, event.payload));
  },
  listenPayload(channel, callback) {
    return listen(channel, (event) => callback(event.payload));
  },
  isMobileRuntime() {
    return isMobileRuntime();
  },
  isPhoneRuntime() {
    return isPhoneRuntime();
  },
  isIPadRuntime() {
    return isIPadRuntime();
  },
  isIOSRuntime() {
    return isIOSRuntime();
  },
  isMacOSRuntime() {
    return isMacOSRuntime();
  },
  isAppleRuntime() {
    return isAppleRuntime();
  },
};

export const path = {
  join: (...args) => buildPath(...args),
  dirname: (target) => dirnameSync(target),
  basename: (target) => basenameSync(target),
  extname: (target) => extnameSync(target),
  parse: (target) => parseSync(target),
};

export const clipboard = {
  writeText: (text) => writeText(text),
  readText: () => readText(),
};

export function onFileOpened(callback) {
  return listen('file-opened', (event) => callback(event.payload));
}

bindCloseHandlers();

export { addCloseHandler };
