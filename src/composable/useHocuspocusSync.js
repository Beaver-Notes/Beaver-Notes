import * as syncProtocol from 'y-protocols/sync'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { useAccountStore } from '@/store/account'
import { useWorkspaceStore } from '@/store/workspace'
import { getWorkspaceDoc } from './meta-yjs-doc.js'
import { registerActiveDoc } from './useNoteYjs.js'

const HEARTBEAT_INTERVAL_MS = 25000
const RECONNECT_DELAY_MS = 3000
const MAX_RECONNECT_DELAY_MS = 30000

function buildRoomName(workspaceId, noteId) {
  return `workspace:${workspaceId}:note:${noteId}`
}

function buildMetaRoomName(workspaceId) {
  return `workspace:${workspaceId}:meta`
}

export function useHocuspocusSync() {
  const accountStore = useAccountStore()
  const workspaceStore = useWorkspaceStore()

  let ws = null
  let heartbeatTimer = null
  let reconnectTimeout = null
  let reconnectDelay = RECONNECT_DELAY_MS
  let connected = false

  const activeRooms = new Map()
  const pendingQueue = []

  function getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const hocuspocusHost =
      import.meta.env.VITE_HOCUSPOCUS_URL || window.location.host
    return `${protocol}//${hocuspocusHost}/hocuspocus`
  }

  function isAuthenticated() {
    return (
      accountStore.status === 'authenticated' && !!accountStore.token
    )
  }

  function getActiveWorkspaceId() {
    return workspaceStore.activeId
  }

  function sendBinary(buffer) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pendingQueue.push(buffer)
      return
    }
    pendingQueue.push(buffer)
    flushPending()
  }

  function flushPending() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    while (pendingQueue.length > 0) {
      const buf = pendingQueue.shift()
      try {
        ws.send(buf)
      } catch {
        pendingQueue.unshift(buf)
        break
      }
    }
  }

  function sendStateless(json) {
    const payload = new TextEncoder().encode(json)
    const buf = new Uint8Array(payload.length)
    buf.set(payload)
    sendBinary(buf.buffer)
  }

  function handleServerMessage(buffer) {
    const data =
      buffer instanceof Uint8Array
        ? buffer
        : new Uint8Array(buffer)

    if (data.length === 0) return

    const msg = decoding.createDecoder(data)

    while (decoding.hasContent(msg)) {
      const messageType = decoding.readVarUint(msg)

      switch (messageType) {
        case 0: {
          for (const [, room] of activeRooms) {
            if (!room.doc) continue
            try {
              syncProtocol.readSyncStep1(msg, room.doc, 'hocuspocus')
            } catch (err) {
              console.warn(
                '[hocuspocus] Failed to apply sync step 1:',
                err.message,
              )
            }
          }
          break
        }
        case 1: {
          for (const [, room] of activeRooms) {
            if (!room.doc) continue
            try {
              syncProtocol.readSyncStep2(msg, room.doc, 'hocuspocus')
            } catch (err) {
              console.warn(
                '[hocuspocus] Failed to apply sync step 2:',
                err.message,
              )
            }
          }
          break
        }
        case 2: {
          for (const [, room] of activeRooms) {
            if (!room.doc) continue
            try {
              syncProtocol.readUpdate(
                msg,
                room.doc,
                'hocuspocus',
              )
            } catch (err) {
              console.warn(
                '[hocuspocus] Failed to apply update:',
                err.message,
              )
            }
          }
          break
        }
        case 3: {
          const jsonStr = decoding.readVarString(msg)
          handleStatelessMessage(jsonStr)
          break
        }
        default:
          console.warn(
            `[hocuspocus] Unknown message type: ${messageType}`,
          )
      }
    }
  }

  function handleStatelessMessage(jsonStr) {
    try {
      const msg = JSON.parse(jsonStr)
      if (msg.type === 'auth') {
        for (const [, room] of activeRooms) {
          room.readOnly = msg.readOnly === true
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  function broadcastUpdate(update, origin) {
    if (
      origin === 'hocuspocus' ||
      origin === 'load' ||
      origin === 'sync'
    )
      return

    const encoder = encoding.createEncoder()
    syncProtocol.writeUpdate(encoder, update)
    sendBinary(encoding.toUint8Array(encoder).buffer)
  }

  function joinNoteRoom(noteId, doc) {
    const workspaceId = getActiveWorkspaceId()
    if (!workspaceId) return

    const roomName = buildRoomName(workspaceId, noteId)
    if (activeRooms.has(roomName)) return

    activeRooms.set(roomName, { doc, readOnly: false })
    registerActiveDoc(noteId, doc)

    doc.on('update', (update, origin) => {
      broadcastUpdate(update, origin)
    })

    if (connected && doc) {
      const encoder = encoding.createEncoder()
      syncProtocol.writeSyncStep1(encoder, doc)
      sendBinary(encoding.toUint8Array(encoder).buffer)
    }
  }

  function joinMetaRoom(workspaceId) {
    const roomName = buildMetaRoomName(workspaceId)
    if (activeRooms.has(roomName)) return

    const doc = getWorkspaceDoc()
    activeRooms.set(roomName, { doc, readOnly: false })

    doc.on('update', (update, origin) => {
      broadcastUpdate(update, origin)
    })

    if (connected && doc) {
      const encoder = encoding.createEncoder()
      syncProtocol.writeSyncStep1(encoder, doc)
      sendBinary(encoding.toUint8Array(encoder).buffer)
    }
  }

  function connect() {
    if (ws) return
    if (!isAuthenticated()) return

    const url = getWebSocketUrl()
    ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      connected = true
      reconnectDelay = RECONNECT_DELAY_MS
      console.warn('[hocuspocus] Connected')

      heartbeatTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          sendStateless(JSON.stringify({ type: 'ping' }))
        }
      }, HEARTBEAT_INTERVAL_MS)

      for (const [, room] of activeRooms) {
        if (room.doc) {
          const encoder = encoding.createEncoder()
          syncProtocol.writeSyncStep1(encoder, room.doc)
          sendBinary(encoding.toUint8Array(encoder).buffer)
        }
      }

      flushPending()
    }

    ws.onmessage = (event) => {
      handleServerMessage(event.data)
    }

    ws.onclose = () => {
      connected = false
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }

      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      reconnectTimeout = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
        connect()
      }, reconnectDelay)
    }

    ws.onerror = () => {
      // onclose fires after onerror, reconnect logic is in onclose
    }
  }

  function disconnect() {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (ws) {
      ws.onclose = null
      ws.onmessage = null
      ws.onerror = null
      ws.onopen = null
      ws.close()
      ws = null
    }
    connected = false
    activeRooms.clear()
    pendingQueue.length = 0
  }

  function start() {
    if (!isAuthenticated()) return
    connect()
  }

  function handleWorkspaceSwitch(workspaceId) {
    for (const [roomName] of activeRooms) {
      if (roomName.startsWith('workspace:')) {
        activeRooms.delete(roomName)
      }
    }

    if (connected) {
      joinMetaRoom(workspaceId)
    }
  }

  function handleNoteSwitch(noteId, doc) {
    for (const [roomName] of activeRooms) {
      if (roomName.endsWith(`:note:${noteId}`)) return
    }

    const workspaceId = getActiveWorkspaceId()
    if (!workspaceId) return

    const roomName = buildRoomName(workspaceId, noteId)
    activeRooms.set(roomName, { doc, readOnly: false })

    doc.on('update', (update, origin) => {
      broadcastUpdate(update, origin)
    })

    if (connected && doc) {
      const encoder = encoding.createEncoder()
      syncProtocol.writeSyncStep1(encoder, doc)
      sendBinary(encoding.toUint8Array(encoder).buffer)
    }
  }

  return {
    start,
    stop: disconnect,
    connect,
    disconnect,
    joinNoteRoom,
    joinMetaRoom,
    handleWorkspaceSwitch,
    handleNoteSwitch,
    get connected() {
      return connected
    },
  }
}

let hocuspocusInstance = null

export function getHocuspocusSync() {
  if (!hocuspocusInstance) {
    hocuspocusInstance = useHocuspocusSync()
  }
  return hocuspocusInstance
}