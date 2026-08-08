import { ref } from 'vue';

const PEER_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6',
];

function getColorFromId(id) {
  if (!id) return PEER_COLORS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length];
}

export function usePresence(awareness, localUserId, localUserName) {
  const peers = ref(new Map());
  const localColor = ref(getColorFromId(localUserId));

  function setLocalState(state) {
    if (!awareness) return;
    awareness.setLocalStateField('user', {
      id: localUserId,
      name: localUserName,
      color: localColor.value,
      ...state,
    });
  }

  function setCursor(anchor, head) {
    if (!awareness) return;
    awareness.setLocalStateField('cursor', { anchor, head });
  }

  function updatePeers() {
    if (!awareness) return;
    const states = awareness.getStates();
    const newPeers = new Map();
    states.forEach((state, clientId) => {
      if (clientId === awareness.clientID) return;
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
    if (!awareness) return;
    setLocalState({});
    awareness.on('change', updatePeers);
    updatePeers();
  }

  function destroy() {
    if (!awareness) return;
    awareness.off('change', updatePeers);
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
