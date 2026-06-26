use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderRequest {
    /// Absolute path to the HTML file (already written to disk by Rust).
    pub html_path: String,
    /// Absolute path (or `file://` URL on iOS) where the PDF should
    /// be written.
    pub output_path: String,
    /// JavaScript source to evaluate inside the WebView once the HTML
    /// has loaded. It should return a JSON stringified array of
    /// keep-block descriptors.
    pub measure_script: String,
    /// Maximum time the helper is allowed to take, in milliseconds.
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

fn default_timeout_ms() -> u64 {
    30_000
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderResponse {
    /// JSON array of keep-block descriptors extracted from the page
    /// (already un-stringified). Empty if measurement failed.
    pub keep_blocks_json: String,
}

/// Request to copy a file into a scoped-storage destination.
/// Used when the save dialog returns a `scoped:<folder_id>/<path>`
/// URL that `std::fs` cannot write to directly.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteScopedRequest {
    /// Absolute path to the source file (in the app's temp directory).
    pub source_path: String,
    /// The scoped-storage destination, e.g. `scoped:<folder_id>/file.pdf`.
    pub scoped_output_path: String,
}
