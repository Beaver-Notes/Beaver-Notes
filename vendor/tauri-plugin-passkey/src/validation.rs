use base64urlsafedata::Base64UrlSafeData;
use tauri::Url;

/// Enforce the WebAuthn client rule that the relying party id must be the
/// origin's effective domain or a registrable suffix of it, and that the
/// origin is a secure context. Without this check, any code running in the
/// webview could request credentials for an arbitrary third-party site.
///
/// Limitation: we do not consult the Public Suffix List, so an app whose
/// webview is compromised could still use an rp_id like "com". Browsers
/// reject that; we accept it. Documented trade-off to avoid a PSL dependency.
pub fn validate_rp_id(origin: &Url, rp_id: &str) -> crate::Result<()> {
    let host = origin
        .host_str()
        .ok_or_else(|| validation_error("origin must have a host"))?;

    let is_loopback = matches!(host, "localhost" | "127.0.0.1" | "[::1]");
    match origin.scheme() {
        "https" => {}
        "http" if is_loopback => {}
        scheme => {
            return Err(validation_error(&format!(
                "origin scheme must be https (or http on loopback), got {scheme}"
            )))
        }
    }

    if rp_id.is_empty() {
        return Err(validation_error("rpId must not be empty"));
    }

    let matches_rp = match origin.domain() {
        Some(domain) => domain == rp_id || domain.ends_with(&format!(".{rp_id}")),
        // IP-address origins get no suffix matching: "1.2.3.4" must not
        // satisfy rp_id "3.4".
        None => host == rp_id,
    };
    if matches_rp {
        Ok(())
    } else {
        Err(validation_error(&format!(
            "rpId {rp_id:?} is not a registrable suffix of origin host {host:?}"
        )))
    }
}

fn validation_error(msg: &str) -> crate::Error {
    crate::Error::Validation(msg.to_string())
}

/// Build the clientDataJSON bytes the way a browser would: `origin` is the
/// ASCII serialization of the URL's origin (scheme://host[:port], no path,
/// no trailing slash). Serializing a `Url` directly appends "/" and breaks
/// servers that string-compare expectedOrigin.
// Used only by the ctap2 (Linux) backend; kept in the always-compiled validation
// module so its unit tests run on every platform. #[allow] rather than a cfg gate
// avoids gating those cross-platform tests.
#[allow(dead_code)]
pub fn build_client_data(
    type_: &str,
    challenge: &Base64UrlSafeData,
    origin: &Url,
) -> crate::Result<Vec<u8>> {
    serde_json::to_vec(&serde_json::json!({
      "type": type_,
      "challenge": challenge,
      "origin": origin.origin().ascii_serialization(),
      "crossOrigin": false,
    }))
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn accepts_exact_host_match() {
        assert!(validate_rp_id(&url("https://example.com"), "example.com").is_ok());
    }

    #[test]
    fn accepts_registrable_suffix() {
        assert!(validate_rp_id(&url("https://app.login.example.com"), "example.com").is_ok());
    }

    #[test]
    fn rejects_unrelated_domain() {
        assert!(validate_rp_id(&url("https://example.com"), "github.com").is_err());
    }

    #[test]
    fn rejects_partial_label_suffix() {
        // "evil-example.com" ends with the *string* "example.com" but not on a
        // dot boundary — must be rejected.
        assert!(validate_rp_id(&url("https://evil-example.com"), "example.com").is_err());
    }

    #[test]
    fn rejects_plain_http() {
        assert!(validate_rp_id(&url("http://example.com"), "example.com").is_err());
    }

    #[test]
    fn accepts_http_localhost() {
        assert!(validate_rp_id(&url("http://localhost:1420"), "localhost").is_ok());
    }

    #[test]
    fn rejects_ip_suffix_trick() {
        assert!(validate_rp_id(&url("https://1.2.3.4"), "3.4").is_err());
    }

    #[test]
    fn accepts_exact_ip_match() {
        assert!(validate_rp_id(&url("https://127.0.0.1"), "127.0.0.1").is_ok());
    }

    #[test]
    fn rejects_empty_rp_id() {
        assert!(validate_rp_id(&url("https://example.com"), "").is_err());
    }

    #[test]
    fn client_data_origin_has_no_trailing_slash() {
        let challenge = Base64UrlSafeData::from(vec![1u8, 2, 3]);
        let bytes =
            build_client_data("webauthn.create", &challenge, &url("https://example.com")).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["origin"], "https://example.com");
        assert_eq!(v["type"], "webauthn.create");
        assert_eq!(v["challenge"], "AQID"); // base64url of [1,2,3], no padding
        assert_eq!(v["crossOrigin"], false);
    }

    #[test]
    fn client_data_origin_keeps_port() {
        let challenge = Base64UrlSafeData::from(vec![9u8]);
        let bytes =
            build_client_data("webauthn.get", &challenge, &url("http://localhost:1420")).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["origin"], "http://localhost:1420");
    }
}
