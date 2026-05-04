/**
 * Shared renderer crypto/encoding helpers.
 * Kept framework-agnostic so sync/app/note encryption paths can reuse one implementation.
 */

import {
  ALGO_AES_GCM,
  BASE64_CHUNK_SIZE,
  KEY_LENGTH_256,
  PBKDF2_ITERATIONS,
  WORKER_POOL_MAX,
} from '@/utils/crypto-constants.js';

export function hexToBuf(hex) {
  const clean = (hex || '').trim();
  const b = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    b[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return b;
}

export function bufToHex(buf) {
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function bufToBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

export function base64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Worker pool — parallelises concurrent crypto operations across cores.
// Capped to avoid overwhelming low-end devices.
const _POOL_SIZE = Math.min(
  WORKER_POOL_MAX,
  (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2
);
const _workers = [];
const _pendingRequests = new Map();
let _workerRoundRobin = 0;
let _cryptoWorkerRequestId = 0;

function _createWorker() {
  const w = new Worker(new URL('./crypto-worker.js', import.meta.url), {
    type: 'module',
  });
  w.addEventListener('message', ({ data }) => {
    const { requestId } = data;
    const pending = _pendingRequests.get(requestId);
    if (pending) {
      _pendingRequests.delete(requestId);
      if (data.ok) {
        pending.resolve(data);
      } else {
        pending.reject(new Error(data.error || 'Worker operation failed'));
      }
    }
  });
  w.addEventListener('error', (error) => {
    for (const [id, pending] of _pendingRequests.entries()) {
      _pendingRequests.delete(id);
      pending.reject(error);
    }
  });
  return w;
}

function _getWorker() {
  if (_workers.length === 0) {
    for (let i = 0; i < _POOL_SIZE; i++) {
      _workers.push(_createWorker());
    }
  }
  const w = _workers[_workerRoundRobin % _POOL_SIZE];
  _workerRoundRobin++;
  return w;
}

function _postToWorker(message) {
  const worker = _getWorker();
  const { requestId } = message;
  return new Promise((resolve, reject) => {
    _pendingRequests.set(requestId, { resolve, reject });
    worker.postMessage(message);
  });
}

export async function deriveAesGcmKeyFromPassphrase(
  passphrase,
  saltBuf,
  options = {}
) {
  const {
    iterations = PBKDF2_ITERATIONS,
    usages = ['encrypt', 'decrypt'],
    extractable = false,
  } = options;
  const saltHex = bufToHex(saltBuf);
  const requestId = ++_cryptoWorkerRequestId;

  const result = await _postToWorker({
    requestId,
    type: 'deriveKey',
    passphrase,
    saltHex,
    iterations,
  });

  return crypto.subtle.importKey(
    'raw',
    result.raw,
    { name: ALGO_AES_GCM, length: KEY_LENGTH_256 },
    extractable,
    usages
  );
}

/**
 * Encrypt a string using AES-GCM on a Web Worker (off-thread).
 * Returns { nonce: hex, cipher: base64 }.
 */
export async function encryptStringOnWorker(keyRaw, plaintext) {
  const requestId = ++_cryptoWorkerRequestId;
  const result = await _postToWorker({
    requestId,
    type: 'encrypt',
    keyRaw,
    plaintext,
  });
  return { nonce: result.nonce, cipher: result.cipher };
}

/**
 * Decrypt a string using AES-GCM on a Web Worker (off-thread).
 * Returns the plaintext string.
 */
export async function decryptStringOnWorker(keyRaw, nonceHex, cipherB64) {
  const requestId = ++_cryptoWorkerRequestId;
  const result = await _postToWorker({
    requestId,
    type: 'decrypt',
    keyRaw,
    nonceHex,
    cipherB64,
  });
  return result.plaintext;
}
