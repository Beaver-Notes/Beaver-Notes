use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct WrapRequest {
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WrapResponse {
    pub blob: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UnwrapRequest {
    pub blob: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UnwrapResponse {
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HasKeyResponse {
    pub has_key: bool,
}
