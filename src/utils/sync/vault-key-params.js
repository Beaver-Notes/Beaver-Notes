import { getSyncPath } from './path.js';
import { path, backend } from '@/lib/tauri-bridge';
import { ensureDir, writeFile, readData, pathExists } from '@/lib/native/fs';
import { getAppDirectory } from '@/lib/native/app';
import { getSettingSync } from '@/lib/settings';
import { useAccountStore } from '@/store/account';
import { SYNC_TRANSPORT, canUseCloudSync, normalizeSyncTransport } from '@/lib/api/types';
import { getApiClient } from '@/lib/api/client';
import { loadSecureBlob } from '@/utils/crypto/safeStorageBlob.js';
import { useWorkspaceStore } from '@/store/workspace.ts';
import { logger } from '@/utils/logger';

export const RESERVED_KEY_PARAMS_KEY = '__key_params__.json';
const KEY_PARAMS_SUBDIR = 'BeaverNotesSync';
let fetchedCloudKeyParams = null;

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
  try {
    const decoded = atob(raw);
    return decoded.trim().startsWith('{') ? decoded : raw;
  } catch {
    return raw;
  }
}

export async function deriveVaultPassphraseProof(passphrase, workspaceId, keyParamsBlob, _challenge) {
  // Derivation lives in Rust: BLAKE3 over the Argon2id KEK, domain-separated
  // by workspace + key params. The proof is stable across publish and verify
  // so the server can store it hashed and compare later. The per-request
  // `challenge` is kept in the signature for call-site compatibility but is a
  // freshness token checked separately by the server — never part of the proof.
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

export async function publishCloudKeyParams() {
  if (!cloudKeyParamsReachable()) { logger.debug('[vault-key-params] publish: cloud not reachable'); return false; }
  const p = await localKeyParamsPath();
  if (!p) { logger.info('[vault-key-params] publish: no local key params path'); return false; }
  const exists = await pathExists(p).catch(() => false);
  if (!exists) { logger.info('[vault-key-params] publish: key params file not found at', p); return false; }
  const b64 = await readData(p).catch(() => null);
  if (!b64) { logger.info('[vault-key-params] publish: could not read key params file'); return false; }

  const workspaceStore = useWorkspaceStore();
  const workspaceId = workspaceStore.activeId;
  if (!workspaceId) { logger.info('[vault-key-params] publish: no active workspace'); return false; }

  const passphrase = await loadSecureBlob('encryptionPassphraseBlob').catch(() => null);
  if (!passphrase) { logger.info('[vault-key-params] publish: no passphrase in secure storage'); return false; }
  const accountStore = useAccountStore();
  const client = getApiClient({ baseUrl: accountStore.serverUrl });
  const { challenge } = await client.createVaultChallenge(workspaceId);
  const passphraseProof = await deriveVaultPassphraseProof(passphrase, workspaceId, b64, challenge);
  await client.publishVaultKeyParams(workspaceId, { keyParams: b64, passphraseProof, challenge });
  logger.info('[vault-key-params] publish: success for workspace', workspaceId);
  return true;
}

export async function fetchCloudKeyParams({ force = false, timeoutMs } = {}) {
  fetchedCloudKeyParams = null;
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

  try {
    const accountStore = useAccountStore();
    const client = getApiClient({ baseUrl: accountStore.serverUrl });
    const result = await client.getVaultKeyParams(workspaceId);
    const raw = result?.keyParams;
    if (!raw) return null;
    const p = await localKeyParamsPath();
    if (!p) return null;
    await ensureDir(p.slice(0, p.lastIndexOf('/'))).catch(() => {});
    const decoded = decodeKeyParams(raw);
    await writeFile(p, decoded);
    fetchedCloudKeyParams = { proofBlob: raw, paramsBlob: decoded };
  } catch (e) {
    if (e?.status === 404) return null;
    throw e;
  }
  return true;
}
