use tauri::{AppHandle, State};

use crate::shared::*;

/// Persist a batch of activity entries (one is the common case). Growth is
/// capped per note inside `db::activity_append`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn activity_append(
    app: AppHandle,
    state: State<'_, AppState>,
    entries: Vec<ActivityEntry>,
) -> Result<(), AppError> {
    let pool = data_pool(&app, &state)?;
    tokio::task::spawn_blocking(move || crate::db::activity_append(&pool, &entries))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

/// Newest-first activity for a note. `before` is an exclusive epoch-ms cursor.
#[tauri::command]
#[specta::specta]
pub(crate) async fn activity_list(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: String,
    limit: Option<u32>,
    before: Option<i64>,
) -> Result<Vec<ActivityEntry>, AppError> {
    let pool = data_pool(&app, &state)?;
    let limit = limit.unwrap_or(200).clamp(1, 1000) as i64;
    tokio::task::spawn_blocking(move || crate::db::activity_list(&pool, &note_id, limit, before))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

/// Delete every activity entry for a note.
#[tauri::command]
#[specta::specta]
pub(crate) async fn activity_clear(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: String,
) -> Result<(), AppError> {
    let pool = data_pool(&app, &state)?;
    tokio::task::spawn_blocking(move || crate::db::activity_clear(&pool, &note_id))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}
