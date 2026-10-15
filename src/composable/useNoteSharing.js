import { getCurrentScope, onScopeDispose, ref } from 'vue';
import { useAccountStore } from '@/store/account';
import { useCollaboratorStore } from '@/store/collaborator';
import { useWorkspaceStore } from '@/store/workspace';
import {
  createCollaborationKey as apiCreateKey,
  getCollaborationKey as apiGetKey,
  listCollaboratorPublicKeys as apiListPublicKeys,
  storeRecipients as apiStoreRecipients,
  rotateNoteKey as apiRotateNoteKey,
  inviteCollaborator as apiInvite,
  listCollaborators as apiList,
  removeCollaborator as apiRemove,
  generateInviteLink as apiGenerateLink,
  listInviteLinks as apiListLinks,
  revokeInviteLink as apiRevokeLink,
  listNoteJoinRequests as apiListJoinRequests,
  approveNoteJoinRequest as apiApproveJoinRequest,
  denyNoteJoinRequest as apiDenyJoinRequest,
} from '@/lib/api/collaboration';
import { getWorkspaceMembers as apiGetWorkspaceMembers } from '@/lib/api/workspaces';
import { getSettingSync } from '@/lib/settings';
import { logger } from '@/utils/logger';
import { loadOrCreateIdentity } from '@/utils/crypto/identity';
import {
  provisionNoteKey,
  recoverNoteKeyFromEnvelopes,
  clearUnwrappedKeyCache,
  wrapNoteKeyForRecipient,
  getCachedNoteKey,
  getPreviousNoteKeys,
  generateNoteKeyHex,
  buildNoteKeyPayload,
  rememberNoteKeyring,
} from '@/utils/crypto/note-key';
import { registerSharedSyncKey, expectSharedSyncNote, getActiveWsKey } from '@/utils/sync/shared-keys';
import { resolveNoteWorkspaceId, isSharedNote } from '@/utils/sync/shared-notes';
import { getWorkspaceDoc } from '@/lib/yjs/meta-doc';

// The server refuses a bootstrap share when it cannot match the note to a
// workspace (code `note_ownership_required`). Surface actionable copy instead
// of the raw server string, which a user cannot act on.
export const NOTE_WORKSPACE_UNCONFIRMED_MESSAGE =
  'Sharing needs a cloud workspace. Create one in Settings → Workspaces, or ask a teammate to invite you to theirs.';

// Envelope-upload retry budget: 3 flat attempts as before for ordinary errors,
// plus exponential backoff (1s doubling) and a hard stop after 5 consecutive
// 429s so a rate limit can no longer starve its own recovery.
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_BASE_DELAY_MS = 1000;

// Module-level so background tasks can resolve collaborator device keys
// without spinning up the full composable.
export async function fetchCollaboratorPublicKeys(noteId) {
  const accountStore = useAccountStore();
  const baseUrl = accountStore.serverUrl;
  try {
    return await apiListPublicKeys(noteId, { baseUrl });
  } catch (err) {
    // First touch of a note: the caller may not be a collaborator yet.
    // Listing invitations auto-grants the self-invitation, after which the
    // public-keys endpoint (gated to collaborators) accepts the request.
    if (err?.status !== 403) throw err;
    await apiList(noteId, { baseUrl });
    return apiListPublicKeys(noteId, { baseUrl });
  }
}

// O7 Fix A: a note "lives in" the active workspace when its id is present in
// the workspace meta doc's `notes` map. Only such notes seal under the
// workspace key; ad-hoc shared notes (collaboration fan-out) never enter that
// map and keep their per-note key.
function isWorkspaceIndexedNote(noteId) {
  if (!noteId) return false;
  // A note shared *to* this account is stored in our meta doc, but it belongs
  // to and is sealed by its owning workspace. Calling it "indexed here" would
  // resolve it to our own active workspace key: we could not read the owner's
  // updates, and our pushes would be sealed with a key no peer holds.
  if (isSharedNote(noteId)) return false;
  try {
    const doc = getWorkspaceDoc();
    return !!doc?.getMap('notes')?.has?.(noteId);
  } catch {
    return false;
  }
}

