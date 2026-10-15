use serde::{de::DeserializeOwned, Serialize};

use super::cloud::{CloudFail, SyncError};
use crate::shared::AppError;

const TIMEOUT_SECS: u64 = 60;

/// Shared cloud HTTP client: base URL + bearer token, typed `CloudFail`
/// mapping, and helpers for the JSON and raw-byte endpoints the asset/seed/
/// bootstrap paths build on.
pub(crate) struct CloudClient {
    client: reqwest::Client,
    base: String,
    token: String,
}

impl CloudClient {
    pub(crate) fn new(server_url: &str, token: &str) -> Result<Self, AppError> {
        let client = reqwest::Client::builder()
            .use_rustls_tls()
            .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
            .build()
            .map_err(|e| AppError::Other(format!("sync: http client: {e}")))?;
        Ok(Self {
            client,
            base: server_url.trim_end_matches('/').to_string(),
            token: token.to_string(),
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }

    pub(crate) async fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T, CloudFail> {
        let resp = self
            .client
            .get(self.url(path))
            .bearer_auth(&self.token)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|e| map_reqwest_error(&e))?;
        decode_json(resp).await
    }

    /// Like [`get_json`], but a 404 is `Ok(None)` instead of an error.
    pub(crate) async fn get_json_opt<T: DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<Option<T>, CloudFail> {
        let resp = self
            .client
            .get(self.url(path))
            .bearer_auth(&self.token)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|e| map_reqwest_error(&e))?;
        decode_json_opt(resp).await
    }

    pub(crate) async fn post_json<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, CloudFail> {
        let payload = serde_json::to_string(body)
            .map_err(|e| CloudFail::Fatal(AppError::Serialization(e.to_string())))?;
        let resp = self
            .client
            .post(self.url(path))
            .bearer_auth(&self.token)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::ACCEPT, "application/json")
            .body(payload)
            .send()
            .await
            .map_err(|e| map_reqwest_error(&e))?;
        decode_json(resp).await
    }

    /// JSON `PUT` with bearer auth; only the status matters (the vault
    /// key-params publish ignores its response body, like the JS client).
    pub(crate) async fn put_json<B: Serialize>(&self, path: &str, body: &B) -> Result<(), CloudFail> {
        let payload = serde_json::to_string(body)
            .map_err(|e| CloudFail::Fatal(AppError::Serialization(e.to_string())))?;
        let resp = self
            .client
            .put(self.url(path))
            .bearer_auth(&self.token)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::ACCEPT, "application/json")
            .body(payload)
            .send()
            .await
            .map_err(|e| map_reqwest_error(&e))?;
        ensure_success(&resp)
    }

    pub(crate) async fn put_bytes(&self, path: &str, bytes: Vec<u8>) -> Result<(), CloudFail> {
        let status = self.put_bytes_with_status(path, bytes).await?;
        if !status.is_success() {
            return Err(status_fail(&self.url(path), status));
        }
        Ok(())
    }

    /// Same request as [`put_bytes`], but returns the raw status for any
    /// non-gate response (e.g. 413) instead of collapsing it to an error.
    /// Gate statuses (401/403/429/5xx) and connect/timeout still error.
    pub(crate) async fn put_bytes_with_status(
        &self,
        path: &str,
        bytes: Vec<u8>,
    ) -> Result<reqwest::StatusCode, CloudFail> {
        let resp = self
            .client
            .put(self.url(path))
            .bearer_auth(&self.token)
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(bytes)
            .send()
            .await
            .map_err(|e| map_reqwest_error(&e))?;
        let status = resp.status();
        if let Some(fail) = map_status(status) {
            return Err(fail);
        }
        Ok(status)
    }

    pub(crate) async fn get_bytes(&self, path: &str) -> Result<Option<Vec<u8>>, CloudFail> {
        let resp = self
            .client
            .get(self.url(path))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|e| map_reqwest_error(&e))?;
        decode_bytes(resp).await
    }

    /// Authenticated `DELETE`; a 404 is already-gone and therefore `Ok`.
    pub(crate) async fn delete(&self, path: &str) -> Result<(), CloudFail> {
        let resp = self
            .client
            .delete(self.url(path))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|e| map_reqwest_error(&e))?;
        let status = resp.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(());
        }
        if let Some(fail) = map_status(status) {
            return Err(fail);
        }
        if !status.is_success() {
            return Err(status_fail(resp.url().as_str(), status));
        }
        Ok(())
    }

    /// Presigned S3-style PUT: absolute URL, no bearer header.
    pub(crate) async fn put_presigned(&self, url: &str, bytes: Vec<u8>) -> Result<(), CloudFail> {
        let resp = self
            .client
            .put(url)
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(bytes)
            .send()
            .await
            .map_err(|e| map_reqwest_error(&e))?;
        ensure_success(&resp)
    }

    /// Presigned S3-style GET: absolute URL, no bearer header.
    pub(crate) async fn get_presigned(&self, url: &str) -> Result<Option<Vec<u8>>, CloudFail> {
        let resp = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| map_reqwest_error(&e))?;
        decode_bytes(resp).await
    }
}

