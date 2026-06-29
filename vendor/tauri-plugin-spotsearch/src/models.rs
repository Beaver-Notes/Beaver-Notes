use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotItem {
    pub id: String,
    pub domain: String,
    pub title: String,
    pub snippet: Option<String>,
    pub keywords: Option<Vec<String>>,
    pub url: Option<String>,
    pub thumbnail_base64: Option<String>,
    pub extra: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexItemsRequest {
    pub items: Vec<SpotItem>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteItemsRequest {
    pub ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteDomainRequest {
    pub domain: String,
}
