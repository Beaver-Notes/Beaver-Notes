use serde::Serialize;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharesheetOptions {
    pub mime_type: Option<String>,
}

#[derive(Serialize)]
pub struct ShareTextPayload {
    pub text: String,
    #[serde(flatten)]
    pub options: SharesheetOptions,
}

#[derive(Serialize)]
pub struct ShareFilePayload {
    pub path: String,
    pub mime_type: Option<String>,
}
