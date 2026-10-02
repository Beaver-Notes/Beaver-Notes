import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Collaboration from '@tiptap/extension-collaboration';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import LiveCollab, {
  liveCollabKey,
  LIVE_COLLAB_FADE_MS,
  LIVE_COLLAB_COALESCE_MS,
  LIVE_COLLAB_NEUTRAL_COLOR,
  isRemoteLiveOrigin,
} from '../index.js';
import {
  applyRemote,
  onRemoteApplied,
  registerActiveDoc,
  unregisterActiveDoc,
} from '@/lib/yjs/shared.js';
import { useChangeReview } from '@/composable/useChangeReview.js';

const editors = [];
// A provider-like object: any non-string, non-PluginKey origin is treated as a
// live websocket relay. Mirrors the y-websocket provider instance.
const REMOTE_ORIGIN = { kind: 'ws-provider' };

function makeEditor(ydoc, awareness) {
  const editor = new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      Collaboration.configure({ document: ydoc, field: 'content' }),
      LiveCollab.configure({ awareness }),
    ],
    enableCoreExtensions: { paste: false, textDirection: false },
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) {
    const ed = editors.pop();
    if (!ed.isDestroyed) ed.destroy();
  }
  unregisterActiveDoc('n1');
  vi.useRealTimers();
});

function makeAwareness() {
  const states = new Map();
  return {
    states,
    // Minimal Awareness surface the extension reads: clientID + getStates().
    awareness: { clientID: 1, getStates: () => states },
  };
}

function record(editor) {
  return liveCollabKey.getState(editor.state);
}

function addedText(rec, doc) {
  return rec.changes
    .map((c) => doc.textBetween(c.fromB, c.toB, ' '))
    .join('');
}

// y-prosemirror does not relay an editor's deletion of *another* client's
// content to the Y.Doc, so simulate the wire form of a remote deletion (a
// delete-set keyed by the deleted structs' authors) by removing the XML text
// directly on the peer doc.
function deleteAllText(doc) {
  const walk = (node) => {
    for (let i = 0; i < node.length; i++) {
      const child = node.get(i);
      if (typeof child?.delete === 'function') child.delete(0, child.length);
      else if (typeof child?.get === 'function') walk(child);
    }
  };
  walk(doc.getXmlFragment('content'));
}

function setup() {
  const ydoc = new Y.Doc();
  const { states, awareness } = makeAwareness();
  const editor = makeEditor(ydoc, awareness);
  editor.commands.setContent('<p>Hello</p>');

  // Peer doc starts from the editor's state so only the peer's own edits differ.
  const peerDoc = new Y.Doc();
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(ydoc));
  const peerEditor = makeEditor(peerDoc, null);

  states.set(peerDoc.clientID, {
    user: { id: 'peer-1', name: 'Alice', color: '#EF4444' },
  });

  // Edit the peer, then relay only the missing update to the editor under a
  // provider-like origin (this is the live websocket path).
  const pushPeer = (fn) => {
    fn(peerEditor);
    Y.applyUpdate(
      ydoc,
      Y.encodeStateAsUpdate(peerDoc, Y.encodeStateVector(ydoc)),
      REMOTE_ORIGIN
    );
  };
  // Variant that mutates the peer's Y.Doc directly (used for deletions).
  const pushPeerY = (fn) => {
    fn(peerDoc);
    Y.applyUpdate(
      ydoc,
      Y.encodeStateAsUpdate(peerDoc, Y.encodeStateVector(ydoc)),
      REMOTE_ORIGIN
    );
  };

  return { ydoc, editor, peerDoc, peerEditor, states, awareness, pushPeer, pushPeerY };
}

describe('origin classification', () => {
  it('treats a provider object as remote but strings and the sync key as local', () => {
    expect(isRemoteLiveOrigin(REMOTE_ORIGIN)).toBe(true);
    expect(isRemoteLiveOrigin('sync')).toBe(false);
    expect(isRemoteLiveOrigin('load')).toBe(false);
    expect(isRemoteLiveOrigin('ws-relay')).toBe(false);
    expect(isRemoteLiveOrigin(null)).toBe(false);
    expect(isRemoteLiveOrigin(undefined)).toBe(false);
    expect(isRemoteLiveOrigin(ySyncPluginKey)).toBe(false);
  });
});

