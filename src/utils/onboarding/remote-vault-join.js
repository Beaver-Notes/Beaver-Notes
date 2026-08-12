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
