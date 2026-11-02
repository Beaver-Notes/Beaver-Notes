// End-to-end encryption for the realtime collaboration relay.
//
// y-websocket sends `[varuint messageType][payload]` binary frames. The relay
// authenticates the connection and forwards those frames between peers without
// being able to read them: it holds no room key, so it cannot decrypt. The
// payload is encrypted end-to-end and decrypted by the peer holding the same
// per-room key. Both Yjs sync frames and awareness (presence) frames are
// encrypted: awareness carries display names and cursor/selection offsets,
// which the relay must not read either. Durable storage is the HTTPS push and
// pull path, not the relay, so nothing is lost if a realtime frame is dropped.
//
// Layout of an encrypted frame:
//   MAGIC(2) || IV(12) || AES-256-GCM(frame)
// MAGIC marks the frame as encrypted. Inbound binary frames WITHOUT the prefix
// are dropped, not passed through: the relay itself refuses them (ws-relay
// `warnUnknownFrame`), so a plaintext binary frame on this socket can only be
// a downgrade attempt by the relay's operator or a ws:// MITM — accepting it
// would let them inject Yjs updates and forge presence into an E2E room. Text
// frames stay in the clear: they carry JSON notifications and the relay's
// per-frame sender declaration, no note content.

import { encryptUpdate, decryptUpdate } from '@/utils/crypto/collab.js';

const MAGIC = [0xe7, 0x11];
const SYNC_MESSAGE = 0;
const AWARENESS_MESSAGE = 1;
const OPEN = 1;

// Aligned with the relay's 2 MiB maxPayload (Beaver-Sync ws-relay.js
// WS_RELAY_MAX_PAYLOAD_BYTES). The relay terminates oversized frames itself,
// but a ws:// MITM bypasses it: cap before decrypt so an inbound flood cannot
// grow unbounded through crypto.subtle.decrypt + Y.applyUpdate.
const MAX_RELAY_FRAME_BYTES = 2 * 1024 * 1024;
// Rate-limit drop warnings so a flood cannot flood the log either.
const WARN_INTERVAL_MS = 60_000;

export function isEncryptedFrame(bytes) {
  return bytes.length > MAGIC.length && bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1];
}

/** Encrypt a whole y-websocket frame; roomName binds the ciphertext (AAD). */
export async function encryptFrame(key, frame, roomName) {
  const cipher = await encryptUpdate(key, frame, roomName);
  const out = new Uint8Array(MAGIC.length + cipher.length);
  out[0] = MAGIC[0];
  out[1] = MAGIC[1];
  out.set(cipher, MAGIC.length);
  return out;
}

export async function decryptFrame(key, frame, roomName) {
  return decryptUpdate(key, frame.subarray(MAGIC.length), roomName);
}

function toBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

/**
 * WebSocket polyfill for one room. Sync and awareness frames are encrypted on
 * the way out and decrypted on the way in; text frames pass through. Sends and
 * receives are serialised through promise chains because WebCrypto is async and
 * the Yjs sync protocol (step1/step2/update) and awareness updates are
 * order-sensitive.
 *
 * @param {string} roomName
 * @param {() => CryptoKey | undefined} getKey
 */