describe('remote edit attribution', () => {
  it('highlights a remote edit in the author colour with a chip naming them', () => {
    const { editor, pushPeer } = setup();
    expect(record(editor)).toBeNull();

    pushPeer((ed) => ed.commands.insertContentAt(6, ' world'));

    const rec = record(editor);
    expect(rec).toBeTruthy();
    expect(rec.name).toBe('Alice');
    expect(rec.color).toBe('#EF4444');
    expect(addedText(rec, editor.state.doc)).toBe(' world');
    expect(editor.state.doc.textContent).toBe('Hello world');

    const chip = editor.view.dom.querySelector('.live-collab-chip');
    expect(chip?.textContent).toContain('Alice');
    expect(
      editor.view.dom.querySelector('.live-collab-chip__undo')
    ).toBeTruthy();
    expect(editor.view.dom.querySelector('.live-collab-added')).toBeTruthy();
    // Unlike review mode, live attribution never locks the editor.
    expect(editor.isEditable).toBe(true);
  });

  it('falls back to a neutral colour and "someone" for an unknown author', () => {
    const { editor, peerDoc, states, pushPeer } = setup();
    states.delete(peerDoc.clientID);

    pushPeer((ed) => ed.commands.insertContentAt(6, '!'));

    const rec = record(editor);
    expect(rec).toBeTruthy();
    expect(rec.name).toBe('someone');
    expect(rec.color).toBe(LIVE_COLLAB_NEUTRAL_COLOR);
  });

  it('does not highlight a local edit', () => {
    const { editor } = setup();
    editor.commands.insertContentAt(6, ' local');

    expect(record(editor)).toBeNull();
    expect(editor.view.dom.querySelector('.live-collab-added')).toBeNull();
  });
});

describe('deletion attribution', () => {
  it('names the acting peer, not the deleted text author', () => {
    const { editor, pushPeerY } = setup();
    // 'Hello' was authored by the local device; Alice deletes it live.
    pushPeerY((doc) => deleteAllText(doc));

    const rec = record(editor);
    expect(rec).toBeTruthy();
    expect(rec.name).toBe('Alice');
    expect(rec.color).toBe('#EF4444');
    expect(editor.state.doc.textContent).toBe('');
  });

  it('falls back to the neutral label when the actor cannot be resolved', () => {
    // Bob authors text, Alice deletes it, and both are present: Yjs records no
    // deleter, so the actor is genuinely ambiguous — never blame Bob.
    const ydoc = new Y.Doc();
    const { states, awareness } = makeAwareness();
    const editor = makeEditor(ydoc, awareness);
    editor.commands.setContent('<p>Hello</p>');

    const bobDoc = new Y.Doc();
    Y.applyUpdate(bobDoc, Y.encodeStateAsUpdate(ydoc));
    const bobEditor = makeEditor(bobDoc, null);
    states.set(bobDoc.clientID, {
      user: { id: 'bob', name: 'Bob', color: '#10B981' },
    });
    bobEditor.commands.setContent('<p>Bob text</p>');
    Y.applyUpdate(
      ydoc,
      Y.encodeStateAsUpdate(bobDoc, Y.encodeStateVector(ydoc)),
      REMOTE_ORIGIN
    );

    const aliceDoc = new Y.Doc();
    Y.applyUpdate(aliceDoc, Y.encodeStateAsUpdate(ydoc));
    states.set(aliceDoc.clientID, {
      user: { id: 'alice', name: 'Alice', color: '#EF4444' },
    });
    deleteAllText(aliceDoc);
    Y.applyUpdate(
      ydoc,
      Y.encodeStateAsUpdate(aliceDoc, Y.encodeStateVector(ydoc)),
      REMOTE_ORIGIN
    );

    const rec = record(editor);
    expect(rec).toBeTruthy();
    expect(rec.name).toBe('a collaborator');
    expect(rec.color).toBe(LIVE_COLLAB_NEUTRAL_COLOR);
  });

  it('does not highlight a local deletion', () => {
    const { editor } = setup();
    editor.commands.deleteRange({ from: 1, to: 6 });

    expect(record(editor)).toBeNull();
    expect(editor.view.dom.querySelector('.live-collab-chip')).toBeNull();
  });
});

describe('initial room sync', () => {
  it('ignores the opening catch-up but still highlights later live edits', () => {
    const { editor, awareness, pushPeer } = setup();
    // The websocket room has not completed its first sync yet.
    awareness.liveCollabRoomReady = false;

    // Catch-up: pre-existing remote content arrives as the note opens.
    pushPeer((ed) => ed.commands.insertContentAt(6, ' historical'));
    expect(record(editor)).toBeNull();
    expect(editor.view.dom.querySelector('.live-collab-chip')).toBeNull();

    // First sync landed: a later live edit must still raise a highlight.
    awareness.liveCollabRoomReady = true;
    pushPeer((ed) => ed.commands.insertContentAt(6, ' fresh'));

    const rec = record(editor);
    expect(rec).toBeTruthy();
    expect(rec.name).toBe('Alice');
    expect(editor.state.doc.textContent).toContain('fresh');
  });
});

