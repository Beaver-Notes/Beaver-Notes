use tauri::{command, AppHandle, Runtime};

use crate::error::Result;
use crate::models::{DeleteDomainRequest, DeleteItemsRequest, IndexItemsRequest};
use crate::SpotSearchExt;

#[command]
pub async fn enable_indexing<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<()> {
    app.spotsearch().enable_indexing(enabled)
}

#[command]
pub async fn index_items<R: Runtime>(
    app: AppHandle<R>,
    items: Vec<crate::models::SpotItem>,
) -> Result<()> {
    app.spotsearch().index_items(IndexItemsRequest { items })
}

#[command]
pub async fn delete_items<R: Runtime>(
    app: AppHandle<R>,
    ids: Vec<String>,
) -> Result<()> {
    app.spotsearch().delete_items(DeleteItemsRequest { ids })
}

#[command]
pub async fn delete_domain<R: Runtime>(
    app: AppHandle<R>,
    domain: String,
) -> Result<()> {
    app.spotsearch().delete_domain(DeleteDomainRequest { domain })
}
