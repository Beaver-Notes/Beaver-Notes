use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::shared::*;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchResult {
    pub(crate) ids: Vec<String>,
}

/// Full-text search across note titles and body text using the SQLite FTS5 index.
///
/// Returns the IDs of matching notes ordered by relevance (FTS5 `rank`).
/// The frontend resolves full note objects from the in-memory store using these IDs,
/// so this call never reads note content into Rust memory.
#[tauri::command]
pub(crate) fn search_notes(
    app: AppHandle,
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<SearchResult, String> {
    let pool = data_pool(&app, &state)?;
    let ids = crate::db::fts_search(pool, &query, limit.unwrap_or(200))?;
    Ok(SearchResult { ids })
}

/// Upsert a single note into the FTS index.
/// Called from the frontend every time a note is saved (title or content change).
/// `body` is a pre-extracted plain-text string built by the JS layer, so Rust
/// never has to deserialise the full ProseMirror JSON.
#[tauri::command]
pub(crate) fn search_index_note(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    title: String,
    body: String,
) -> Result<(), String> {
    let pool = data_pool(&app, &state)?;
    crate::db::fts_upsert(pool, &id, &title, &body)
}

/// Remove a note from the FTS index. Call when a note is deleted.
#[tauri::command]
pub(crate) fn search_remove_note(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let pool = data_pool(&app, &state)?;
    crate::db::fts_delete(pool, &id)
}

/// Rebuild the entire FTS index from the KV store.
/// Useful after a bulk import or first launch (the index will be empty until notes
/// are individually saved / indexed after startup).
#[tauri::command]
pub(crate) fn search_rebuild_index(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let pool = data_pool(&app, &state)?;
    crate::db::fts_rebuild(pool)
}
