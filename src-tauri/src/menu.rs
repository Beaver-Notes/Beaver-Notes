use std::sync::{OnceLock, RwLock};

use serde_json::{json, Value};
use tauri::{
    menu::{Menu, MenuBuilder, MenuEvent, MenuItem, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Manager, Wry,
};
use tauri_plugin_opener::OpenerExt;

use crate::shared::{to_error, AppError, HELP_URL, MAIN_WINDOW_LABEL};

#[derive(Clone, Default)]
pub(crate) struct MenuContext {
    pub screen: String, // "home" | "archive" | "note" | "reader" | "settings"
    pub note_editable: bool,
    pub note_locked: bool,
    pub language: String,
}

static CURRENT_CONTEXT: OnceLock<RwLock<MenuContext>> = OnceLock::new();

fn remember_context(ctx: &MenuContext) {
    let cell = CURRENT_CONTEXT.get_or_init(|| RwLock::new(MenuContext::default()));
    if let Ok(mut current) = cell.write() {
        *current = ctx.clone();
    }
}

fn current_context() -> MenuContext {
    CURRENT_CONTEXT
        .get()
        .and_then(|cell| cell.read().ok().map(|ctx| ctx.clone()))
        .unwrap_or_default()
}

pub(crate) fn menu_context_from_value(v: &Value) -> MenuContext {
    MenuContext {
        screen: v
            .get("screen")
            .and_then(Value::as_str)
            .unwrap_or("home")
            .to_string(),
        note_editable: v
            .get("noteEditable")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        note_locked: v
            .get("noteLocked")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        language: v
            .get("language")
            .or_else(|| v.get("lang"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| current_context().language.clone()),
    }
}

fn normalize_language(lang: &str) -> &str {
    let lang = lang.trim().trim_matches('"');
    if lang.is_empty() {
        "en"
    } else {
        lang
    }
}

fn locale_json(lang: &str) -> &'static str {
    match lang {
        "ar" => include_str!("../../src/assets/locales/ar.json"),
        "de" => include_str!("../../src/assets/locales/de.json"),
        "en" => include_str!("../../src/assets/locales/en.json"),
        "es" => include_str!("../../src/assets/locales/es.json"),
        "fr" => include_str!("../../src/assets/locales/fr.json"),
        "it" => include_str!("../../src/assets/locales/it.json"),
        "nl" => include_str!("../../src/assets/locales/nl.json"),
        "pt" => include_str!("../../src/assets/locales/pt.json"),
        "ru" => include_str!("../../src/assets/locales/ru.json"),
        "tr" => include_str!("../../src/assets/locales/tr.json"),
        "uk" => include_str!("../../src/assets/locales/uk.json"),
        "vi" => include_str!("../../src/assets/locales/vi.json"),
        "zh" => include_str!("../../src/assets/locales/zh.json"),
        _ => include_str!("../../src/assets/locales/en.json"),
    }
}

fn menu_text(lang: &str, key: &str, fallback: &str) -> String {
    let path = format!("nativeMenu.{key}");
    let lookup = |raw: &str| -> Option<String> {
        let value: Value = serde_json::from_str(raw).ok()?;
        let mut current = &value;
        for part in path.split('.') {
            current = current.get(part)?;
        }
        current.as_str().map(str::to_string)
    };
    lookup(locale_json(lang))
        .or_else(|| lookup(locale_json("en")))
        .unwrap_or_else(|| fallback.to_string())
}

pub(crate) fn rebuild_menu(app: &AppHandle, ctx: &MenuContext) -> Result<(), AppError> {
    remember_context(ctx);
    let menu = build_app_menu_for(app, ctx)?;
    let _ = app.set_menu(menu).map_err(to_error)?;
    Ok(())
}

/// Rebuild after a frontend language change, keeping the screen/edit state that
/// the app already pushed through `update_menu`.
pub(crate) fn rebuild_menu_for_language(app: &AppHandle, lang: &str) -> Result<(), AppError> {
    let mut ctx = current_context();
    ctx.language = normalize_language(lang).to_string();
    rebuild_menu(app, &ctx)
}

pub(crate) fn build_context_menu(app: &AppHandle) -> Result<Menu<Wry>, AppError> {
    let ctx = current_context();
    let lang = normalize_language(&ctx.language);
    let undo = PredefinedMenuItem::undo(app, Some(&menu_text(lang, "undo", "Undo")))
        .map_err(to_error)?;
    let redo = PredefinedMenuItem::redo(app, Some(&menu_text(lang, "redo", "Redo")))
        .map_err(to_error)?;
    let cut =
        PredefinedMenuItem::cut(app, Some(&menu_text(lang, "cut", "Cut"))).map_err(to_error)?;
    let copy =
        PredefinedMenuItem::copy(app, Some(&menu_text(lang, "copy", "Copy"))).map_err(to_error)?;
    let paste =
        PredefinedMenuItem::paste(app, Some(&menu_text(lang, "paste", "Paste"))).map_err(to_error)?;
    let select_all = PredefinedMenuItem::select_all(
        app,
        Some(&menu_text(lang, "selectAll", "Select All")),
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

pub(crate) fn build_app_menu(app: &AppHandle) -> Result<Menu<Wry>, AppError> {
    let ctx = MenuContext::default();
    remember_context(&ctx);
    build_app_menu_for(app, &ctx)
}

pub(crate) fn build_app_menu_for(
    app: &AppHandle,
    ctx: &MenuContext,
) -> Result<Menu<Wry>, AppError> {
    let lang = normalize_language(&ctx.language);
    let text = |key: &str, fallback: &str| menu_text(lang, key, fallback);
    let note_editable = ctx.screen == "note" && ctx.note_editable && !ctx.note_locked;
    let show_edit_menu = ctx.screen != "reader";
    let show_back_to_notes = ctx.screen == "settings";

    let new_note = MenuItem::with_id(
        app,
        "new-note",
        text("newNote", "New Note"),
        true,
        Some("CmdOrCtrl+N"),
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    let back_to_notes = MenuItem::with_id(
        app,
        "menu-back-to-notes",
        text("backToNotes", "Back to Notes"),
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    let file_submenu = {
        let mut builder = SubmenuBuilder::new(app, text("file", "File")).item(&new_note);
        if show_back_to_notes {
            builder = builder.separator().item(&back_to_notes);
        }
        #[cfg(target_os = "macos")]
        {
            let close = PredefinedMenuItem::close_window(
                app,
                Some(&text("closeWindow", "Close Window")),
            )
            .map_err(|e| AppError::Other(e.to_string()))?;
            builder = builder.item(&close);
        }
        #[cfg(not(target_os = "macos"))]
        {
            let quit = PredefinedMenuItem::quit(app, Some(&text("exit", "Exit")))
                .map_err(|e| AppError::Other(e.to_string()))?;
            builder = builder.item(&quit);
        }
        builder
            .build()
            .map_err(|e| AppError::Other(e.to_string()))?
    };

    let duplicate_note = MenuItem::with_id(
        app,
        "menu-duplicate-note",
        text("duplicateNote", "Duplicate Note"),
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    let copy_content = MenuItem::with_id(
        app,
        "menu-copy-content",
        text("copyContent", "Copy Content"),
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::Other(e.to_string()))?;
    let edit_submenu = {
        let undo =
            PredefinedMenuItem::undo(app, Some(&text("undo", "Undo")))
                .map_err(|e| AppError::Other(e.to_string()))?;
        let redo =
            PredefinedMenuItem::redo(app, Some(&text("redo", "Redo")))
                .map_err(|e| AppError::Other(e.to_string()))?;
        let cut =
            PredefinedMenuItem::cut(app, Some(&text("cut", "Cut")))
                .map_err(|e| AppError::Other(e.to_string()))?;
        let copy =
            PredefinedMenuItem::copy(app, Some(&text("copy", "Copy")))
                .map_err(|e| AppError::Other(e.to_string()))?;
        let paste =
            PredefinedMenuItem::paste(app, Some(&text("paste", "Paste")))
                .map_err(|e| AppError::Other(e.to_string()))?;
        let select_all = PredefinedMenuItem::select_all(
            app,
            Some(&text("selectAll", "Select All")),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let mut builder = SubmenuBuilder::new(app, text("edit", "Edit"))
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
                    text("pasteAndMatchStyle", "Paste and Match Style"),
                )
                .text("edit-delete", text("delete", "Delete"))
                .item(&select_all)
                .separator()
                .text(
                    "edit-start-speaking",
                    text("startSpeaking", "Start Speaking"),
                )
                .text(
                    "edit-stop-speaking",
                    text("stopSpeaking", "Stop Speaking"),
                );
        }
        #[cfg(not(target_os = "macos"))]
        {
            builder = builder
                .text("edit-delete", text("delete", "Delete"))
                .separator()
                .item(&select_all);
        }
        if note_editable {
            builder = builder
                .separator()
                .item(&duplicate_note)
                .item(&copy_content);
        }
        builder
            .build()
            .map_err(|e| AppError::Other(e.to_string()))?
    };

    let format_submenu = if note_editable {
        Some(
            SubmenuBuilder::new(app, text("format", "Format"))
                .text("menu-format-bold", text("bold", "Bold"))
                .text("menu-format-italic", text("italic", "Italic"))
                .text("menu-format-underline", text("underline", "Underline"))
                .text("menu-format-strike", text("strike", "Strikethrough"))
                .separator()
                .text("menu-format-heading-1", text("heading1", "Heading 1"))
                .text("menu-format-heading-2", text("heading2", "Heading 2"))
                .text("menu-format-heading-3", text("heading3", "Heading 3"))
                .text("menu-format-heading-4", text("heading4", "Heading 4"))
                .separator()
                .text("menu-format-list-bullet", text("bulletList", "Bullet List"))
                .text(
                    "menu-format-list-numbered",
                    text("numberedList", "Numbered List"),
                )
                .build()
                .map_err(|e| AppError::Other(e.to_string()))?,
        )
    } else {
        None
    };

    let insert_submenu = if note_editable {
        Some(
            SubmenuBuilder::new(app, text("insert", "Insert"))
                .text("menu-insert-link", text("link", "Link"))
                .text("menu-insert-image", text("image", "Image"))
                .text("menu-insert-table", text("table", "Table"))
                .text("menu-insert-record-audio", text("recordAudio", "Record Audio"))
                .text("menu-insert-date-time", text("dateTime", "Date/Time"))
                .build()
                .map_err(|e| AppError::Other(e.to_string()))?,
        )
    } else {
        None
    };

    let view_submenu = {
        let reload = MenuItem::with_id(
            app,
            "reload",
            text("reload", "Reload"),
            true,
            Some("CmdOrCtrl+R"),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let force_reload = MenuItem::with_id(
            app,
            "force-reload",
            text("forceReload", "Force Reload"),
            true,
            Some("CmdOrCtrl+Shift+R"),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let toggle_devtools = MenuItem::with_id(
            app,
            "toggle-devtools",
            text("toggleDevtools", "Toggle Developer Tools"),
            true,
            Some("Alt+CmdOrCtrl+I"),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let reset_zoom = MenuItem::with_id(
            app,
            "reset-zoom",
            text("resetZoom", "Reset Zoom"),
            true,
            Some("CmdOrCtrl+0"),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let zoom_in = MenuItem::with_id(
            app,
            "zoom-in",
            text("zoomIn", "Zoom In"),
            true,
            Some("CmdOrCtrl+Plus"),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let zoom_out = MenuItem::with_id(
            app,
            "zoom-out",
            text("zoomOut", "Zoom Out"),
            true,
            Some("CmdOrCtrl+-"),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        let toggle_fullscreen = MenuItem::with_id(
            app,
            "toggle-fullscreen",
            text("toggleFullscreen", "Toggle Fullscreen"),
            true,
            Some("F11"),
        )
        .map_err(|e| AppError::Other(e.to_string()))?;
        SubmenuBuilder::new(app, text("view", "View"))
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
        let minimize = PredefinedMenuItem::minimize(app, Some(&text("minimize", "Minimize")))
            .map_err(|e| AppError::Other(e.to_string()))?;
        let maximize = PredefinedMenuItem::maximize(app, Some(&text("maximize", "Maximize")))
            .map_err(|e| AppError::Other(e.to_string()))?;
        let mut builder = SubmenuBuilder::new(app, text("window", "Window"))
            .item(&minimize)
            .item(&maximize);
        #[cfg(target_os = "macos")]
        {
            builder = builder
                .separator()
                .text(
                    "window-front",
                    text("bringAllToFront", "Bring All to Front"),
                )
                .separator()
                .text("window-window", text("window", "Window"));
        }
        #[cfg(not(target_os = "macos"))]
        {
            let close = PredefinedMenuItem::close_window(app, Some(&text("close", "Close")))
                .map_err(|e| AppError::Other(e.to_string()))?;
            builder = builder.item(&close);
        }
        builder
            .build()
            .map_err(|e| AppError::Other(e.to_string()))?
    };

    let docs = MenuItem::with_id(app, "docs", text("docs", "Docs"), true, None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))?;
    let help_submenu = SubmenuBuilder::new(app, text("help", "Help"))
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

    builder = builder.item(&file_submenu);
    if show_edit_menu {
        builder = builder.item(&edit_submenu);
    }
    if let Some(submenu) = &format_submenu {
        builder = builder.item(submenu);
    }
    if let Some(submenu) = &insert_submenu {
        builder = builder.item(submenu);
    }
    builder
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
            let _ = app.opener().open_url(HELP_URL, None::<String>);
        }
        "menu-back-to-notes"
        | "menu-duplicate-note"
        | "menu-copy-content"
        | "menu-format-bold"
        | "menu-format-italic"
        | "menu-format-underline"
        | "menu-format-strike"
        | "menu-format-heading-1"
        | "menu-format-heading-2"
        | "menu-format-heading-3"
        | "menu-format-heading-4"
        | "menu-format-list-bullet"
        | "menu-format-list-numbered"
        | "menu-insert-link"
        | "menu-insert-image"
        | "menu-insert-table"
        | "menu-insert-record-audio"
        | "menu-insert-date-time" => {
            let _ = app.emit_to(MAIN_WINDOW_LABEL, id, json!({}));
        }
        _ => {}
    }
}
