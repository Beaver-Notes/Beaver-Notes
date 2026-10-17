import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import LiveCollab, {
  LIVE_COLLAB_ACTIVITY_DEBOUNCE_MS,
} from '../index.js';
import { revertReviewChange } from '../../version-preview/index.js';

const editors = [];
const REMOTE_ORIGIN = { kind: 'ws-provider' };

afterEach(() => {
  while (editors.length) {
    const ed = editors.pop();
    if (!ed.isDestroyed) ed.destroy();
  }
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = () =>
  new Promise((resolve) =>
    setTimeout(resolve, LIVE_COLLAB_ACTIVITY_DEBOUNCE_MS + 40)
  );

// y-prosemirror does not relay an editor's deletion of another client's content
// to the Y.Doc, so simulate the wire form of a remote deletion directly.
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

function makeAwareness(localUser) {
  const states = new Map();
  return {
    states,
    awareness: {
      clientID: 1,
      getStates: () => states,
      getLocalState: () => (localUser ? { user: localUser } : null),
    },
  };
}

async function setupActivity(localUser) {
  const ydoc = new Y.Doc();
  const { states, awareness } = makeAwareness(localUser);
  const activities = [];
  const editor = new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      Collaboration.configure({ document: ydoc, field: 'content' }),
      LiveCollab.configure({
        awareness,
        noteId: 'n1',
        onActivity: (payload) => activities.push(payload),
      }),
    ],
    enableCoreExtensions: { paste: false, textDirection: false },
  });
  editors.push(editor);
  editor.commands.setContent('<p>Hello</p>');

  const peerDoc = new Y.Doc();
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(ydoc));
  const peerEditor = new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      Collaboration.configure({ document: peerDoc, field: 'content' }),
    ],
  });
  editors.push(peerEditor);

  // Past the macrotask that arms recording; the setContent above happened
  // before it and must not be logged.
  await tick();
  return { ydoc, editor, peerDoc, peerEditor, states, awareness, activities };
}

describe('activity capture', () => {
  it('does not log the initial hydration of existing content', async () => {
    const { activities } = await setupActivity({ id: 'me', name: 'Me' });
    await settle();
    expect(activities).toHaveLength(0);
  });

  it('records a local edit once, with actor, kind and summary', async () => {
    const { editor, activities } = await setupActivity({ id: 'me', name: 'Me' });

    editor.commands.insertContentAt(6, ' world');
    expect(activities).toHaveLength(0);

    await settle();
    expect(activities).toHaveLength(1);
    const { entry } = activities[0];
    expect(entry.noteId).toBe('n1');
    expect(entry.actorId).toBe('me');
    expect(entry.actorLabel).toBe('Me');
    expect(entry.kind).toBe('insert');
    expect(entry.summary).toContain('world');
    expect(entry.at).toBeGreaterThan(0);
  });

  it('coalesces a typing burst into one entry', async () => {
    const { editor, activities } = await setupActivity({ id: 'me', name: 'Me' });

    editor.commands.insertContentAt(6, ' A');
    editor.commands.insertContentAt(8, ' B');

    await settle();
    expect(activities).toHaveLength(1);
    expect(activities[0].entry.summary).toContain('A');
    expect(activities[0].entry.summary).toContain('B');
  });

  it('records a local deletion as a delete entry naming the removed text', async () => {
    const { editor, activities } = await setupActivity({ id: 'me', name: 'Me' });

    editor.commands.deleteRange({ from: 1, to: 6 });

    await settle();
    expect(activities).toHaveLength(1);
    expect(activities[0].entry.kind).toBe('delete');
    expect(activities[0].entry.summary).toBe('Hello');
  });

  it('attributes a remote edit to the peer, not the local user', async () => {
    const { ydoc, peerDoc, peerEditor, states, activities } =
      await setupActivity({ id: 'me', name: 'Me' });
    states.set(peerDoc.clientID, {
      user: { id: 'peer-1', name: 'Alice', color: '#EF4444' },
    });

    peerEditor.commands.insertContentAt(6, ' remote');
    Y.applyUpdate(
      ydoc,
      Y.encodeStateAsUpdate(peerDoc, Y.encodeStateVector(ydoc)),
      REMOTE_ORIGIN
    );

    await settle();
    expect(activities).toHaveLength(1);
    const { entry } = activities[0];
    expect(entry.actorId).toBe('peer-1');
    expect(entry.actorLabel).toBe('Alice');
    expect(entry.kind).toBe('insert');
    expect(entry.summary).toContain('remote');
  });

  it('logs an unattributable remote deletion as "a collaborator deleted"', async () => {
    const { ydoc, states, activities } = await setupActivity({ id: 'me', name: 'Me' });
    // Two peers are online; Yjs carries no deleter, so the actor is genuinely
    // ambiguous and the entry must neither name nor blame either peer.
    const aliceDoc = new Y.Doc();
    Y.applyUpdate(aliceDoc, Y.encodeStateAsUpdate(ydoc));
    states.set(aliceDoc.clientID, {
      user: { id: 'alice', name: 'Alice', color: '#EF4444' },
    });
    const bobDoc = new Y.Doc();
    Y.applyUpdate(bobDoc, Y.encodeStateAsUpdate(ydoc));
    states.set(bobDoc.clientID, {
      user: { id: 'bob', name: 'Bob', color: '#10B981' },
    });

    deleteAllText(aliceDoc);
    Y.applyUpdate(
      ydoc,
      Y.encodeStateAsUpdate(aliceDoc, Y.encodeStateVector(ydoc)),
      REMOTE_ORIGIN
    );

    await settle();
    expect(activities).toHaveLength(1);
    const { entry } = activities[0];
    expect(entry.kind).toBe('delete');
    expect(entry.actorId).toBeNull();
    expect(entry.actorLabel).toBe('a collaborator');
    expect(entry.summary).toBe('Hello');
  });
});

describe('activity undo', () => {
  it('reverts exactly the recorded insertion and a peer converges', async () => {
    const { ydoc, editor, peerDoc, peerEditor, activities } =
      await setupActivity({ id: 'me', name: 'Me' });

    editor.commands.insertContentAt(6, ' world');
    await settle();
    expect(editor.state.doc.textContent).toBe('Hello world');

    const { baseline, target } = activities[0];
    expect(revertReviewChange(editor, baseline, target)).toBe(true);
    expect(editor.state.doc.textContent).toBe('Hello');

    Y.applyUpdate(
      peerDoc,
      Y.encodeStateAsUpdate(ydoc, Y.encodeStateVector(peerDoc))
    );
    expect(peerEditor.state.doc.textContent).toBe('Hello');
  });
});
