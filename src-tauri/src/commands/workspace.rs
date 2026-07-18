use tauri::{AppHandle, State};

use crate::shared::*;

/// Return all registered workspaces.
#[tauri::command]
pub(crate) fn workspace_list(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceInfo>, AppError> {
    Ok(load_workspace_registry(&app, &state)?)
}

/// Return the currently active workspace.
#[tauri::command]
pub(crate) fn workspace_get_active(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WorkspaceInfo, AppError> {
    let id = current_workspace_id(&app, &state)?;
    let registry = load_workspace_registry(&app, &state)?;
    let ws = registry
        .into_iter()
        .find(|w| w.id == id)
        .unwrap_or(WorkspaceInfo {
            id: id.clone(),
            name: DEFAULT_WORKSPACE_NAME.to_string(),
            created_at: String::new(),
        });
    Ok(ws)
}

/// Create a new workspace and switch to it.
#[tauri::command]
pub(crate) fn workspace_create(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    copy_settings: Option<bool>,
) -> Result<WorkspaceInfo, AppError> {
    let slug = slugify(&name);
    let id = unique_id(&app, &state, &slug)?;

    let ws_dir = workspace_root(&app, &state)?.join(&id);
    std::fs::create_dir_all(&ws_dir)?;

    // Create the data.db for the new workspace
    let data_path = ws_dir.join("data.db");
    let _pool = crate::db::open_pool(&data_path)?;

    // Create settings.db for the new workspace
    let settings_path = ws_dir.join("settings.db");
    let new_settings_pool = crate::db::open_pool(&settings_path)?;

    // Optionally copy all settings from the current workspace
    if copy_settings.unwrap_or(false) {
        if let Ok(current_pool) = settings_pool(&app, &state) {
            if let Ok(all_settings) = crate::db::db_all(&current_pool) {
                let _ = crate::db::db_replace_all(&new_settings_pool, all_settings);
            }
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    let ws = WorkspaceInfo {
        id: id.clone(),
        name,
        created_at: now,
    };

    let mut registry = load_workspace_registry(&app, &state)?;
    registry.push(ws.clone());
    save_workspace_registry(&app, &state, &registry)?;

    // Switch to the new workspace
    save_active_workspace_id(&app, &state, &id)?;
    swap_data_pool(&app, &state, &id)?;
    swap_settings_pool(&app, &state, &id)?;

    Ok(ws)
}

/// Switch the active workspace. The frontend must reload stores after this.
#[tauri::command]
pub(crate) fn workspace_switch(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let registry = load_workspace_registry(&app, &state)?;
    if !registry.iter().any(|w| w.id == id) {
        return Err(AppError::Other(format!("Workspace not found: {id}")));
    }
    let ws_dir = workspace_root(&app, &state)?.join(&id);
    if !ws_dir.exists() {
        return Err(AppError::Other(format!("Workspace directory missing: {id}")));
    }
    save_active_workspace_id(&app, &state, &id)?;
    swap_data_pool(&app, &state, &id)?;
    swap_settings_pool(&app, &state, &id)?;
    Ok(())
}

/// Rename a workspace.
#[tauri::command]
pub(crate) fn workspace_rename(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), AppError> {
    let mut registry = load_workspace_registry(&app, &state)?;
    let ws = registry
        .iter_mut()
        .find(|w| w.id == id)
        .ok_or_else(|| AppError::Other(format!("Workspace not found: {id}")))?;
    ws.name = name;
    save_workspace_registry(&app, &state, &registry)?;
    Ok(())
}

/// Delete a workspace. Cannot delete the currently active workspace.
/// The workspace directory and all its data are removed.
#[tauri::command]
pub(crate) fn workspace_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    if id == DEFAULT_WORKSPACE_ID {
        return Err(AppError::Other("Cannot delete the default workspace".into()));
    }
    let active_id = current_workspace_id(&app, &state)?;
    if id == active_id {
        return Err(AppError::Other("Cannot delete the currently active workspace".into()));
    }

    let ws_dir = workspace_root(&app, &state)?.join(&id);
    if ws_dir.exists() {
        std::fs::remove_dir_all(&ws_dir)?;
    }

    let mut registry = load_workspace_registry(&app, &state)?;
    registry.retain(|w| w.id != id);
    save_workspace_registry(&app, &state, &registry)?;
    Ok(())
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn slugify(name: &str) -> String {
    let slug: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    // Collapse consecutive dashes and trim leading/trailing dashes
    let mut result = String::with_capacity(slug.len());
    let mut prev_dash = false;
    for c in slug.chars() {
        if c == '-' {
            if !prev_dash && !result.is_empty() {
                result.push(c);
            }
            prev_dash = true;
        } else {
            result.push(c);
            prev_dash = false;
        }
    }
    if result.is_empty() {
        "workspace".to_string()
    } else {
        result
    }
}

fn unique_id(app: &AppHandle, state: &AppState, slug: &str) -> Result<String, AppError> {
    let registry = load_workspace_registry(app, state)?;
    let existing: Vec<&str> = registry.iter().map(|w| w.id.as_str()).collect();
    if !existing.contains(&slug) {
        return Ok(slug.to_string());
    }
    for i in 2..1000 {
        let candidate = format!("{slug}-{i}");
        if !existing.contains(&candidate.as_str()) {
            return Ok(candidate);
        }
    }
    Err(AppError::Other("Too many workspaces with similar names".into()))
}
