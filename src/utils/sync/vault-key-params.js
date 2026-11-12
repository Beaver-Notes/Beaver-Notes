import { getSyncPath } from './path.js';
import { path, backend } from '@/lib/tauri-bridge';
import { ensureDir, writeFile } from '@/lib/native/fs';
import { getAppDirectory } from '@/lib/native/app';
import { getSettingSync } from '@/lib/settings';
import { useAccountStore } from '@/store/account';
import { SYNC_TRANSPORT, canUseCloudSync, normalizeSyncTransport } from '@/lib/api/types';
import { getApiClient } from '@/lib/api/client';
import { base64ToBuf } from '@/utils/crypto/codec.js';
import { useWorkspaceStore } from '@/store/workspace.ts';

const KEY_PARAMS_SUBDIR = 'BeaverNotesSync';
let fetchedCloudKeyParams = null;
let cloudKeyParamsMissing = false;

function keyParamsPath(syncPath) {
  return path.join(syncPath, KEY_PARAMS_SUBDIR, 'keyParams.json');
}

async function localKeyParamsPath() {
  const syncPath = await getSyncPath();
  if (syncPath) return keyParamsPath(syncPath);
  const appDirectory = await getAppDirectory().catch(() => '');
  return appDirectory ? keyParamsPath(appDirectory) : null;
}

function decodeKeyParams(raw) {
  if (!raw) return null;
  if (typeof raw === 'string' && raw.trim().startsWith('{')) return raw;
  try {
    const decoded = new TextDecoder().decode(base64ToBuf(raw));
    return decoded.trim().startsWith('{') ? decoded : raw;
  } catch {
    return raw;
  }
}

function isValidKeyParamsShape(decoded) {
  try {
    const p = JSON.parse(decoded);
    return p && typeof p === 'object'
      && typeof p.version === 'number'
      && (p.wrappedKey || p.wrapped_key || p.saltHex || p.salt_hex);
  } catch {
    return false;
  }
}

export async function deriveVaultPassphraseProof(passphrase, workspaceId, keyParamsBlob, _challenge) {
  // Derivation lives in Rust: BLAKE3 over the Argon2id KEK, domain-separated
  // by workspace + key params. The proof is stable across publish and verify
  // so the server can store it hashed and compare later. The per-request
  // `challenge` is kept in the signature for call-site compatibility but is a
  // Freshness token checked separately, never part of proof.
  return backend.invoke('vault:deriveProof', { passphrase, workspaceId, keyParamsBlob });
}

export function getFetchedCloudKeyParams() {
  return fetchedCloudKeyParams;
}

export function cloudKeyParamsReachable({ force = false } = {}) {
  const accountStore = useAccountStore();
  const transport = normalizeSyncTransport(getSettingSync('syncTransport'));
  const wantsCloud = transport === SYNC_TRANSPORT.REMOTE;
  return Boolean(
    accountStore.isAuthenticated &&
      canUseCloudSync(accountStore.activeOrg?.subscription ?? accountStore.subscription) &&
      (force || wantsCloud)
  );
}

export async function fetchCloudKeyParams({ force = false, timeoutMs } = {}) {
  fetchedCloudKeyParams = null;
  cloudKeyParamsMissing = false;
  if (!cloudKeyParamsReachable({ force })) return null;
  const workspaceStore = useWorkspaceStore();
  const workspaceId = workspaceStore.activeId;
  if (!workspaceId) return null;

  // Ensure session token is available before making authenticated requests
  const { loadSessionToken } = await import('@/lib/account-storage');
  const deadline = Date.now() + (timeoutMs ?? 1000);
  let token = await loadSessionToken();
  while (!token && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    token = await loadSessionToken();
  }
  if (!token) {
    console.warn('[vault-key-params] session token not available, skipping fetch');
    return null;
  }

  const accountStore = useAccountStore();
  const client = getApiClient({ baseUrl: accountStore.serverUrl });

  // Phase 2: one vault key per ACCOUNT. The account-scoped row is the source of
  // truth, so the fetched params do not depend on which workspace is active and
  // switching/joining a workspace never re-derives or re-prompts. A 404 falls
  // back to the legacy per-workspace scope (older server or an account that has
  // not published yet — the server adopts account params from exactly these).
  let result = null;
  try {
    result = await client.getAccountVaultKeyParams();
  } catch (e) {
    if (e?.status !== 404) throw e;
  }
  let raw = result?.keyParams;
  if (!raw && workspaceId) {
    try {
      const legacy = await client.getVaultKeyParams(workspaceId);
      raw = legacy?.keyParams;
    } catch (e) {
      if (e?.status !== 404) throw e;
    }
  }
  if (!raw) {
    cloudKeyParamsMissing = true;
    return null;
  }

  const p = await localKeyParamsPath();
  if (!p) return null;
  await ensureDir(p.slice(0, p.lastIndexOf('/'))).catch(() => {});
  const decoded = decodeKeyParams(raw);
  if (!decoded || !isValidKeyParamsShape(decoded)) return null;
  await writeFile(p, decoded);
  fetchedCloudKeyParams = { proofBlob: raw, paramsBlob: decoded };
  return true;
}

/**
 * True when the last {@link fetchCloudKeyParams} reached the server and the
 * workspace had no key params (clean 404). False when the fetch never ran or
 * failed for any other reason, so callers can safely mint+publish without
 * risking an overwrite of the vault owner's keys.
 */
export function cloudKeyParamsAbsent() {
  return cloudKeyParamsMissing;
}

/**
 * Publish this device's local key params so other devices can adopt them.
 * Only meaningful for the vault owner at setup: previously only the Rust seed
 * path published, so a brand-new workspace with no notes never propagated its
 * password. Call only after {@link cloudKeyParamsAbsent} confirmed a 404.
 */
export async function publishCloudKeyParams() {
  if (!cloudKeyParamsReachable()) return false;

  const [{ localKeyParamsJson }, { getApiClient }] = await Promise.all([
    import('@/lib/native/security.js'),
    import('@/lib/api/client'),
  ]);
  const json = await localKeyParamsJson().catch(() => null);
  if (!json) return false;

  // Account scope: the row is the caller's own and the blob is opaque, so no
  // workspace challenge/proof is needed (the server refuses to rewrite an
  // existing different account vault with 409).
  const accountStore = useAccountStore();
  const client = getApiClient({ baseUrl: accountStore.serverUrl });
  await client.publishAccountVaultKeyParams({ keyParams: json });
  return true;
}