export function useNoteSharing() {
  const accountStore = useAccountStore();
  const collaboratorStore = useCollaboratorStore();
  const collaborators = ref([]);
  const loading = ref(false);
  const error = ref('');
  const key = ref(null);
  const inviteLinks = ref([]);
  const linkLoading = ref(false);
  // Pending require-approval join requests for this note (approver view).
  const joinRequests = ref([]);
  let fetchAbortController = null;
  const provisionRetries = new Set();

  // Retry waits are tracked so scope teardown drops the pending timers instead
  // of leaving one to fire (and hit the network) after the caller is gone.
  // Resolving them alongside the clear keeps an in-flight `await` from hanging.
  const pendingSleeps = new Map();
  let disposed = false;
  function sleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingSleeps.delete(timer);
        resolve();
      }, ms);
      pendingSleeps.set(timer, resolve);
    });
  }
  function dispose() {
    disposed = true;
    for (const [timer, resolve] of pendingSleeps) {
      clearTimeout(timer);
      resolve();
    }
    pendingSleeps.clear();
  }
  // Only register with the scope when one is active: called outside a
  // component's setup (e.g. from a store or a plain function), `onScopeDispose`
  // warns and cleans nothing. There, `dispose` is returned so the caller still
  // drops the pending retry timers on unmount.
  if (getCurrentScope()) {
    onScopeDispose(dispose);
  }

  function activeBaseUrl() {
    return accountStore.serverUrl;
  }

  // Sharing an unpushed note needs the active workspace id so the server can
  // recognise its owner. If the store has not loaded it yet, refresh the
  // workspace list once and read it again; a still-null id falls through to the
  // server's ownership check (mapped to friendly copy).
  async function resolveWorkspaceId(explicit) {
    if (explicit) return explicit;

    // The server needs the CLOUD workspace id (`workspaces.id` from
    // useCloudWorkspaces' module state). The Pinia workspace store only mirrors
    // it after the cloud list has loaded, so consult the cloud source first and
    // refresh it when empty: otherwise we send a local vault id (or nothing) and
    // the server refuses with `note_ownership_required`.
    try {
      const { useCloudWorkspaces } = await import('@/composable/useCloudWorkspaces');
      const cloud = useCloudWorkspaces();
      if (cloud.activeId?.value) return cloud.activeId.value;
      await cloud.fetchWorkspaces?.();
      if (cloud.activeId?.value) return cloud.activeId.value;
      const firstCloud = cloud.workspaces?.value?.[0]?.id;
      if (firstCloud) return firstCloud;
    } catch (err) {
      logger.debug?.('[notes] cloud workspace refresh before share failed:', err?.message || err);
    }

    const workspaceStore = useWorkspaceStore();
    if (workspaceStore.activeId) return workspaceStore.activeId;
    try {
      await workspaceStore.retrieve();
    } catch (err) {
      logger.debug?.('[notes] workspace refresh before share failed:', err?.message || err);
    }
    // Fall back to any known local workspace: a just-created personal vault may
    // not have `activeId` set yet, and the note-key bootstrap needs a workspace
    // to attribute an unpushed note.
    return (
      workspaceStore.activeId ||
      workspaceStore.workspaces?.[0]?.id ||
      null
    );
  }

  async function fetchCollaborators(noteId) {
    if (!accountStore.isAuthenticated) return;

    // Cancel any in-flight request
    if (fetchAbortController) {
      fetchAbortController.abort();
    }
    fetchAbortController = new AbortController();
    const { signal } = fetchAbortController;

    loading.value = true;
    error.value = '';
    let inviteError = null;
    try {
      const raw = await apiList(noteId, { baseUrl: activeBaseUrl(), signal });
      if (signal.aborted) return;

      collaborators.value = Array.isArray(raw)
        ? raw.map((inv) => ({
            userId: inv.userId || inv.user_id,
            username: inv.username || null,
            email: inv.email || null,
            role: inv.role || 'viewer',
            invitedAt: inv.invitedAt || inv.invited_at || null,
          }))
        : [];
    } catch (err) {
      // Ignore abort errors (expected during navigation)
      if (err?.name === 'AbortError' || signal.aborted) return;
      // A 403 is expected for a workspace-key member who was never invited to
      // this note, and a failed call (offline, server blip) still leaves the
      // workspace readable — both fall through to the member list below
      // instead of showing an empty panel.
      inviteError = err;
      collaborators.value = [];
    }

    // Always merge: the member list is the only source that reflects who can
    // actually read the note, whatever happened to the invitations call.
    const merged = await mergeWorkspaceMembers(noteId, { signal });
    if (signal.aborted) return;
    collaboratorStore.setCollaborators(noteId, collaborators.value);

    // Surface a failure only when the fallback could not cover it.
    if (inviteError && !merged) {
      error.value = inviteError.message || 'Failed to load collaborators';
      console.error('[useNoteSharing] fetchCollaborators failed:', inviteError);
    }

    if (!signal.aborted) {
      loading.value = false;
    }
  }

  // Notes in a shared workspace are readable by every workspace member via
  // the workspace key, not just per-note invitees. Merge those members into the
  // collaborator list (marked `viaWorkspace`) so the share modal shows the
  // people who can actually edit. Note invites stay authoritative for roles;
  // a remove only detaches the per-note invite, never workspace membership.
  // Returns true when the member list was actually loaded, false when it was
  // skipped — the caller uses that to decide whether a failure is worth
  // surfacing.
  async function mergeWorkspaceMembers(noteId, { signal } = {}) {
    const workspaceId = await resolveWorkspaceId(resolveNoteWorkspaceId(noteId, null));
    if (!workspaceId) return false;
    let members;
    try {
      const res = await apiGetWorkspaceMembers(workspaceId, {
        baseUrl: activeBaseUrl(),
        signal,
      });
      members = Array.isArray(res) ? res : res?.members;
    } catch (err) {
      // Members are context, not the source of truth: a non-member caller (or
      // an offline workspace) just sees the per-note invites.
      logger.debug?.('[notes] workspace member merge skipped:', err?.message || err);
      return false;
    }
    if (!Array.isArray(members) || signal?.aborted) return false;
    const seen = new Set(collaborators.value.map((c) => c.userId));
    for (const m of members) {
      const userId = m?.userId || m?.user_id || m?.accountId;
      if (!userId || seen.has(userId)) continue;
      seen.add(userId);
      collaborators.value.push({
        userId,
        username: m.username || null,
        email: m.email || null,
        role: m.role || 'viewer',
        viaWorkspace: true,
      });
    }
    return true;
  }

  async function ensureKey(noteId) {
    if (!accountStore.isAuthenticated) return null;
    try {
      // A note invited to this account lives in its OWNING workspace, not the
      // caller's active one. Naming the active workspace here made the server
      // see a caller that does not own the note, so the key bootstrap was
      // refused and this device never got an envelope. The grant on the note is
      // the authority; fall back to the active workspace only for own notes.
      const raw = await apiCreateKey(noteId, {
        baseUrl: activeBaseUrl(),
        workspaceId: await resolveWorkspaceId(
          resolveNoteWorkspaceId(noteId, null),
        ),
      });
      if (raw?.key) {
        key.value = raw.key;
      }
      return key.value;
    } catch (err) {
      console.error('[useNoteSharing] ensureKey failed:', err);
      return null;
    }
  }

  async function getKey(noteId) {
    if (!accountStore.isAuthenticated) return null;
    try {
      const raw = await apiGetKey(noteId, { baseUrl: activeBaseUrl() });
      if (raw?.key) {
        key.value = raw.key;
      }
      return key.value;
    } catch (err) {
      console.error('[useNoteSharing] getKey failed:', err);
      return null;
    }
  }

  async function ensureNoteKey(noteId, opts = {}) {
    if (!accountStore.isAuthenticated) return null;

    // O7 Fix A: notes indexed in the active workspace seal under the
    // workspace key (registered via registerWsKeyForNotes), so every workspace
    // member can read note bodies, comments, activity and history — not just
    // titles. Comments/activity/history resolve the key through this same
    // function, so returning the ws key keeps them readable too. Per-note
    // collaboration keys for ad-hoc shared notes (not in the ws doc) are
    // untouched, matching the approved plan.
    if (!opts?.skipWorkspaceKey) {
      const wsKeyHex = getActiveWsKey();
      if (wsKeyHex && isWorkspaceIndexedNote(noteId)) return wsKeyHex;
    }

    // Per-note ML-KEM fan-out stays dormant on personal paths: it must never
    // fire unless team collaboration is explicitly enabled (teams phase).
    if (!getSettingSync('collaborationEnabled')) return null;

    // Register the caller as the note's owner collaborator (idempotent: only
    // bootstraps when the note has zero collaborators) and ensure the key
    // envelope context exists. Non-fatal so note creation/opening never breaks.
    await ensureKey(noteId).catch(() => {});

    const identity = await loadOrCreateIdentity();

    // Same 403 self-invitation dance as fetchCollaboratorPublicKeys.
    const getKey = async () => {
      try {
        return await apiGetKey(noteId, { baseUrl: activeBaseUrl() });
      } catch (err) {
        if (err?.status !== 403) throw err;
        await apiList(noteId, { baseUrl: activeBaseUrl() });
        return apiGetKey(noteId, { baseUrl: activeBaseUrl() });
      }
    };

    const raw = await getKey();
    const noteKeyHex = await recoverNoteKeyFromEnvelopes(raw?.wrappedKeys, identity, noteId);
    if (noteKeyHex) {
      key.value = noteKeyHex;
      await rememberAndProvision(noteId, noteKeyHex);
      return noteKeyHex;
    }

    // Fresh note: provision key for every device of every collaborator.
    const fresh = await provisionNoteKey({
      getKey,
      listPublicKeys: () => fetchCollaboratorPublicKeys(noteId),
      storeRecipients: (recipients) =>
        apiStoreRecipients(noteId, recipients, { baseUrl: activeBaseUrl() }),
      identity,
      noteId,
    });
    if (fresh) {
      key.value = fresh;
      await rememberAndProvision(noteId, fresh);
      return fresh;
    }

    // The note already has a key (another device/account won provisioning) but
    // this device has no envelope yet: retry on demand instead of silently
    // staying unable to decrypt. A key-holding client re-wraps it when online.
    if (raw?.noteHasKey === true) {
      if (opts?.backgroundRetry) {
        // Opening the note must not block on the 1s×3 recovery sleeps (L10):
        // return now and let a key-holder re-wrap it in the background.
        void retryRecoverNoteKey(noteId, identity, getKey)
          .then(async (recovered) => {
            if (!recovered) return;
            key.value = recovered;
            try {
              await rememberAndProvision(noteId, recovered);
            } finally {
              opts?.onKeyResolved?.(recovered);
            }
          })
          .catch((err) => {
            logger.debug?.('[notes] background envelope recovery failed:', err?.message || err);
          });
        return null;
      }
      const recovered = await retryRecoverNoteKey(noteId, identity, getKey);
      if (recovered) {
        key.value = recovered;
        await rememberAndProvision(noteId, recovered);
        return recovered;
      }
    }

    // Late joiner with no envelope: a key-holder will re-wrap it on their next
    // open (see rememberAndProvision). Callers stay editable meanwhile; with
    // `onKeyResolved` they are told when the background re-wrap lands.
    logger.info('[notes] awaiting note-key re-wrap from a key-holding collaborator');
    return null;
  }

  // Hand the resolved key to the durable sync path and re-wrap it for any
  // collaborator device still missing an envelope. Only a device that already
  // holds the plaintext key can wrap it, so this runs on the key-holder.
  //
  // The durable path switches to the shared key ONLY when another *account*
  // collaborates: personal single-account notes keep the items key exactly as
  // before (a self-only per-note key would strand the account's other devices).
  async function rememberAndProvision(noteId, noteKeyHex) {
    // We just resolved this note's key but have not registered it yet. Mark the
    // note expected-shared up front so an in-flight cloud push defers it instead
    // of sealing with the account items key (which cross-account peers cannot
    // read). The mark is cleared by registration below.
    if (!(typeof noteKeyHex === 'string' && noteKeyHex)) return;
    await expectSharedSyncNote(noteId, true);

    let collaborators;
    try {
      const res = await fetchCollaboratorPublicKeys(noteId);
      collaborators = Array.isArray(res?.collaborators) ? res.collaborators : [];
    } catch (err) {
      // Ordering is deliberate: register BEFORE reacting to the failed lookup.
      // The note key was just minted/resolved and realtime already seals this
      // room with it, so the durable path must use the same key or cross-account
      // peers receive an items-key ciphertext they can never decrypt (L5). With
      // the collaborator set unknown we cannot prove the note personal, so fail
      // safe toward sharing: register the shared key (this also clears the
      // expected mark in Rust) and re-attempt lookup + envelope wrapping in the
      // background. Registration is idempotent.
      logger.debug?.(
        '[notes] collaborator lookup failed, registering shared key:',
        err?.message || err,
      );
      await registerSharedSyncKey(noteId, noteKeyHex, getPreviousNoteKeys(noteId));
      scheduleProvisionRetry(noteId, noteKeyHex);
      return;
    }

    const selfId = accountStore.profile?.id || null;
    const crossAccount = collaborators.some(
      (c) => c?.userId && (!selfId || c.userId !== selfId)
    );
    if (crossAccount) {
      // registerSharedSyncKey clears the expected mark in Rust.
      await registerSharedSyncKey(noteId, noteKeyHex, getPreviousNoteKeys(noteId));
    } else {
      // Personal (self-only) note: restore the exact v5 items-key path.
      await expectSharedSyncNote(noteId, false);
    }

    await provisionMissingEnvelopes(noteId, noteKeyHex, collaborators);

    // `crossAccount` notes switch to the shared key; the wrap above covers the
    // sibling/new-device case (a device the server reports `hasEnvelope: false`).
  }

  // One bounded background retry: the collaborator lookup can fail transiently
  // right after a fresh provision (server propagation), and the key wrap cannot
  // be retried when the set is unknown. Deduped per note so repeated opens do
  // not stack timers.
  function scheduleProvisionRetry(noteId, noteKeyHex) {
    if (provisionRetries.has(noteId)) return;
    provisionRetries.add(noteId);
    setTimeout(() => {
      provisionRetries.delete(noteId);
      rememberAndProvision(noteId, noteKeyHex).catch((err) => {
        logger.debug?.('[notes] provisioning retry failed:', err?.message || err);
      });
    }, 3000);
  }

  // `hasEnvelope === false` only: an older server omits the field and we no-op
  // rather than wrap everyone on every open.
  async function provisionMissingEnvelopes(noteId, noteKeyHex, collaborators) {
    const missing = collaborators.filter((c) => c?.kemPublicKey && c?.hasEnvelope === false);
    if (missing.length === 0) return;
    // If the note key has been rotated, hand a late joiner the whole keyring so
    // its fresh device can also read pre-rotation history, not just new content.
    const previous = getPreviousNoteKeys(noteId);
    const payload = previous.length ? buildNoteKeyPayload(noteKeyHex, previous) : noteKeyHex;
    try {
      const recipients = [];
      for (const c of missing) {
        const wrappedKey = await wrapNoteKeyForRecipient(c.kemPublicKey, payload);
        recipients.push({ userId: c.userId, deviceId: c.deviceId || 'default', wrappedKey });
      }
      if (recipients.length > 0) {
        await apiStoreRecipients(noteId, recipients, { baseUrl: activeBaseUrl() });
      }
    } catch (err) {
      logger.debug?.('[notes] missing-envelope provisioning skipped:', err?.message || err);
    }
  }

  // New device with no envelope: the server has a key for this note but not for
  // this device yet. Retry on demand (bounded) instead of silently staying
  // unable to decrypt; a key-holding client that is online re-wraps it (see
  // rememberAndProvision), and the next ensureNoteKey call retries again.
  //
  // Observed: 429 was retried like any other error, so a rate-limited envelope
  // upload starved itself — six to eight retries inside one second all landed
  // in the same throttle window and the envelope never landed, with only a debug
  // line to show for it. So: exponential backoff on 429 (1s, 2s, 4s, ...) and
  // a bounded give-up after 5 consecutive 429s, warned loudly. Any other failure
  // keeps the original flat 1s retry, and the counters are per call so a later
  // edit can start a fresh attempt.
  async function retryRecoverNoteKey(noteId, identity, getKey) {
    let attempts = 0;
    let rateLimited = 0;
    while (!disposed) {
      if (rateLimited > 0) {
        if (rateLimited >= RATE_LIMIT_MAX_ATTEMPTS) return null;
      } else if (attempts >= RETRY_MAX_ATTEMPTS) {
        return null;
      }
      await sleep(
        rateLimited > 0
          ? RATE_LIMIT_BASE_DELAY_MS * 2 ** (rateLimited - 1)
          : RETRY_DELAY_MS,
      );
      if (disposed) return null;
      attempts += 1;
      try {
        const raw = await getKey();
        const recovered = await recoverNoteKeyFromEnvelopes(raw?.wrappedKeys, identity, noteId);
        if (recovered) return recovered;
        // The server answered: the attempt worked, so the pressure is gone.
        rateLimited = 0;
      } catch (err) {
        const message = err?.message || err;
        if (err?.isRateLimit) {
          rateLimited += 1;
          if (rateLimited >= RATE_LIMIT_MAX_ATTEMPTS) {
            logger.warn(
              `[notes] envelope upload abandoned after ${attempts} attempts ` +
                `(${RATE_LIMIT_MAX_ATTEMPTS} rate-limited in a row):`,
              message,
            );
            return null;
          }
          logger.debug?.('[notes] envelope retry failed:', message);
          continue;
        }
        rateLimited = 0;
        logger.debug?.('[notes] envelope retry failed:', message);
      }
    }
    return null;
  }

  // An invite grants membership but creates no envelope: only a device that
  // already holds the plaintext key can wrap it, and the collaborator scan that
  // would do so otherwise runs no earlier than this note's next open. Wrap for
  // every device the server reports `hasEnvelope: false` right away, otherwise
  // the invitee stays read-only until the key-holder reopens the note.
