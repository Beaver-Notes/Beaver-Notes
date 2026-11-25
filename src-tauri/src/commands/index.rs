use tauri::State;

use crate::shared::*;

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IndexSnapshot {
    pub(crate) search_json: String,
    pub(crate) links_json: String,
    pub(crate) signatures_json: String,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn index_save(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    search_json: String,
    links_json: String,
    signatures_json: String,
) -> Result<(), AppError> {
    let pool = data_pool(&app, &state)?;
    // Index mirrors content: never write plaintext while locked.
    let enc_key = kv_encryption_key(&state)?;
    tokio::task::spawn_blocking(move || {
        crate::db::db_set(&pool, "_index:search", &search_json, enc_key)?;
        crate::db::db_set(&pool, "_index:links", &links_json, enc_key)?;
        crate::db::db_set(&pool, "_index:signatures", &signatures_json, enc_key)?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn index_load(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<IndexSnapshot>, AppError> {
    let pool = data_pool(&app, &state)?;
    let enc_key = kv_encryption_key(&state)?;
    tokio::task::spawn_blocking(move || {
        let search = crate::db::db_get(&pool, "_index:search", enc_key)?;
        let links = crate::db::db_get(&pool, "_index:links", enc_key)?;
        let sigs = crate::db::db_get(&pool, "_index:signatures", enc_key)?;
        if search.is_none() && links.is_none() {
            return Ok(None);
        }
        Ok(Some(IndexSnapshot {
            search_json: search.unwrap_or_default(),
            links_json: links.unwrap_or_default(),
            signatures_json: sigs.unwrap_or_default(),
        }))
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}
