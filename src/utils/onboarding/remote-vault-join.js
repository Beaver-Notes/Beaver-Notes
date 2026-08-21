import {
  unwrapWorkspaceKeysFromVault,
  setCachedWorkspaceKey,
} from '@/lib/api/workspaces';

export async function detectRemoteVaultJoin({
  fetchCloudKeyParams,
  hasRemoteVaultKeyParams,
}) {
  const fetched = await fetchCloudKeyParams({ force: true });
  if (fetched) return true;
  return hasRemoteVaultKeyParams();
}

export async function completeRemoteVaultJoin({
  workspaceId,
  passphrase,
  proofBlob,
  paramsBlob,
  challenge,
  deriveProof,
  verify,
  adopt,
}) {
  const proof = await deriveProof(passphrase, workspaceId, proofBlob, challenge);
  await verify(workspaceId, proof, challenge);
  return adopt(passphrase, paramsBlob);
}

/**
 * Run AFTER a successful vault passphrase adoption: if the joined workspace
 * record carries a passphrase-recoverable key envelope (vault_wrapped_keys),
 * decrypt it with the freshly adopted session AEK and seed the client-side
 * workspace-key cache. Consumers (ensureMetaRoomKey / name encryption) then
 * skip the network fetch + ML-KEM unwrap path entirely. Best-effort — returns
 * false when the record has no envelope or decryption fails, never throws.
 */
export async function adoptWorkspaceKeysFromVault(workspaceRecord) {
  if (!workspaceRecord?.id || !workspaceRecord?.vaultWrappedKeys) return false;
  const recovered = await unwrapWorkspaceKeysFromVault(workspaceRecord.vaultWrappedKeys);
  if (!recovered?.workspaceKeyHex) return false;
  setCachedWorkspaceKey(workspaceRecord.id, recovered.workspaceKeyHex);
  return true;
}
