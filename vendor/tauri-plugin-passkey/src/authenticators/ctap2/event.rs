use authenticator::{ctap2::server::PublicKeyCredentialUserEntity, StatusPinUv, StatusUpdate};
use base64::{prelude::BASE64_URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};

/// Nearly identical to the `StatusUpdate` enum, but serializable
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum WebauthnEvent {
    SelectDevice,
    PresenceRequired,
    PinEvent { event: PinEvent },
    SelectKey { keys: Vec<SelectKeyUser> },
}

/// User entry offered to the frontend for key selection. `id` is the
/// credential user handle, base64url-encoded (unpadded) — the crate's own
/// type would serialize it as a JSON number array, which does not match the
/// TS `AuthKey` type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectKeyUser {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

impl From<PublicKeyCredentialUserEntity> for SelectKeyUser {
    fn from(user: PublicKeyCredentialUserEntity) -> Self {
        SelectKeyUser {
            id: BASE64_URL_SAFE_NO_PAD.encode(&user.id),
            name: user.name,
            display_name: user.display_name,
        }
    }
}

/// Nearly identical to the `StatusPinUv` enum, but serializable
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum PinEvent {
    PinRequired,
    InvalidPin { attempts_remaining: Option<u8> },
    PinAuthBlocked,
    PinBlocked,
    InvalidUv { attempts_remaining: Option<u8> },
    UvBlocked,
    PinIsTooShort,
    PinIsTooLong { max_length: usize },
    PinNotSet,
}

impl WebauthnEvent {
    /// Returns `None` for status updates that have no user-facing equivalent
    /// (interactive token management, which this plugin does not drive).
    pub fn from_status(status: StatusUpdate) -> Option<Self> {
        match status {
            StatusUpdate::SelectDeviceNotice => Some(WebauthnEvent::SelectDevice),
            StatusUpdate::PresenceRequired => Some(WebauthnEvent::PresenceRequired),
            StatusUpdate::PinUvError(event) => Some(WebauthnEvent::PinEvent {
                event: event.into(),
            }),
            StatusUpdate::SelectResultNotice(.., users) => Some(WebauthnEvent::SelectKey {
                keys: users.into_iter().map(Into::into).collect(),
            }),
            StatusUpdate::InteractiveManagement(..) => None,
        }
    }
}

impl From<StatusPinUv> for PinEvent {
    fn from(status: StatusPinUv) -> Self {
        match status {
            StatusPinUv::PinRequired(..) => PinEvent::PinRequired,
            StatusPinUv::InvalidPin(.., attempts) => PinEvent::InvalidPin {
                attempts_remaining: attempts,
            },
            StatusPinUv::PinAuthBlocked => PinEvent::PinAuthBlocked,
            StatusPinUv::PinBlocked => PinEvent::PinBlocked,
            StatusPinUv::InvalidUv(attempts) => PinEvent::InvalidUv {
                attempts_remaining: attempts,
            },
            StatusPinUv::UvBlocked => PinEvent::UvBlocked,
            StatusPinUv::PinIsTooShort => PinEvent::PinIsTooShort,
            StatusPinUv::PinIsTooLong(max_length) => PinEvent::PinIsTooLong { max_length },
            StatusPinUv::PinNotSet => PinEvent::PinNotSet,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    #[test]
    fn select_key_user_encodes_id_as_unpadded_base64url() {
        let user = PublicKeyCredentialUserEntity {
            id: vec![1, 2, 3],
            name: Some("alice".to_string()),
            display_name: Some("Alice".to_string()),
        };
        let sk: SelectKeyUser = user.into();
        assert_eq!(sk.id, "AQID");
        assert_eq!(sk.name.as_deref(), Some("alice"));
        assert_eq!(sk.display_name.as_deref(), Some("Alice"));
    }

    #[test]
    fn from_status_maps_simple_notices() {
        assert!(matches!(
            WebauthnEvent::from_status(StatusUpdate::SelectDeviceNotice),
            Some(WebauthnEvent::SelectDevice)
        ));
        assert!(matches!(
            WebauthnEvent::from_status(StatusUpdate::PresenceRequired),
            Some(WebauthnEvent::PresenceRequired)
        ));
    }

    #[test]
    fn from_status_wraps_pin_errors() {
        let ev = WebauthnEvent::from_status(StatusUpdate::PinUvError(StatusPinUv::PinIsTooShort));
        assert!(matches!(
            ev,
            Some(WebauthnEvent::PinEvent {
                event: PinEvent::PinIsTooShort
            })
        ));
    }

    #[test]
    fn from_status_maps_select_result_to_keys() {
        let (tx, _rx) = channel::<Option<usize>>();
        let users = vec![PublicKeyCredentialUserEntity {
            id: vec![4, 5, 6],
            name: None,
            display_name: None,
        }];
        let ev = WebauthnEvent::from_status(StatusUpdate::SelectResultNotice(tx, users));
        match ev {
            Some(WebauthnEvent::SelectKey { keys }) => {
                assert_eq!(keys.len(), 1);
                assert_eq!(keys[0].id, "BAUG");
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn pin_event_maps_variants_carrying_attempt_counts() {
        let (tx, _rx) = channel::<authenticator::Pin>();
        let ev: PinEvent = StatusPinUv::InvalidPin(tx, Some(2)).into();
        assert!(matches!(
            ev,
            PinEvent::InvalidPin {
                attempts_remaining: Some(2)
            }
        ));

        let ev: PinEvent = StatusPinUv::InvalidUv(Some(1)).into();
        assert!(matches!(
            ev,
            PinEvent::InvalidUv {
                attempts_remaining: Some(1)
            }
        ));

        let ev: PinEvent = StatusPinUv::PinIsTooLong(10).into();
        assert!(matches!(ev, PinEvent::PinIsTooLong { max_length: 10 }));
    }

    #[test]
    fn pin_event_maps_unit_variants() {
        let (tx, _rx) = channel::<authenticator::Pin>();
        assert!(matches!(
            PinEvent::from(StatusPinUv::PinRequired(tx)),
            PinEvent::PinRequired
        ));
        assert!(matches!(
            PinEvent::from(StatusPinUv::PinAuthBlocked),
            PinEvent::PinAuthBlocked
        ));
        assert!(matches!(
            PinEvent::from(StatusPinUv::PinBlocked),
            PinEvent::PinBlocked
        ));
        assert!(matches!(
            PinEvent::from(StatusPinUv::UvBlocked),
            PinEvent::UvBlocked
        ));
        assert!(matches!(
            PinEvent::from(StatusPinUv::PinNotSet),
            PinEvent::PinNotSet
        ));
    }

    #[test]
    fn webauthn_event_serializes_with_camelcase_type_tag() {
        // The frontend TS `WebauthnEventType`/`PinEventType` enums match on these
        // exact strings, so the serde shape is a cross-language contract.
        let json = serde_json::to_value(WebauthnEvent::PresenceRequired).unwrap();
        assert_eq!(json, serde_json::json!({ "type": "presenceRequired" }));

        let json = serde_json::to_value(WebauthnEvent::PinEvent {
            event: PinEvent::PinRequired,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "type": "pinEvent", "event": { "type": "pinRequired" } })
        );
    }

    #[test]
    fn select_key_user_skips_absent_optional_fields() {
        let json = serde_json::to_value(SelectKeyUser {
            id: "AQID".to_string(),
            name: None,
            display_name: None,
        })
        .unwrap();
        assert_eq!(json, serde_json::json!({ "id": "AQID" }));
    }
}
