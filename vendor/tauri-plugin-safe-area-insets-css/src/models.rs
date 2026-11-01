use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetInsetResponse {
    pub inset: f64,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetScribbleEnabledRequest {
    pub enabled: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScribbleTargetsRequest {
    pub targets: Vec<ScribbleTargetRect>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScribbleTargetRect {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

/// Fold geometry as reported by the platform. Rect values are in CSS pixels
/// (points on iOS, density-independent pixels on Android).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoldState {
    pub foldable: bool,
    /// "closed" | "half-open" | "open" | "flat" | "unknown"
    pub posture: String,
    pub hinge_angle: Option<f64>,
    /// "vertical" | "horizontal" | "none"
    pub orientation: String,
    pub crease: Option<FoldRect>,
    /// "left" | "right" | "none"
    pub vertical_bar_edge: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoldRect {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

impl FoldState {
    pub fn unknown() -> Self {
        Self {
            foldable: false,
            posture: "unknown".to_string(),
            hinge_angle: None,
            orientation: "none".to_string(),
            crease: None,
            vertical_bar_edge: "none".to_string(),
        }
    }
}