describe('highlight lifetime', () => {
  it('expires after the fade window', () => {
    const { editor, pushPeer } = setup();
    vi.useFakeTimers();

    pushPeer((ed) => ed.commands.insertContentAt(6, '!'));
    expect(record(editor)).toBeTruthy();

    vi.advanceTimersByTime(LIVE_COLLAB_FADE_MS);
    expect(record(editor)).toBeNull();
  });

  it('is replaced by a newer remote edit outside the coalesce window', () => {
    const { editor, pushPeer } = setup();

    pushPeer((ed) => ed.commands.insertContentAt(6, ' A'));
    const first = record(editor);
    expect(addedText(first, editor.state.doc)).toBe(' A');

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + LIVE_COLLAB_COALESCE_MS + 100);

    const end = editor.state.doc.content.size - 1;
    pushPeer((ed) => ed.commands.insertContentAt(end, ' B'));
    const second = record(editor);

    expect(second).not.toBe(first);
    expect(second.batchStartedAt).toBeGreaterThan(first.batchStartedAt);
    expect(addedText(second, editor.state.doc)).toBe(' B');
  });
});

describe('burst coalescing', () => {
  it('merges a burst into one highlight covering the union of ranges', () => {
    const { editor, pushPeer } = setup();

    pushPeer((ed) => ed.commands.insertContentAt(6, ' A'));
    pushPeer((ed) => ed.commands.insertContentAt(6, ' B'));

    const rec = record(editor);
    expect(rec).toBeTruthy();
    const text = addedText(rec, editor.state.doc);
    expect(text).toContain('A');
    expect(text).toContain('B');
    expect(editor.view.dom.querySelectorAll('.live-collab-chip').length).toBe(1);
  });

  it('records the first change of the batch as the annotation target', () => {
    const { editor, pushPeer } = setup();

    // Two disjoint edits so the batch yields more than one ChangeSet change.
    pushPeer((ed) => ed.commands.insertContentAt(6, ' tail'));
    pushPeer((ed) => ed.commands.insertContentAt(1, 'head '));

    const rec = record(editor);
    expect(rec.changes.length).toBeGreaterThanOrEqual(2);
    expect(rec.target.fromA).toBe(rec.changes[0].fromA);
    expect(rec.target.toA).toBe(rec.changes[0].toA);
    const leftmost = Math.min(...rec.changes.map((c) => c.fromA));
    expect(rec.target.fromA).toBe(leftmost);
  });
});

describe('undo a specific remote change', () => {
  it('reverts exactly that change and a peer Y.Doc converges', () => {
    const { ydoc, editor, peerDoc, peerEditor, pushPeer } = setup();

    pushPeer((ed) => ed.commands.insertContentAt(6, ' world'));
    expect(editor.state.doc.textContent).toBe('Hello world');

    const undo = editor.view.dom.querySelector('.live-collab-chip__undo');
    expect(undo).toBeTruthy();
    undo.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(editor.state.doc.textContent).toBe('Hello');
    expect(record(editor)).toBeNull();

    Y.applyUpdate(
      peerDoc,
      Y.encodeStateAsUpdate(ydoc, Y.encodeStateVector(peerDoc))
    );
    expect(peerEditor.state.doc.textContent).toBe('Hello');
  });
});

describe('merge banner separation', () => {
  it('does not raise the async banner for live edits but applyRemote still does', () => {
    const { ydoc, editor, peerDoc, peerEditor, pushPeer } = setup();
    registerActiveDoc('n1', ydoc);
    const review = useChangeReview();
    const off = onRemoteApplied((id) => review.handleRemoteApplied(id, 'n1'));

    pushPeer((ed) => ed.commands.insertContentAt(6, ' live'));
    expect(review.mergeBannerVisible.value).toBe(false);

    const end = editor.state.doc.content.size - 1;
    peerEditor.commands.insertContentAt(end, ' async');
    applyRemote('n1', Y.encodeStateAsUpdate(peerDoc, Y.encodeStateVector(ydoc)));
    expect(review.mergeBannerVisible.value).toBe(true);

    review.dismissMergeBanner();
    off();
  });
});
