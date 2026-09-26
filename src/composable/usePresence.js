import { computed, ref, isRef } from 'vue';
import { logger } from '@/utils/logger';

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
  const v = isRef(a) ? a.value : a;
  if (v && typeof v.getStates === 'function') return v;
  return null;
}

export function usePresence(awarenessOrRef, localUserId, localUserName) {
  const peers = ref(new Map());
  // Id/name may arrive after mount (profile loads async): accept a getter so
  // a '' captured at setup can't permanently defeat self-exclusion.
  const resolveVal = (v) => (typeof v === 'function' ? v() : isRef(v) ? v.value : v);
  const getLocalId = () => resolveVal(localUserId);
  const getLocalName = () => resolveVal(localUserName);
  const localColor = computed(() => getColorFromId(getLocalId()));
  const getAw = () => resolveAwareness(awarenessOrRef);

  // True when the peer's user id is our own account: same human, not a
  // collaborator. Anonymous/local-only has no stable id: never self-match,
  // so strangers are never hidden.
  function isSelfId(peerId) {
    if (!peerId || peerId === 'anonymous' || peerId === 'local') return false;
    const localId = getLocalId();
    if (!localId || localId === 'anonymous' || localId === 'local')
      return false;
    return peerId === localId;
  }

  function setLocalState(state) {
    const aw = getAw();
    if (!aw) return;
    aw.setLocalStateField('user', {
      id: getLocalId(),
      name: getLocalName(),
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
    const byUser = new Map();
    const seen = [];
    states.forEach((state, clientId) => {
      if (clientId === aw.clientID) return;
      const user = state?.user;
      if (!user) return;
      const hasAccountId =
        user.id && user.id !== 'anonymous' && user.id !== 'local';
      seen.push(`${clientId}=${user.id ?? '?'}:${user.name ?? '?'}`);
      // Only authenticated accounts are collaborators. Entries with no account
      // id are partial/stale awareness states (pre-login, dead reconnects) and
      // were the source of phantom "N users" counts.
      if (!hasAccountId) return;
      // Own other devices (same account, different client) are sync, not
      // collaboration: never count them as people.
      if (isSelfId(user.id)) return;
      // One avatar per human: stale reconnects share the user id, so the
      // second ghost entry collapses instead of inflating the count.
      const key = `u:${user.id}`;
      if (!byUser.has(key)) {
        byUser.set(key, {
          id: user.id,
          name: user.name || 'Anonymous',
          color: user.color || getColorFromId(user.id),
          cursor: state?.cursor || null,
        });
      }
    });
    // Debug aid for ghost reports: which remote states survived filtering.
    if (byUser.size > 0) {
      logger.debug('[presence] peers', { local: getLocalId(), remote: seen });
    }
    peers.value = byUser;
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
