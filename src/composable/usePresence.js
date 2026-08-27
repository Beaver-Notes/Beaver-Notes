import { ref } from 'vue';

const PEER_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6',
];

export function getColorFromId(id) {
  if (!id) return PEER_COLORS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length];
}

function resolveAwareness(a) {
  if (!a) return null;
  if (typeof a === 'function') return a() || null;
  // shallowRef unwrapping
  if (typeof a === 'object' && 'value' in a && a.value !== undefined && (a.value === null || typeof a.value === 'object')) {
    if (a.value === null || typeof a.value.getStates === 'function' || typeof a.value.setLocalStateField === 'function') return a.value;
  }
  return a;
}

export function usePresence(awarenessOrRef, localUserId, localUserName) {
  const peers = ref(new Map());
  const localColor = ref(getColorFromId(localUserId));
  const getAw = () => resolveAwareness(awarenessOrRef);

  function setLocalState(state) {
    const aw = getAw();
    if (!aw) return;
    aw.setLocalStateField('user', {
      id: localUserId,
      name: localUserName,
      color: localColor.value,
      ...state,
    });
  }

  function setCursor(anchor, head) {
    const aw = getAw();
    if (!aw) return;
    aw.setLocalStateField('cursor', { anchor, head });
  }

  function updatePeers() {
    const aw = getAw();
    if (!aw) return;
    const states = aw.getStates();
    const newPeers = new Map();
    states.forEach((state, clientId) => {
      if (clientId === aw.clientID) return;
      const user = state?.user;
      if (user) {
        newPeers.set(clientId, {
          id: user.id,
          name: user.name || 'Anonymous',
          color: user.color || getColorFromId(user.id),
          cursor: state?.cursor || null,
        });
      }
    });
    peers.value = newPeers;
  }

  function init() {
    const aw = getAw();
    if (!aw) return;
    setLocalState({});
    aw.on('change', updatePeers);
    updatePeers();
  }

  function destroy() {
    const aw = getAw();
    if (aw) aw.off('change', updatePeers);
    peers.value = new Map();
  }

  return {
    peers,
    localColor,
    setLocalState,
    setCursor,
    init,
    destroy,
  };
}