export function createEncryptedWebSocket(roomName, getKey) {
  return class EncryptedWebSocket extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      this._beaverOnMessage = null;
      this._beaverSendChain = Promise.resolve();
      this._beaverRecvChain = Promise.resolve();
      // Frames that arrived before the room key existed. `null` means "not
      // buffering" (the normal path); an array means the ordered chain is
      // holding frames. Bounded by the 5s key wait, then failed closed.
      this._beaverQueuedFrames = null;
      this._beaverKeyWait = null;
      // The relay declares each relayed frame's sender ({ type: 'sender',
      // readOnly }) right before the binary frame. `null` = undeclared (old
      // relay or Redis-replicated fan-out): no gate, fail open.
      this._beaverSenderReadOnly = null;
      this._beaverLastWarn = 0;
      this._beaverDropped = 0;
      this.addEventListener('message', (event) => this._beaverReceive(event));
    }

    // y-websocket assigns `ws.onmessage`; store it instead of the native
    // accessor and dispatch from our own listener (which can decrypt).
    set onmessage(handler) {
      this._beaverOnMessage = handler;
    }

    get onmessage() {
      return this._beaverOnMessage;
    }

    send(data) {
      const bytes = toBytes(data);
      if (
        bytes &&
        bytes.length > 0 &&
        (bytes[0] === SYNC_MESSAGE || bytes[0] === AWARENESS_MESSAGE)
      ) {
        // One failed frame must never poison the chain (L2): the terminal
        // `.catch` reports the error and leaves `_beaverSendChain` resolved, so
        // later frames still go out.
        this._beaverSendChain = this._beaverSendChain
          .then(() => this._beaverEnqueue(bytes))
          .catch((err) => this._beaverReportSendError(err));
        return;
      }
      return super.send(data);
    }

    // Runs inside the ordered send chain but never awaits the room key: a slow
    // (or never-arriving) key therefore cannot delay every later frame (L11).
    // Frames that arrive before the key are appended to `_beaverQueuedFrames`
    // and flushed, in arrival order, as soon as the key lands.
    _beaverEnqueue(bytes) {
      if (this._beaverQueuedFrames) {
        this._beaverQueuedFrames.push(bytes);
        return;
      }
      const key = getKey();
      if (key) return this._beaverTransmit(key, bytes);
      this._beaverQueuedFrames = [bytes];
      this._beaverStartKeyWait();
    }

    // The key is provisioned just before/while the provider connects. Wait once
    // (off-chain) for it; on success flush the queue, on timeout fail closed.
    _beaverStartKeyWait() {
      if (this._beaverKeyWait) return;
      this._beaverKeyWait = this._beaverWaitForKey().then((key) => {
        this._beaverKeyWait = null;
        if (!key) {
          const dropped = this._beaverQueuedFrames || [];
          this._beaverQueuedFrames = null;
          console.error(
            `[ws-sync] dropping ${dropped.length} frame(s), no room key after 5s:`,
            roomName,
          );
          return;
        }
        this._beaverFlushQueued(key);
      });
    }

    // Flush behind everything already in the chain so ordering holds: frames
    // queued before the flush drain first, frames sent after it transmit
    // directly (the queue is cleared synchronously before draining).
    _beaverFlushQueued(key) {
      this._beaverSendChain = this._beaverSendChain
        .then(async () => {
          const queued = this._beaverQueuedFrames || [];
          this._beaverQueuedFrames = null;
          for (const bytes of queued) {
            try {
              await this._beaverTransmit(getKey() || key, bytes);
            } catch (err) {
              this._beaverReportSendError(err);
            }
          }
        })
        .catch((err) => this._beaverReportSendError(err));
    }

    async _beaverTransmit(key, bytes) {
      if (this.readyState !== OPEN) return;
      const encrypted = await encryptFrame(key, bytes, roomName);
      if (this.readyState !== OPEN) return;
      return super.send(encrypted);
    }

    // A dropped frame can desync peers/stale presence until the next reconnect,
    // but y-websocket's reconnect re-runs the full step1/step2 handshake (and
    // rebroadcasts awareness) and the CRDT converges. We deliberately drop +
    // report rather than close the socket: closing on a persistent crypto/key
    // error would thrash the provider's reconnect loop.
    _beaverReportSendError(err) {
      console.error('[ws-sync] relay frame send failed:', err?.message || err);
    }

    async _beaverWaitForKey() {
      for (let i = 0; i < 100; i++) {
        const key = getKey();
        if (key) return key;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return null;
    }

    // One warning per minute per socket: a flood of dropped frames must not
    // become a log flood.
    _beaverWarnRateLimited(message) {
      this._beaverDropped += 1;
      const now = Date.now();
      if (now - this._beaverLastWarn < WARN_INTERVAL_MS) return;
      this._beaverLastWarn = now;
      console.warn(`[ws-sync] ${message} (${this._beaverDropped} dropped in ${roomName})`);
    }

    // Track the relay's sender declaration so a declared read-only sender's
    // sync frames can be refused below (SC-1-03). The declaration precedes
    // exactly one binary frame on the same ordered socket.
    _beaverTrackSender(event) {
      if (typeof event.data !== 'string') return;
      try {
        const msg = JSON.parse(event.data);
        if (msg && msg.type === 'sender') {
          this._beaverSenderReadOnly = msg.readOnly === true;
        }
      } catch {
        // Not JSON (user notification, noise): nothing to track.
      }
    }

    _beaverReceive(event) {
      const handler = this._beaverOnMessage;
      this._beaverRecvChain = this._beaverRecvChain
        .then(async () => {
          if (typeof handler !== 'function') return;
          this._beaverTrackSender(event);
          const bytes = toBytes(event.data);
          if (!bytes) {
            // Text frame: JSON notifications and sender declarations, no note
            // content. Forwarded untouched.
            handler.call(this, event);
            return;
          }
          if (bytes.byteLength > MAX_RELAY_FRAME_BYTES) {
            this._beaverWarnRateLimited('dropping oversized relay frame (over the relay 2 MiB cap)');
            return;
          }
          if (!isEncryptedFrame(bytes)) {
            // Fail closed: current clients encrypt every binary frame, and the
            // relay refuses plaintext ones too, so a frame arriving without
            // MAGIC is a downgrade attempt (SC-1-01).
            this._beaverWarnRateLimited('dropping non-encrypted binary frame');
            return;
          }
          const key = getKey();
          if (!key) {
            console.warn('[ws-sync] dropping inbound frame, no room key:', roomName);
            return;
          }
          let payload;
          try {
            payload = await decryptFrame(key, bytes, roomName);
          } catch (err) {
            console.warn('[ws-sync] failed to decrypt frame:', err?.message || err);
            return;
          }
          // SC-1-03: a viewer holding a valid ticket can still emit sync
          // frames; the relay knows their role from the ticket and says so.
          // Awareness (presence) from a viewer stays allowed.
          const senderReadOnly = this._beaverSenderReadOnly;
          this._beaverSenderReadOnly = null;
          if (
            senderReadOnly === true &&
            payload.length > 0 &&
            payload[0] === SYNC_MESSAGE
          ) {
            this._beaverWarnRateLimited('dropping sync frame from a read-only participant');
            return;
          }
          handler.call(this, { data: payload.buffer, type: 'message' });
        })
        .catch((err) => {
          console.warn('[ws-sync] frame handling failed:', err?.message || err);
        });
    }
  };
}
