use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::Result;
use crate::SafeAreaInsetsCssExt;

#[command]
pub(crate) async fn get_top_inset<R: Runtime>(app: AppHandle<R>) -> Result<GetInsetResponse> {
    app.safe_area_insets_css().get_top_inset()
}

#[command]
pub(crate) async fn get_bottom_inset<R: Runtime>(app: AppHandle<R>) -> Result<GetInsetResponse> {
    app.safe_area_insets_css().get_bottom_inset()
}

#[command]
pub(crate) async fn set_scribble_enabled<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<()> {
    app.safe_area_insets_css().set_scribble_enabled(enabled)
}
