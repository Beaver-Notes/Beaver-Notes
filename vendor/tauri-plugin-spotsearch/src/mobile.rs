use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::error::Result;
use crate::models::{DeleteDomainRequest, DeleteItemsRequest, IndexItemsRequest};

tauri::ios_plugin_binding!(init_plugin_spotsearch);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<SpotSearch<R>> {
    let handle = api.register_ios_plugin(init_plugin_spotsearch)?;
    Ok(SpotSearch(handle))
}

pub struct SpotSearch<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> SpotSearch<R> {
    pub fn enable_indexing(&self, enabled: bool) -> Result<()> {
        self.0
            .run_mobile_plugin("enableIndexing", serde_json::json!({ "enabled": enabled }))
            .map_err(Into::into)
    }

    pub fn index_items(&self, request: IndexItemsRequest) -> Result<()> {
        self.0
            .run_mobile_plugin("indexItems", request)
            .map_err(Into::into)
    }

    pub fn delete_items(&self, request: DeleteItemsRequest) -> Result<()> {
        self.0
            .run_mobile_plugin("deleteItems", request)
            .map_err(Into::into)
    }

    pub fn delete_domain(&self, request: DeleteDomainRequest) -> Result<()> {
        self.0
            .run_mobile_plugin("deleteDomain", request)
            .map_err(Into::into)
    }
}
