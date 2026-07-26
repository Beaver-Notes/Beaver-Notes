# Tiptap Collaboration Features — Design Spec

> **Date:** 2026-07-26
> **Status:** Approved
> **Branch:** feat-beaver-sync

## Overview

Add real-time collaboration features to Beaver-Notes' Tiptap editor: awareness forwarding, multi-cursor highlights, collaborative comments, online users panel, and move the title into Yjs for conflict-free editing.

## Context

The codebase already has:
- Tiptap v3 with 30+ extensions (`src/lib/tiptap/index.js`)
- `@tiptap/extension-collaboration` 3.22.5 (binds editor to Y.Doc)
- Yjs per-note Y.Docs (`useNoteYjs.js`)
- Hocuspocus sync over raw WebSocket (`useHocuspocusSync.js`)
- `usePresence()` composable (local awareness, not synced)
- `@sereneinserenade/tiptap-comment-extension` (already installed)

**Problem:** Awareness messages aren't forwarded through the WebSocket, so presence is local-only. Title is a plain textarea (not in Yjs), causing conflicts. No multi-cursor or comments.

---

## Feature 1: Awareness Forwarding

**Goal:** Sync awareness state (cursors, user info) across clients via the Hocuspocus WebSocket.

**Approach:**
- Add `setAwareness(awareness)` method to `useHocuspocusSync.js`
- On room join, listen for awareness changes and broadcast them as WebSocket messages
- On incoming awareness messages, apply them to the local `Awareness` instance
- Yjs awareness protocol: message type `2` with sub-types `0` (sync), `1` (update)

**Files:**
- `src/composable/useHocuspocusSync.js` — add awareness handling
- `src/composable/useNoteYjs.js` — pass awareness to sync composable

**Protocol:**
```
Client → Server: [2, 0, encodedAwareness]  (sync step)
Client → Server: [2, 1, encodedAwareness]  (update)
Server → Client: [2, 0, encodedAwareness]  (sync step)
Server → Client: [2, 1, encodedAwareness]  (update)
```

---

## Feature 2: Multi-Cursor Highlights

**Goal:** Show other users' cursor positions as colored carets with name labels.

**Approach:**
- Add `@tiptap/extension-collaboration-cursor` to the Tiptap extension list
- Configure with the Y.Doc's awareness instance and local user info (name, color)
- The extension reads awareness state and renders colored cursors automatically

**Files:**
- `package.json` — add `@tiptap/extension-collaboration-cursor`
- `src/components/note/NoteEditor.vue` — add CollaborationCursor extension

**Configuration:**
```javascript
CollaborationCursor.configure({
  document: ydoc,
  user: {
    name: accountStore.profile?.username || 'Anonymous',
    color: presence.localColor.value,
  },
})
```

---

## Feature 3: Collaborative Comments

**Goal:** Inline comments that sync across clients via Yjs.

**Approach:**
- Use the existing `@sereneinserenade/tiptap-comment-extension` for Tiptap decoration
- Store comment threads in a Yjs `Y.Map` (`doc.getMap('comments')`) for sync
- Each thread has: `id`, `content`, `author`, `createdAt`, `resolved`
- Build a `CommentSidebar.vue` to display and manage threads
- Comments are rendered as highlighted text in the editor

**Files:**
- `src/components/note/CommentSidebar.vue` — NEW: comment panel
- `src/lib/tiptap/index.js` — add Comment extension
- `src/composable/useNoteYjs.js` — expose comments map

**Data Model (Y.Map per thread):**
```javascript
{
  id: string,
  content: string,
  authorId: string,
  authorName: string,
  createdAt: number,
  resolved: boolean,
}
```

---

## Feature 4: Online Users Panel

**Goal:** Show who's online with their role and current activity.

**Approach:**
- Read from `usePresence()` composable's `peers` Map
- Render a collapsible panel in the note page
- Show user avatar (initials), name, role, and activity status

**Files:**
- `src/components/OnlineUsersPanel.vue` — NEW: users panel
- `src/pages/note/_id.vue` — add panel toggle

---

## Feature 5: Title in Yjs

**Goal:** Move the note title from a plain textarea into the Y.Doc for collaborative editing.

**Approach:**
- Store title as a Y.XmlFragment named `'title'` in the Y.Doc
- Render title using a second Tiptap editor instance (minimal extensions: just Text)
- Update `useNoteYjs.js` to handle title loading/persistence
- Update `NoteEditor.vue` to accept and render title via Yjs

**Files:**
- `src/composable/useNoteYjs.js` — add title handling
- `src/components/note/NoteEditor.vue` — add title editor
- `src/pages/note/_id.vue` — replace textarea with Yjs title editor

**Migration:** Existing notes store title in Pinia. On first load, seed the Y.Doc's title fragment from the store, then persist via Yjs.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Note Page                   │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │ Title    │  │ Editor   │  │ Sidebar   │ │
│  │ (Yjs)   │  │ (Yjs)    │  │ (Comments)│ │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘ │
│       │              │              │        │
│       └──────────────┼──────────────┘        │
│                      │                       │
│              ┌───────┴───────┐               │
│              │   Y.Doc       │               │
│              │  - title      │               │
│              │  - content    │               │
│              │  - comments   │               │
│              └───────┬───────┘               │
│                      │                       │
│              ┌───────┴───────┐               │
│              │  Awareness    │               │
│              │  - user       │               │
│              │  - cursor     │               │
│              └───────┬───────┘               │
│                      │                       │
│         ┌────────────┴────────────┐          │
│         │  useHocuspocusSync      │          │
│         │  - sync messages (0,1,2)│          │
│         │  - awareness messages   │          │
│         │  - encryption (opt-in)  │          │
│         └────────────┬────────────┘          │
│                      │                       │
└──────────────────────┼───────────────────────┘
                       │ WebSocket
                       ▼
              ┌─────────────────┐
              │   Hocuspocus    │
              │   Server        │
              └─────────────────┘
```

---

## Constraints

- No new npm dependencies (collaboration-cursor is free, comment extension already installed)
- No TypeScript for new files
- Backward compatible: works without encryption keys
- Lint must pass after each task
