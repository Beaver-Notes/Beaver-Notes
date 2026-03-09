use serde_json::json;
use tauri::{
  menu::{Menu, MenuBuilder, MenuEvent, MenuItem, SubmenuBuilder},
  AppHandle, Emitter, Manager, Wry,
};
use tauri_plugin_opener::OpenerExt;

use crate::shared::{to_error, HELP_URL, MAIN_WINDOW_LABEL};

pub(crate) fn build_context_menu(app: &AppHandle) -> Result<Menu<Wry>, String> {
  let undo = MenuItem::new(app, "Undo", true, None::<&str>).map_err(to_error)?;
  let redo = MenuItem::new(app, "Redo", true, None::<&str>).map_err(to_error)?;
  let cut = MenuItem::new(app, "Cut", true, None::<&str>).map_err(to_error)?;
  let copy = MenuItem::new(app, "Copy", true, None::<&str>).map_err(to_error)?;
  let paste = MenuItem::new(app, "Paste", true, None::<&str>).map_err(to_error)?;
  let select_all = MenuItem::new(app, "Select All", true, None::<&str>).map_err(to_error)?;
  MenuBuilder::new(app)
    .item(&undo)
    .item(&redo)
    .separator()
    .item(&cut)
    .item(&copy)
    .item(&paste)
    .item(&select_all)
    .build()
    .map_err(to_error)
}

pub(crate) fn build_app_menu(app: &AppHandle) -> Result<Menu<Wry>, String> {
  let new_note = MenuItem::new(app, "New Note", true, Some("CmdOrCtrl+N")).map_err(to_error)?;
  let file_submenu = {
    let mut builder = SubmenuBuilder::new(app, "File").item(&new_note);
    #[cfg(target_os = "macos")]
    {
      builder = builder.close_window();
    }
    #[cfg(not(target_os = "macos"))]
    {
      builder = builder.quit();
    }
    builder.build().map_err(to_error)?
  };

  let edit_submenu = {
    let mut builder = SubmenuBuilder::new(app, "Edit")
      .undo()
      .redo()
      .separator()
      .cut()
      .copy()
      .paste();
    #[cfg(target_os = "macos")]
    {
      builder = builder
        .text("edit-paste-match-style", "Paste and Match Style")
        .text("edit-delete", "Delete")
        .select_all()
        .separator()
        .text("edit-start-speaking", "Start Speaking")
        .text("edit-stop-speaking", "Stop Speaking");
    }
    #[cfg(not(target_os = "macos"))]
    {
      builder = builder.text("edit-delete", "Delete").separator().select_all();
    }
    builder.build().map_err(to_error)?
  };

  let view_submenu = {
    let reload = MenuItem::new(app, "Reload", true, Some("CmdOrCtrl+R")).map_err(to_error)?;
    let force_reload =
      MenuItem::new(app, "Force Reload", true, Some("CmdOrCtrl+Shift+R")).map_err(to_error)?;
    let toggle_devtools = MenuItem::new(
      app,
      "Toggle Developer Tools",
      true,
      Some("Alt+CmdOrCtrl+I"),
    )
    .map_err(to_error)?;
    let reset_zoom = MenuItem::new(app, "Reset Zoom", true, Some("CmdOrCtrl+0")).map_err(to_error)?;
    let zoom_in = MenuItem::new(app, "Zoom In", true, Some("CmdOrCtrl+Plus")).map_err(to_error)?;
    let zoom_out = MenuItem::new(app, "Zoom Out", true, Some("CmdOrCtrl+-")).map_err(to_error)?;
    let toggle_fullscreen = MenuItem::new(app, "Toggle Fullscreen", true, Some("F11")).map_err(to_error)?;
    SubmenuBuilder::new(app, "View")
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
      .map_err(to_error)?
  };

  let window_submenu = {
    let mut builder = SubmenuBuilder::new(app, "Window").minimize().maximize();
    #[cfg(target_os = "macos")]
    {
      builder = builder
        .separator()
        .text("window-front", "Bring All to Front")
        .separator()
        .text("window-window", "Window");
    }
    #[cfg(not(target_os = "macos"))]
    {
      builder = builder.close_window();
    }
    builder.build().map_err(to_error)?
  };

  let docs = MenuItem::new(app, "Docs", true, None::<&str>).map_err(to_error)?;
  let help_submenu = SubmenuBuilder::new(app, "Help")
    .item(&docs)
    .build()
    .map_err(to_error)?;

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
      .map_err(to_error)?;
    builder = builder.item(&app_menu);
  }

  builder
    .item(&file_submenu)
    .item(&edit_submenu)
    .item(&view_submenu)
    .item(&window_submenu)
    .item(&help_submenu)
    .build()
    .map_err(to_error)
}

pub(crate) fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
  let id = event.id().0.as_str();
  let maybe_window = app.get_webview_window(MAIN_WINDOW_LABEL);
  match id {
    "New Note" => {
      let _ = app.emit_to(MAIN_WINDOW_LABEL, "menu-new-note", json!({}));
    }
    "Reload" => {
      if let Some(window) = maybe_window {
        let _ = window.eval("window.location.reload()");
      }
    }
    "Force Reload" => {
      if let Some(window) = maybe_window {
        let _ = window.eval("window.location.reload(true)");
      }
    }
    "Toggle Developer Tools" => {
      if let Some(window) = maybe_window {
        #[cfg(debug_assertions)]
        window.open_devtools();
      }
    }
    "Reset Zoom" => {
      if let Some(window) = maybe_window {
        let _ = window.set_zoom(1.0);
      }
    }
    "Zoom In" => {
      let _ = app.emit_to(MAIN_WINDOW_LABEL, "menu-zoom-in", json!({}));
    }
    "Zoom Out" => {
      let _ = app.emit_to(MAIN_WINDOW_LABEL, "menu-zoom-out", json!({}));
    }
    "Toggle Fullscreen" => {
      if let Some(window) = maybe_window {
        if let Ok(fullscreen) = window.is_fullscreen() {
          let _ = window.set_fullscreen(!fullscreen);
        }
      }
    }
    "Docs" => {
      let _ = app.opener().open_url(HELP_URL, None::<String>);
    }
    _ => {}
  }
}
