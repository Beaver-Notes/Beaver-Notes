import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { Doc } from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { usePresence } from '../usePresence';

describe('usePresence null awareness', () => {
  it('init/destroy with an empty ref are no-ops', () => {
    const { init, destroy, peers } = usePresence(ref(null), 'me', 'Me');
    expect(() => { init(); destroy(); }).not.toThrow();
    expect(peers.value.size).toBe(0);
  });

  it('destroy detaches from a real awareness', () => {
    const aw = new Awareness(new Doc());
    const { init, destroy, peers } = usePresence(aw, 'me', 'Me');
    init();
    destroy();
    expect(() => aw.emit('change', [[]])).not.toThrow();
    expect(peers.value.size).toBe(0);
  });
});

describe('usePresence peer filtering', () => {
  function state(aw, clientId, user) {
    aw.getStates().set(clientId, { user });
    aw.emit('change', []);
  }

  it('excludes the same account connected from another client', () => {
    const aw = new Awareness(new Doc());
    const { init, peers } = usePresence(aw, () => 'acct-1', () => 'Alice');
    init();
    state(aw, 999, { id: 'acct-1', name: 'Alice' });
    expect(peers.value.size).toBe(0);
  });

  it('ignores identity-less anonymous states', () => {
    const aw = new Awareness(new Doc());
    const { init, peers } = usePresence(aw, () => 'acct-1', () => 'Alice');
    init();
    state(aw, 998, { id: 'anonymous', name: 'Anonymous' });
    expect(peers.value.size).toBe(0);
  });

  it('counts a real remote collaborator once', () => {
    const aw = new Awareness(new Doc());
    const { init, peers } = usePresence(aw, () => 'acct-1', () => 'Alice');
    init();
    state(aw, 997, { id: 'acct-2', name: 'Bob' });
    expect(peers.value.size).toBe(1);
  });
});
