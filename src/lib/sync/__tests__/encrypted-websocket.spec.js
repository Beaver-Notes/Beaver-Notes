import { describe, it, expect, vi, afterEach } from 'vitest';
import { importCollabKey } from '@/utils/crypto/collab.js';
import {
  createEncryptedWebSocket,
  encryptFrame,
  decryptFrame,
  isEncryptedFrame,
} from '@/lib/sync/encrypted-websocket.js';

const ROOM = 'workspace:ws1:note:note-1';
const KEY_HEX = 'ab'.repeat(32);
const SYNC = 0;
const AWARENESS = 1;
const OPEN = 1;

function containsBytes(haystack, needle) {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

// Minimal WebSocket stand-in. It must be installed on globalThis BEFORE
// `createEncryptedWebSocket` is called: the returned class extends whatever
// `WebSocket` resolves to at that moment.
function installFakeWebSocket({ failFirst = false } = {}) {
  const sent = [];
  let failures = failFirst ? 1 : 0;
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = OPEN;
    }
    addEventListener() {}
    removeEventListener() {}
    close() {
      this.readyState = 3;
    }
    send(data) {
      if (failures > 0) {
        failures -= 1;
        throw new Error('socket closing');
      }
      sent.push(data);
    }
  }
  vi.stubGlobal('WebSocket', FakeWebSocket);
  return { sent };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('collab relay frame encryption', () => {
  it('round-trips a binary frame and marks it encrypted', async () => {
    const key = await importCollabKey(KEY_HEX);
    const frame = new Uint8Array([0, 1, 2, 3, 4, 5]);

    const encrypted = await encryptFrame(key, frame, ROOM);
    expect(isEncryptedFrame(encrypted)).toBe(true);
    expect(Array.from(encrypted.subarray(0, 2))).toEqual([0xe7, 0x11]);
    expect(encrypted.byteLength).toBeGreaterThan(frame.byteLength);

    const decrypted = await decryptFrame(key, encrypted, ROOM);
    expect(Array.from(decrypted)).toEqual(Array.from(frame));
  });

  it('does not mark a plaintext frame as encrypted', () => {
    expect(isEncryptedFrame(new Uint8Array([0, 1, 2]))).toBe(false);
    expect(isEncryptedFrame(new Uint8Array([]))).toBe(false);
  });

  it('fails closed when decrypted with the wrong room (AAD) key', async () => {
    const key = await importCollabKey(KEY_HEX);
    const encrypted = await encryptFrame(key, new Uint8Array([0, 1]), ROOM);
    await expect(
      decryptFrame(key, encrypted, 'workspace:ws1:note:note-2'),
    ).rejects.toBeTruthy();
  });
});

describe('encrypted relay websocket send path', () => {
  it('keeps the ordered chain usable after one frame fails (L2)', async () => {
    const key = await importCollabKey(KEY_HEX);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = installFakeWebSocket({ failFirst: true });

    const WS = createEncryptedWebSocket(ROOM, () => key);
    const ws = new WS('ws://test');

    ws.send(new Uint8Array([SYNC, 1, 1]));
    // Before the fix this rejects and poisons the chain.
    await ws._beaverSendChain;
    ws.send(new Uint8Array([SYNC, 2, 2]));
    await ws._beaverSendChain;

    expect(fake.sent).toHaveLength(1);
    expect(Array.from(await decryptFrame(key, fake.sent[0], ROOM))).toEqual([SYNC, 2, 2]);
    expect(errSpy).toHaveBeenCalled();
  });

  it('queues pre-key frames and flushes them in order without delaying the chain (L11)', async () => {
    const key = await importCollabKey(KEY_HEX);
    vi.useFakeTimers();
    const fake = installFakeWebSocket();
    let currentKey;

    const WS = createEncryptedWebSocket(ROOM, () => currentKey);
    const ws = new WS('ws://test');

    ws.send(new Uint8Array([SYNC, 1]));
    ws.send(new Uint8Array([SYNC, 2]));

    let chainSettled = false;
    ws._beaverSendChain.then(() => {
      chainSettled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    // The chain must resolve even though the key is still missing.
    expect(chainSettled).toBe(true);
    expect(fake.sent).toHaveLength(0);

    currentKey = key;
    await vi.advanceTimersByTimeAsync(100);
    await ws._beaverSendChain;

    expect(fake.sent).toHaveLength(2);
    expect(Array.from(await decryptFrame(key, fake.sent[0], ROOM))).toEqual([SYNC, 1]);
    expect(Array.from(await decryptFrame(key, fake.sent[1], ROOM))).toEqual([SYNC, 2]);
  });

  it('fails closed when the key never arrives (L11)', async () => {
    vi.useFakeTimers();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = installFakeWebSocket();

    const WS = createEncryptedWebSocket(ROOM, () => undefined);
    const ws = new WS('ws://test');
    ws.send(new Uint8Array([SYNC, 1]));
    ws.send(new Uint8Array([SYNC, 2]));

    await vi.advanceTimersByTimeAsync(6000);
    await ws._beaverSendChain;

    expect(fake.sent).toHaveLength(0);
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('encrypted relay websocket awareness path', () => {
  it('encrypts outgoing awareness frames so names and offsets never hit the wire', async () => {
    const key = await importCollabKey(KEY_HEX);
    const fake = installFakeWebSocket();

    const WS = createEncryptedWebSocket(ROOM, () => key);
    const ws = new WS('ws://test');

    // A y-protocols awareness update: message type 1 + payload. The payload
    // here stands in for the display name / cursor offsets the relay must not
    // read. On the wire this frame must be ciphertext, not [1, ...plaintext].
    const name = new TextEncoder().encode('secret-peer-name');
    const frame = new Uint8Array(1 + name.length);
    frame[0] = AWARENESS;
    frame.set(name, 1);

    ws.send(frame);
    await ws._beaverSendChain;

    expect(fake.sent).toHaveLength(1);
    const wire = fake.sent[0];
    expect(isEncryptedFrame(wire)).toBe(true);
    expect(containsBytes(wire, name)).toBe(false);
    expect(Array.from(await decryptFrame(key, wire, ROOM))).toEqual(Array.from(frame));
  });

  it('decrypts inbound encrypted awareness frames and delivers them to onmessage', async () => {
    const key = await importCollabKey(KEY_HEX);
    installFakeWebSocket();

    const WS = createEncryptedWebSocket(ROOM, () => key);
    const ws = new WS('ws://test');
    const received = [];
    ws.onmessage = (event) => received.push(new Uint8Array(event.data));

    const frame = new Uint8Array([AWARENESS, 9, 8, 7]);
    const wire = await encryptFrame(key, frame, ROOM);
    ws._beaverReceive({ data: wire.buffer });
    await ws._beaverRecvChain;

    expect(received).toHaveLength(1);
    expect(Array.from(received[0])).toEqual([AWARENESS, 9, 8, 7]);
  });

  it('fails closed on an inbound awareness frame bound to another room', async () => {
    const key = await importCollabKey(KEY_HEX);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installFakeWebSocket();

    const WS = createEncryptedWebSocket(ROOM, () => key);
    const ws = new WS('ws://test');
    let delivered = 0;
    ws.onmessage = () => { delivered += 1; };

    const wire = await encryptFrame(key, new Uint8Array([AWARENESS, 1]), 'workspace:ws1:note:other');
    ws._beaverReceive({ data: wire.buffer });
    await ws._beaverRecvChain;

    expect(delivered).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });
});
