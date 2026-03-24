use std::path::PathBuf;

#[cfg(not(target_os = "android"))]
use font_kit::source::SystemSource;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath, MessageDialogButtons, MessageDialogKind};

use crate::shared::*;

#[tauri::command]
pub(crate) async fn dialog_open(
    app: AppHandle,
    state: State<'_, AppState>,
    props: OpenDialogOptions,
) -> Result<DialogResult, String> {
    let app_clone = app.clone();
    let window = app.get_webview_window(MAIN_WINDOW_LABEL);
    let props_clone = props.clone();
    let result = tokio::task::spawn_blocking(move || -> Result<Vec<FilePath>, String> {
        let builder =
            configure_file_dialog(app_clone.dialog().file(), &props_clone, window.as_ref());
        let properties = props_clone.properties.unwrap_or_default();
        let multiple = props_clone
            .multiple
            .unwrap_or_else(|| properties.iter().any(|p| p == "multiSelections"));
        let wants_directory = props_clone
            .directory
            .unwrap_or_else(|| properties.iter().any(|p| p == "openDirectory"));

        #[cfg(desktop)]
        {
            let result = if wants_directory {
                if multiple {
                    builder.blocking_pick_folders().unwrap_or_default()
                } else {
                    builder
                        .blocking_pick_folder()
                        .map(|path| vec![path])
                        .unwrap_or_default()
                }
            } else if multiple {
                builder.blocking_pick_files().unwrap_or_default()
            } else {
                builder
                    .blocking_pick_file()
                    .map(|path| vec![path])
                    .unwrap_or_default()
            };
            Ok(result)
        }

        #[cfg(not(desktop))]
        {
            if wants_directory {
                return Err("Native directory picking is unavailable on mobile".into());
            }

            let result = if multiple {
                builder.blocking_pick_files().unwrap_or_default()
            } else {
                builder
                    .blocking_pick_file()
                    .map(|path| vec![path])
                    .unwrap_or_default()
            };
            Ok(result)
        }
    })
    .await
    .map_err(to_error)??;

    let trusted = dialog_file_paths_to_trusted_paths(&result);
    grant_dialog_paths(&state, &trusted);
    Ok(DialogResult {
        canceled: result.is_empty(),
        file_paths: dialog_file_paths_to_strings(result),
    })
}

#[tauri::command]
pub(crate) async fn dialog_message(
    app: AppHandle,
    props: MessageDialogOptions,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let kind = match props.kind.as_deref() {
            Some("warning") => MessageDialogKind::Warning,
            Some("error") => MessageDialogKind::Error,
            _ => MessageDialogKind::Info,
        };
        let title = props.title.unwrap_or_else(|| "Beaver Notes".into());
        let mut builder = app.dialog().message(props.message).title(title).kind(kind);
        if let Some(buttons) = props.buttons {
            if buttons.len() == 1 {
                builder = builder.buttons(MessageDialogButtons::OkCustom(buttons[0].clone()));
            } else if buttons.len() >= 2 {
                builder = builder.buttons(MessageDialogButtons::OkCancelCustom(
                    buttons[0].clone(),
                    buttons[1].clone(),
                ));
            }
        }
        let _ = builder.blocking_show();
    })
    .await
    .map_err(to_error)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn dialog_save(
    app: AppHandle,
    state: State<'_, AppState>,
    props: SaveDialogOptions,
) -> Result<SaveDialogResult, String> {
    let app_clone = app.clone();
    let window = app.get_webview_window(MAIN_WINDOW_LABEL);
    let props_clone = props.clone();
    let file_path = tokio::task::spawn_blocking(move || {
        let mut builder = app_clone.dialog().file();
        if let Some(title) = props_clone.title {
            builder = builder.set_title(title);
        }
        if let Some(default_path) = props_clone.default_path {
            let path = PathBuf::from(default_path.clone());
            if path.extension().is_some() {
                if let Some(parent) = path.parent() {
                    builder = builder.set_directory(parent);
                }
                if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
                    builder = builder.set_file_name(name);
                }
            } else {
                builder = builder.set_directory(default_path);
            }
        }
        #[cfg(desktop)]
        if let Some(window) = window.as_ref() {
            builder = builder.set_parent(window);
        }
        if let Some(filters) = props_clone.filters {
            for filter in filters {
                let exts = filter
                    .extensions
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                builder = builder.add_filter(filter.name, &exts);
            }
        }
        builder.blocking_save_file()
    })
    .await
    .map_err(to_error)?;

    if let Some(path) = file_path.as_ref().and_then(dialog_file_path_to_trusted_path) {
        grant_dialog_paths(&state, &[path]);
    }

    Ok(SaveDialogResult {
        canceled: file_path.is_none(),
        file_path: file_path.and_then(dialog_file_path_to_string),
    })
}

#[tauri::command]
pub(crate) fn get_system_fonts() -> Result<Vec<String>, String> {
    #[cfg(target_os = "android")]
    {
        return Ok(Vec::new());
    }

    #[cfg(not(target_os = "android"))]
    {
        let fonts = SystemSource::new()
            .all_families()
            .map_err(to_error)?
            .into_iter()
            .collect::<Vec<_>>();
        Ok(fonts)
    }
}

#[tauri::command]
pub(crate) async fn print_pdf(app: AppHandle, pdf_name: String) -> Result<(), String> {
    let default_path = path_for_name(&app, "desktop")?.join(pdf_name.clone());
    let state = app.state::<AppState>();
    let save = dialog_save(
        app.clone(),
        state,
        SaveDialogOptions {
            title: Some("Save PDF".into()),
            default_path: Some(default_path.to_string_lossy().to_string()),
            filters: Some(vec![DialogFilter {
                name: "PDF Files".into(),
                extensions: vec!["pdf".into()],
            }]),
        },
    )
    .await?;

    if !save.canceled {
        app.emit_to(
            MAIN_WINDOW_LABEL,
            "print-pdf-request",
            json!({ "pdfName": pdf_name, "filePath": save.file_path }),
        )
        .map_err(to_error)?;
    }

    Ok(())
}
