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

/** After vault adoption: decrypt vault_wrapped_keys with session AEK and seed key cache. Skips fetch plus unwrap. Best-effort, false on missing/fail. */
export async function adoptWorkspaceKeysFromVault(workspaceRecord) {
  if (!workspaceRecord?.id || !workspaceRecord?.vaultWrappedKeys) return false;
  const recovered = await unwrapWorkspaceKeysFromVault(workspaceRecord.vaultWrappedKeys);
  if (!recovered?.workspaceKeyHex) return false;
  setCachedWorkspaceKey(workspaceRecord.id, recovered.workspaceKeyHex);
  return true;
}
