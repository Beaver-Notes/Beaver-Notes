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
            return Err(status_fail(status));
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
            return Err(status_fail(status));
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

async fn decode_json<T: DeserializeOwned>(resp: reqwest::Response) -> Result<T, CloudFail> {
    let status = resp.status();
    if let Some(fail) = map_status(status) {
        return Err(fail);
    }
    if !status.is_success() {
        return Err(status_fail(status));
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
        return Err(status_fail(status));
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
        return Err(status_fail(status));
    }
    let bytes = resp.bytes().await.map_err(|e| map_reqwest_error(&e))?;
    Ok(Some(bytes.to_vec()))
}

fn ensure_success(resp: &reqwest::Response) -> Result<(), CloudFail> {
    let status = resp.status();
    if let Some(fail) = map_status(status) {
        return Err(fail);
    }
    if !status.is_success() {
        return Err(status_fail(status));
    }
    Ok(())
}

fn status_fail(status: reqwest::StatusCode) -> CloudFail {
    CloudFail::Fatal(AppError::Other(format!(
        "sync: cloud request failed with status {status}"
    )))
}

pub(crate) fn map_status(status: reqwest::StatusCode) -> Option<CloudFail> {
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        Some(CloudFail::Unauthorized)
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
            Some(CloudFail::Unauthorized)
        ));
        assert!(map_status(StatusCode::OK).is_none());
        assert!(map_status(StatusCode::NOT_FOUND).is_none());
    }
}
