use std::sync::{OnceLock, RwLock};

use serde_json::json;
use tauri::{
    menu::{Menu, MenuBuilder, MenuEvent, MenuItem, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Manager, Wry,
};
use tauri_plugin_opener::OpenerExt;

use crate::shared::{to_error, AppError, HELP_URL, MAIN_WINDOW_LABEL};

static MENU_LANG: OnceLock<RwLock<String>> = OnceLock::new();

/// Remember the interface language chosen in the frontend so the native
/// menu (built from Rust) can be rendered in the same language.
pub(crate) fn set_menu_language(lang: &str) {
    let cell = MENU_LANG.get_or_init(|| RwLock::new("en".to_string()));
    if let Ok(mut current) = cell.write() {
        *current = lang.to_string();
    }
}

fn current_language() -> String {
    MENU_LANG
        .get()
        .and_then(|cell| cell.read().ok().map(|lang| lang.clone()))
        .unwrap_or_else(|| "en".to_string())
}

/// English is the fallback; other languages are added per key.
fn tr<'a>(lang: &str, en: &'a str, ru: &'a str) -> &'a str {
    if lang == "ru" {
        ru
    } else {
        en
    }
}

pub(crate) fn build_context_menu(app: &AppHandle) -> Result<Menu<Wry>, AppError> {
    let lang = current_language();
    let text = |en: &str, ru: &str| tr(&lang, en, ru).to_string();
    let undo = PredefinedMenuItem::undo(app, Some(&text("Undo", "Отменить"))).map_err(to_error)?;
    let redo = PredefinedMenuItem::redo(app, Some(&text("Redo", "Повторить"))).map_err(to_error)?;
    let cut = PredefinedMenuItem::cut(app, Some(&text("Cut", "Вырезать"))).map_err(to_error)?;
    let copy = PredefinedMenuItem::copy(app, Some(&text("Copy", "Копировать"))).map_err(to_error)?;
    let paste = PredefinedMenuItem::paste(app, Some(&text("Paste", "Вставить"))).map_err(to_error)?;
    let select_all = PredefinedMenuItem::select_all(
        app,
        Some(&text("Select All", "Выделить все")),
    )
    .map_err(to_error)?;
    MenuBuilder::new(app)
        .item(&undo)
        .item(&redo)
        .separator()
        .item(&cut)
        .item(&copy)
        .item(&paste)
        .item(&select_all)
        .build()
        .map_err(|e| AppError::Other(e.to_string()))
}

pub(crate) fn build_app_menu(app: &AppHandle, lang: &str) -> Result<Menu<Wry>, AppError> {
    let text = |en: &str, ru: &str| tr(lang, en, ru).to_string();

    let new_note = MenuItem::with_id(
        app,
        "new-note",
        text("New Note", "Новая заметка"),
        true,
        Some("CmdOrCtrl+N"),
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    let file_submenu = {
        let mut builder = SubmenuBuilder::new(app, text("File", "Файл")).item(&new_note);
        #[cfg(target_os = "macos")]
        {
            let close = PredefinedMenuItem::close_window(
                app,
                Some(&text("Close Window", "Закрыть окно")),
            )
            .map_err(|e| AppError::Other(e.to_string()))?;
            builder = builder.item(&close);
        }
        #[cfg(not(target_os = "macos"))]
        {
            let quit =
                PredefinedMenuItem::quit(app, Some(&text("Exit", "Выход")))
                    .map_err(|e| AppError::Other(e.to_string()))?;
            builder = builder.item(&quit);
        }
        builder.build().map_err(|e| AppError::Other(e.to_string()))?
    };

    let edit_submenu = {
        let undo = PredefinedMenuItem::undo(app, Some(&text("Undo", "Отменить")))
            .map_err(|e| AppError::Other(e.to_string()))?;
        let redo = PredefinedMenuItem::redo(app, Some(&text("Redo", "Повторить")))
            .map_err(|e| AppError::Other(e.to_string()))?;
        let cut = PredefinedMenuItem::cut(app, Some(&text("Cut", "Вырезать")))
            .map_err(|e| AppError::Other(e.to_string()))?;
        let copy = PredefinedMenuItem::copy(app, Some(&text("Copy", "Копировать")))
            .map_err(|e| AppError::Other(e.to_string()))?;
        let paste = PredefinedMenuItem::paste(app, Some(&text("Paste", "Вставить")))
            .map_err(|e| AppError::Other(e.to_string()))?;
        let select_all = PredefinedMenuItem::select_all(
            app,
            Some(&text("Select All", "Выделить все")),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let mut builder = SubmenuBuilder::new(app, text("Edit", "Правка"))
            .item(&undo)
            .item(&redo)
            .separator()
            .item(&cut)
            .item(&copy)
            .item(&paste);
        #[cfg(target_os = "macos")]
        {
            builder = builder
                .text(
                    "edit-paste-match-style",
                    text("Paste and Match Style", "Вставить с сохранением стиля"),
                )
                .text("edit-delete", text("Delete", "Удалить"))
                .item(&select_all)
                .separator()
                .text(
                    "edit-start-speaking",
                    text("Start Speaking", "Начать озвучивание"),
                )
                .text(
                    "edit-stop-speaking",
                    text("Stop Speaking", "Остановить озвучивание"),
                );
        }
        #[cfg(not(target_os = "macos"))]
        {
            builder = builder
                .text("edit-delete", text("Delete", "Удалить"))
                .separator()
                .item(&select_all);
        }
        builder.build().map_err(|e| AppError::Other(e.to_string()))?
    };

    let view_submenu = {
        let reload = MenuItem::with_id(
            app,
            "reload",
            text("Reload", "Перезагрузить"),
            true,
            Some("CmdOrCtrl+R"),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let force_reload = MenuItem::with_id(
            app,
            "force-reload",
            text("Force Reload", "Перезагрузить принудительно"),
            true,
            Some("CmdOrCtrl+Shift+R"),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let toggle_devtools = MenuItem::with_id(
            app,
            "toggle-devtools",
            text("Toggle Developer Tools", "Инструменты разработчика"),
            true,
            Some("Alt+CmdOrCtrl+I"),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let reset_zoom = MenuItem::with_id(
            app,
            "reset-zoom",
            text("Reset Zoom", "Сбросить масштаб"),
            true,
            Some("CmdOrCtrl+0"),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let zoom_in = MenuItem::with_id(
            app,
            "zoom-in",
            text("Zoom In", "Увеличить"),
            true,
            Some("CmdOrCtrl+Plus"),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let zoom_out = MenuItem::with_id(
            app,
            "zoom-out",
            text("Zoom Out", "Уменьшить"),
            true,
            Some("CmdOrCtrl+-"),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let toggle_fullscreen = MenuItem::with_id(
            app,
            "toggle-fullscreen",
            text("Toggle Fullscreen", "Полноэкранный режим"),
            true,
            Some("F11"),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        SubmenuBuilder::new(app, text("View", "Вид"))
            .item(&reload)
            .item(&force_reload)
            .item(&toggle_devtools)
            .separator()
            .item(&reset_zoom)
            .item(&zoom_in)
            .item(&zoom_out)
            .separator()
            .item(&toggle_fullscreen)
            .build()
            .map_err(|e| AppError::Other(e.to_string()))?
    };

    let window_submenu = {
        let minimize = PredefinedMenuItem::minimize(
            app,
            Some(&text("Minimize", "Свернуть")),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let maximize = PredefinedMenuItem::maximize(
            app,
            Some(&text("Maximize", "Развернуть")),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let mut builder = SubmenuBuilder::new(app, text("Window", "Окно"))
            .item(&minimize)
            .item(&maximize);
        #[cfg(target_os = "macos")]
        {
            builder = builder
                .separator()
                .text(
                    "window-front",
                    text("Bring All to Front", "Все окна на передний план"),
                )
                .separator()
                .text("window-window", text("Window", "Окно"));
        }
        #[cfg(not(target_os = "macos"))]
        {
            let close = PredefinedMenuItem::close_window(
                app,
                Some(&text("Close", "Закрыть")),
            )
            .map_err(|e| AppError::Other(e.to_string()))?;
            builder = builder.item(&close);
        }
        builder.build().map_err(|e| AppError::Other(e.to_string()))?
    };

    let docs = MenuItem::with_id(
        app,
        "docs",
        text("Docs", "Документация"),
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    let help_submenu = SubmenuBuilder::new(app, text("Help", "Справка"))
        .item(&docs)
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;

    #[allow(unused_mut)]
    let mut builder = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, &app.package_info().name)
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;
        builder = builder.item(&app_menu);
    }

    builder
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&window_submenu)
        .item(&help_submenu)
        .build()
        .map_err(|e| AppError::Other(e.to_string()))
}

pub(crate) fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().0.as_str();
    let maybe_window = app.get_webview_window(MAIN_WINDOW_LABEL);
    match id {
        "new-note" => {
            let _ = app.emit_to(MAIN_WINDOW_LABEL, "menu-new-note", json!({}));
        }
        "reload" => {
            if let Some(window) = maybe_window {
                let _ = window.eval("window.location.reload()");
            }
        }
        "force-reload" => {
            if let Some(window) = maybe_window {
                let _ = window.eval("window.location.reload(true)");
            }
        }
        "toggle-devtools" => {
            if let Some(window) = maybe_window {
                #[cfg(debug_assertions)]
                window.open_devtools();
            }
        }
        "reset-zoom" => {
            if let Some(window) = maybe_window {
                let _ = window.set_zoom(1.0);
            }
        }
        "zoom-in" => {
            let _ = app.emit_to(MAIN_WINDOW_LABEL, "menu-zoom-in", json!({}));
        }
        "zoom-out" => {
            let _ = app.emit_to(MAIN_WINDOW_LABEL, "menu-zoom-out", json!({}));
        }
        "toggle-fullscreen" => {
            if let Some(window) = maybe_window {
                if let Ok(fullscreen) = window.is_fullscreen() {
                    let _ = window.set_fullscreen(!fullscreen);
                }
            }
        }
        "docs" => {
            if let Err(err) = app.opener().open_url(HELP_URL, None::<String>) {
                eprintln!("[menu] failed to open docs URL {HELP_URL}: {err}");
            }
        }
        _ => {}
    }
}
