//! Reusable vault key-params HTTP helpers, ported from
//! `src/utils/sync/vault-key-params.js`. Extracted from the seed path
//! (`bootstrap.rs`) so the scheduler (Task 10) can publish and fetch key
//! params without duplicating the challenge/proof dance.

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use super::assets::encode_uri_component;
use super::cloud::CloudFail;
use super::remote::CloudClient;
use crate::commands::security::vault_proof_impl;
use crate::shared::{AppError, AppState};

/// `/vault/{encodeURIComponent(ws)}/key-params` — same escaping as the JS
/// client (`client.js`), so server keys line up.
pub(crate) fn vault_key_params_path(workspace_id: &str) -> String {
    format!("/vault/{}/key-params", encode_uri_component(workspace_id))
}

/// `/vault/{encodeURIComponent(ws)}/challenge`.
pub(crate) fn vault_challenge_path(workspace_id: &str) -> String {
    format!("/vault/{}/challenge", encode_uri_component(workspace_id))
}

/// Exact `{keyParams, passphraseProof, challenge}` publish body. `proof` is the
/// caller-derived `vault_proof_impl` value, never the key-params blob.
pub(crate) fn build_key_params_publish_body(
    params_b64: &str,
    proof: &str,
    challenge: &str,
) -> serde_json::Value {
    serde_json::json!({
        "keyParams": params_b64,
        "passphraseProof": proof,
        "challenge": challenge,
    })
}

/// Challenge then `PUT /vault/{ws}/key-params` with the raw-file-bytes base64
/// blob, a proof over that blob, and the (non-proof) challenge. Port of
/// `publishCloudKeyParams` (`vault-key-params.js:74-96`).
pub(crate) async fn publish_cloud_key_params(
    app: &AppHandle,
    client: &CloudClient,
    workspace_id: &str,
    params_b64: &str,
) -> Result<(), CloudFail> {
    let passphrase = {
        let state = app.state::<AppState>();
        let inner = state.inner();
        inner
            .cache
            .secure_blobs
            .fetch_blob(inner, "encryptionPassphraseBlob")
            .map_err(CloudFail::Fatal)?
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                CloudFail::Fatal(AppError::Other(
                    "sync: no passphrase in secure storage".into(),
                ))
            })?
    };

    let challenge_resp: serde_json::Value = client
        .post_json(&vault_challenge_path(workspace_id), &serde_json::json!({}))
        .await?;
    let challenge = challenge_resp
        .get("challenge")
        .and_then(|c| c.as_str())
        .unwrap_or_default()
        .to_string();
    let proof = vault_proof_impl(&passphrase, workspace_id, params_b64);
    let body = build_key_params_publish_body(params_b64, &proof, &challenge);
    client
        .put_json(&vault_key_params_path(workspace_id), &body)
        .await?;
    crate::rs_log!("[sync::vault] vault key params published");
    Ok(())
}

#[derive(Deserialize)]
struct KeyParamsResp {
    #[serde(rename = "keyParams", default)]
    key_params: Option<String>,
}

/// `GET /vault/{ws}/key-params` -> `result.keyParams` (base64 of the raw file
/// bytes). A 404 is `Ok(None)`; every other error propagates. Port of
/// `fetchCloudKeyParams` (`vault-key-params.js:98-136`), minus the JS
/// local-file write/cache (the caller decides what to do with the blob).
pub(crate) async fn fetch_cloud_key_params(
    client: &CloudClient,
    workspace_id: &str,
) -> Result<Option<String>, CloudFail> {
    let resp: Option<KeyParamsResp> = client
        .get_json_opt(&vault_key_params_path(workspace_id))
        .await?;
    Ok(resp.and_then(|r| r.key_params))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_params_path_encodes_like_encode_uri_component() {
        // JS `encodeURIComponent`: space/%20, '/'/%2F, 'é'/%C3%A9, '😀'/%F0%9F%98%80.
        assert_eq!(
            vault_key_params_path("work space/é😀"),
            "/vault/work%20space%2F%C3%A9%F0%9F%98%80/key-params"
        );
        assert_eq!(
            vault_challenge_path("work space/é😀"),
            "/vault/work%20space%2F%C3%A9%F0%9F%98%80/challenge"
        );
        // Unreserved chars pass through untouched, byte-identical to JS.
        assert_eq!(
            vault_key_params_path("a'b!c~d(e)*f"),
            "/vault/a'b!c~d(e)*f/key-params"
        );
    }

    #[test]
    fn publish_body_has_exactly_three_keys_sourced_from_arguments() {
        let body = build_key_params_publish_body("QkxPQg==", "UFJPT0Y=", "Y2g=");
        assert_eq!(
            body,
            serde_json::json!({
                "keyParams": "QkxPQg==",
                "passphraseProof": "UFJPT0Y=",
                "challenge": "Y2g=",
            })
        );
        assert_eq!(body.as_object().unwrap().len(), 3);
        // Proof comes from the proof argument, not the params blob.
        let clash = build_key_params_publish_body("same", "different", "same");
        assert_eq!(clash["passphraseProof"], "different");
        assert_ne!(clash["passphraseProof"], clash["keyParams"]);
    }
}