async function wrapForNewCollaborators(noteId) {
    let held = getCachedNoteKey(noteId) || key.value;
    if (!held && isWorkspaceIndexedNote(noteId)) {
      const wsKeyHex = getActiveWsKey();
      if (wsKeyHex) held = wsKeyHex;
    }
    if (!held) return;
    try {
      const res = await fetchCollaboratorPublicKeys(noteId);
      await provisionMissingEnvelopes(
        noteId,
        held,
        Array.isArray(res?.collaborators) ? res.collaborators : [],
      );
    } catch (err) {
      logger.debug?.('[notes] post-invite note-key wrap skipped:', err?.message || err);
    }
  }

  async function invite(noteId, identifier, role = 'editor', { workspaceId } = {}) {
    if (!accountStore.isAuthenticated) throw new Error('Not authenticated');
    try {
      const result = await apiInvite(noteId, identifier, role, {
        baseUrl: activeBaseUrl(),
        workspaceId: await resolveWorkspaceId(workspaceId),
      });
      await fetchCollaborators(noteId);
      await wrapForNewCollaborators(noteId);
      return result;
    } catch (err) {
      error.value = err?.code === 'note_ownership_required'
        ? NOTE_WORKSPACE_UNCONFIRMED_MESSAGE
        : (err?.message || 'Failed to invite collaborator');
      throw err;
    }
  }

  // L8: rotating a note key after a collaborator is removed. Mints a fresh
  // generation, wraps a keyring (new current + the old key) for every remaining
  // collaborator device, publishes it via the rotation endpoint (which drops the
  // removed user's envelopes), and registers the new key with the Rust session
  // while keeping the previous one for decrypting older v6 rows.
  async function rotateNoteKeyForRemaining(noteId, previousKeyHex) {
    const newKeyHex = await generateNoteKeyHex();
    const payload = buildNoteKeyPayload(newKeyHex, [previousKeyHex]);

    const res = await fetchCollaboratorPublicKeys(noteId);
    const collaborators = Array.isArray(res?.collaborators) ? res.collaborators : [];
    const recipients = [];
    for (const c of collaborators) {
      if (!c?.kemPublicKey) continue;
      const wrappedKey = await wrapNoteKeyForRecipient(c.kemPublicKey, payload);
      recipients.push({ userId: c.userId, deviceId: c.deviceId || 'default', wrappedKey });
    }
    if (recipients.length === 0) {
      logger.warn('[notes] no remaining collaborator devices to rotate the note key for');
      return null;
    }

    await apiRotateNoteKey(noteId, recipients, { baseUrl: activeBaseUrl() });
    rememberNoteKeyring(noteId, newKeyHex, [previousKeyHex]);
    key.value = newKeyHex;
    await registerSharedSyncKey(noteId, newKeyHex, [previousKeyHex]);
    return newKeyHex;
  }

  async function remove(noteId, userId) {
    if (!accountStore.isAuthenticated) throw new Error('Not authenticated');
    const previous = collaborators.value.slice();
    collaborators.value = collaborators.value.filter((c) => c.userId !== userId);

    // Resolve the note key BEFORE removal: the remaining members need it kept
    // readable (the keyring archives it) and Rust keeps it as the previous key.
    let previousKeyHex = getCachedNoteKey(noteId) || key.value || null;
    if (!previousKeyHex && getSettingSync('collaborationEnabled')) {
      try {
        previousKeyHex = await ensureNoteKey(noteId);
      } catch (err) {
        logger.debug?.('[notes] could not resolve note key before removal:', err?.message || err);
      }
    }

    try {
      await apiRemove(noteId, userId, { baseUrl: activeBaseUrl() });
    } catch (err) {
      collaborators.value = previous;
      error.value = err?.message || 'Failed to remove collaborator';
      throw err;
    }
    clearUnwrappedKeyCache(noteId);

    // The membership change already landed server-side; rotation is what stops
    // the removed user from reading future content, so surface (don't swallow)
    // a failure but never roll the removal back.
    if (previousKeyHex && getSettingSync('collaborationEnabled')) {
      try {
        await rotateNoteKeyForRemaining(noteId, previousKeyHex);
      } catch (err) {
        // Never roll the removal back, but never let the user think the key was
        // rotated when it was not: the removed user may still read new changes.
        error.value =
          'Removed, but rotating the note key failed — they may still be able to read new changes.';
        logger.warn('[notes] note-key rotation after removal failed:', err?.message || err);
      }
    }
  }

  async function fetchLinks(noteId) {
    // No account → no links to fetch; never hit the network signed out.
    if (!accountStore.isAuthenticated) {
      inviteLinks.value = [];
      return;
    }
    linkLoading.value = true;
    try {
      inviteLinks.value = await apiListLinks(noteId, { baseUrl: activeBaseUrl() });
    } finally {
      linkLoading.value = false;
    }
  }

  async function generateLink(noteId, options = {}) {
    if (!accountStore.isAuthenticated) throw new Error('Not authenticated');
    try {
      const result = await apiGenerateLink(noteId, {
        role: options.role || 'editor',
        requireApproval: options.requireApproval || false,
        expiresIn: options.expiresIn || null,
        baseUrl: activeBaseUrl(),
        workspaceId: await resolveWorkspaceId(options.workspaceId),
      });
      inviteLinks.value.unshift(result);
      return result;
    } catch (err) {
      if (err?.code === 'note_ownership_required') {
        throw new Error(NOTE_WORKSPACE_UNCONFIRMED_MESSAGE);
      }
      throw err;
    }
  }

  async function revokeLink(noteId, linkId) {
    if (!accountStore.isAuthenticated) throw new Error('Not authenticated');
    // Optimistically drop the row, but restore it if the server rejects the
    // revoke: a revoked link that is still live is worse than an honest error.
    const previous = inviteLinks.value.slice();
    inviteLinks.value = inviteLinks.value.filter((l) => l.id !== linkId);
    try {
      await apiRevokeLink(noteId, linkId, { baseUrl: activeBaseUrl() });
    } catch (err) {
      inviteLinks.value = previous;
      error.value = err?.message || 'Failed to revoke invite link';
      throw err;
    }
  }

  async function fetchJoinRequests(noteId) {
    if (!accountStore.isAuthenticated) {
      joinRequests.value = [];
      return;
    }
    try {
      // Stamp the note id on each row: approval needs it to wrap for the new
      // collaborator, and the row is gone by the time approval returns.
      joinRequests.value = (await apiListJoinRequests(noteId, { baseUrl: activeBaseUrl() })).map(
        (r) => ({ ...r, noteId: r.noteId || noteId }),
      );
    } catch (err) {
      // A non-editor (viewer) gets 403: no queue to show, not an error.
      if (err?.status !== 403) {
        console.warn('[useNoteSharing] fetchJoinRequests failed:', err?.message || err);
      }
      joinRequests.value = [];
    }
  }

  // Approval inserts the same collaborator row an invite does, so it needs the
  // same wrap. The queue row is gone once approval returns, so keep its note id.
  async function approveJoinRequest(requestId) {
    const noteId = joinRequests.value.find((r) => r.id === requestId)?.noteId;
    await apiApproveJoinRequest(requestId, { baseUrl: activeBaseUrl() });
    joinRequests.value = joinRequests.value.filter((r) => r.id !== requestId);
    if (noteId) await wrapForNewCollaborators(noteId);
  }

  async function denyJoinRequest(requestId) {
    await apiDenyJoinRequest(requestId, { baseUrl: activeBaseUrl() });
    joinRequests.value = joinRequests.value.filter((r) => r.id !== requestId);
  }

  return {
    collaborators,
    loading,
    error,
    key,
    inviteLinks,
    linkLoading,
    joinRequests,
    fetchCollaborators,
    ensureKey,
    getKey,
    ensureNoteKey,
    invite,
    remove,
    fetchLinks,
    generateLink,
    revokeLink,
    fetchJoinRequests,
    approveJoinRequest,
    denyJoinRequest,
    dispose,
  };
}
