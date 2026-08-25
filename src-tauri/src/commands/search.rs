use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::storage::storage_aad;
use crate::shared::*;

#[derive(Serialize, specta::Type, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchEntry {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) search_text: String,
    pub(crate) labels_text: String,
}

/// Extract search index data from all notes in the data store.
/// Runs off-main-thread via `spawn_blocking` so the UI stays responsive.
/// Returns a flat array of `{ id, title, searchText, labelsText }` entries
/// ready for MiniSearch to consume on the JS side.
#[tauri::command]
#[specta::specta]
pub(crate) async fn search_extract_index_data(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<SearchEntry>, AppError> {
    let pool = data_pool(&app, &state)?;
    let app_key = current_app_key(state.inner())?;
    let kv_key = kv_encryption_key(state.inner())?;
    let key_id = state
        .inner()
        .crypto
        .session
        .read()
        .map_err(AppError::from)?
        .current_items_key_id
        .clone();

    tokio::task::spawn_blocking(move || {
        let flat = crate::db::db_all(&pool, kv_key)?;
        let mut entries = Vec::new();

        for (row_key, raw_value) in &flat {
            // Only process note rows (keys starting with "notes.")
            if !row_key.starts_with("notes.") {
                continue;
            }

            // Decrypt the note envelope
            let decrypted = if let Some(ref key) = app_key {
                match decrypt_json_from_storage(key, raw_value, &storage_aad(row_key)) {
                    Ok(Some(v)) => v,
                    Ok(None) => raw_value.clone(),
                    Err(_) => continue, // skip un-decryptable notes
                }
            } else {
                raw_value.clone()
            };

            let obj = match decrypted.as_object() {
                Some(o) => o,
                None => continue,
            };

            // Skip locked notes
            if obj.get("isLocked").and_then(|v| v.as_bool()).unwrap_or(false) {
                continue;
            }

            let id = obj
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();

            if id.is_empty() {
                continue;
            }

            // Skip notes with encrypted content
            if obj
                .get("content")
                .is_some_and(is_encrypted_json_value)
            {
                continue;
            }

            let title = obj
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();

            let search_text = obj
                .get("searchText")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();

            let labels_text = obj
                .get("labels")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();

            entries.push(SearchEntry {
                id,
                title,
                search_text,
                labels_text,
            });
        }

        Ok(entries)
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

fn is_encrypted_json_value(v: &serde_json::Value) -> bool {
    v.as_object()
        .and_then(|m| m.get("ae"))
        .and_then(|v| v.as_u64())
        == Some(4)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_encrypted_json_value_detects_envelope() {
        assert!(is_encrypted_json_value(&serde_json::json!({"ae": 4, "ct": "x"})));
        assert!(!is_encrypted_json_value(&serde_json::json!({"type": "doc"})));
        assert!(!is_encrypted_json_value(&serde_json::json!("plain string")));
    }
}
