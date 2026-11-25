use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<SafeAreaInsetsCss<R>> {
    Ok(SafeAreaInsetsCss(app.clone()))
}

/// Access to the safe-area-insets-css APIs.
pub struct SafeAreaInsetsCss<R: Runtime>(AppHandle<R>);

impl<R: Runtime> SafeAreaInsetsCss<R> {
    pub fn get_top_inset(&self) -> crate::Result<GetInsetResponse> {
        Ok(GetInsetResponse { inset: 0.0 })
    }

    pub fn get_bottom_inset(&self) -> crate::Result<GetInsetResponse> {
        Ok(GetInsetResponse { inset: 0.0 })
    }

    pub fn get_fold_state(&self) -> crate::Result<FoldState> {
        Ok(FoldState::unknown())
    }

    pub fn set_scribble_enabled(&self, _enabled: bool) -> crate::Result<()> {
        Ok(())
    }

    pub fn set_scribble_targets(
        &self,
        _targets: Vec<ScribbleTargetRect>,
    ) -> crate::Result<()> {
        Ok(())
    }
}