/// 401/403 arrive as a bare `Unauthorized` with no endpoint and no server
/// message, which makes every auth failure look identical in the log. The
/// server already returns a distinguishing `error` string, so read the body
/// before discarding the response and name both.
/// Snapshot-promote is owner-only (`requireWorkspaceOwner` on the server); a
/// non-owner's 403 is permanent for this identity, so arm the session skip
/// instead of re-logging the same rejection on every compaction.
fn is_owner_only_promote_rejection(url: &str, body: &str) -> bool {
    url.contains("/snapshot-promote") && body.contains("not_workspace_owner")
}

async fn log_auth_failure(resp: reqwest::Response) {
    let url = resp.url().as_str().to_string();
    let body = resp
        .text()
        .await
        .map(|t| t.chars().take(200).collect::<String>())
        .unwrap_or_else(|e| format!("<body unreadable: {e}>"));
    crate::rs_log!("[sync::remote] auth rejected at {url}: {body}");
    if is_owner_only_promote_rejection(&url, &body) {
        super::scheduler::note_promote_forbidden();
    }
}

async fn decode_json<T: DeserializeOwned>(resp: reqwest::Response) -> Result<T, CloudFail> {
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        log_auth_failure(resp).await;
        // Let map_status decide: 401 is a dead session, 403 is a permission no.
        return Err(map_status(status).unwrap_or(CloudFail::Unauthorized));
    }
    if let Some(fail) = map_status(status) {
        return Err(fail);
    }
    if !status.is_success() {
        return Err(status_fail(resp.url().as_str(), status));
    }
    let text = resp.text().await.map_err(|e| map_reqwest_error(&e))?;
    serde_json::from_str(&text).map_err(|e| CloudFail::Fatal(AppError::Serialization(e.to_string())))
}

async fn decode_json_opt<T: DeserializeOwned>(
    resp: reqwest::Response,
) -> Result<Option<T>, CloudFail> {
    let status = resp.status();
    if let Some(fail) = map_status(status) {
        return Err(fail);
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(status_fail(resp.url().as_str(), status));
    }
    let text = resp.text().await.map_err(|e| map_reqwest_error(&e))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| CloudFail::Fatal(AppError::Serialization(e.to_string())))
}

async fn decode_bytes(resp: reqwest::Response) -> Result<Option<Vec<u8>>, CloudFail> {
    let status = resp.status();
    if let Some(fail) = map_status(status) {
        return Err(fail);
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(status_fail(resp.url().as_str(), status));
    }
    let bytes = resp.bytes().await.map_err(|e| map_reqwest_error(&e))?;
    Ok(Some(bytes.to_vec()))
}

fn ensure_success(resp: &reqwest::Response) -> Result<(), CloudFail> {
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        // The vault key-params publish is the only authed call routed here, and
        // `map_status` used to collapse it to a bare `Unauthorized` with no
        // endpoint named - so a dead session looked identical to any other 401.
        // Name the url, and let map_status keep 401 dead-session and 403
        // permission apart, while `is_conflict`'s "status 409" match still holds.
        crate::rs_log!(
            "[sync::remote] auth rejected at {} ({status})",
            resp.url()
        );
        return Err(map_status(status).unwrap_or(CloudFail::Unauthorized));
    }
    if let Some(fail) = map_status(status) {
        return Err(fail);
    }
    if !status.is_success() {
        return Err(status_fail(resp.url().as_str(), status));
    }
    Ok(())
}

/// Names the endpoint in the error: without the url a 409 from the
/// initialization handshake is indistinguishable from any other 409, and the
/// sync banner then reports a bare status with no hint which call failed.
fn status_fail(url: &str, status: reqwest::StatusCode) -> CloudFail {
    CloudFail::Fatal(AppError::Other(format!(
        "sync: {url} failed with status {status}"
    )))
}

pub(crate) fn map_status(status: reqwest::StatusCode) -> Option<CloudFail> {
    if status == reqwest::StatusCode::UNAUTHORIZED {
        Some(CloudFail::Unauthorized)
    } else if status == reqwest::StatusCode::FORBIDDEN {
        // 403 answers "may this device do this", not "is this credential alive".
        // Collapsing it into `Unauthorized` made viewers and expelled members
        // read "Session expired. Sign in again." for a permission failure.
        Some(CloudFail::Typed(SyncError::Forbidden))
    } else if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
        Some(CloudFail::Typed(SyncError::Throttled))
    } else {
        None
    }
}

pub(crate) fn map_reqwest_error(err: &reqwest::Error) -> CloudFail {
    if err.is_connect() || err.is_timeout() {
        CloudFail::Typed(SyncError::Offline)
    } else {
        CloudFail::Fatal(AppError::Other(format!("sync: http: {err}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::StatusCode;

    #[test]
    fn maps_status_to_gates() {
        assert!(matches!(
            map_status(StatusCode::TOO_MANY_REQUESTS),
            Some(CloudFail::Typed(SyncError::Throttled))
        ));
        assert!(matches!(
            map_status(StatusCode::INTERNAL_SERVER_ERROR),
            Some(CloudFail::Typed(SyncError::Throttled))
        ));
        assert!(matches!(
            map_status(StatusCode::UNAUTHORIZED),
            Some(CloudFail::Unauthorized)
        ));
        assert!(matches!(
            map_status(StatusCode::FORBIDDEN),
            Some(CloudFail::Typed(SyncError::Forbidden))
        ));
        assert!(map_status(StatusCode::OK).is_none());
        assert!(map_status(StatusCode::NOT_FOUND).is_none());
    }
}
