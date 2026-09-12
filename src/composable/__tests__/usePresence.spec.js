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
