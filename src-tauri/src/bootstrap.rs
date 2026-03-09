use std::{
  fs,
  path::{Path, PathBuf},
};

use http::StatusCode;
use serde_json::json;
use tauri::{
  App, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WindowEvent, Wry,
};

use crate::{commands, menu, shared::*};

const WINDOW_STATE_KEY: &str = "windowStateMain";

pub(crate) fn queue_or_emit_file_open(app: &AppHandle, state: &AppState, path: String) {
  grant_trusted_path(state, Path::new(&path));
  if app.emit_to(MAIN_WINDOW_LABEL, "file-opened", path.clone()).is_err() {
    if let Ok(mut pending) = state.pending_open_files.lock() {
      pending.push(path);
    }
  }
}

fn bootstrap_file_open_from_argv(app: &AppHandle, state: &AppState) {
  for arg in std::env::args().skip(1) {
    if arg.ends_with(".bea") {
      queue_or_emit_file_open(app, state, arg);
    }
  }
}

pub(crate) fn focus_main_window(app: &AppHandle) {
  if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    if window.is_minimized().unwrap_or(false) {
      let _ = window.unminimize();
    }
    let _ = window.show();
    let _ = window.set_focus();
  }
}

fn load_window_state(app: &AppHandle) -> Option<WindowStateSnapshot> {
  let store = ensure_store(app, SETTINGS_STORE).ok()?;
  let value = store.get(WINDOW_STATE_KEY)?;
  serde_json::from_value(value).ok()
}

fn save_window_state(app: &AppHandle) -> Result<(), String> {
  let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
    return Ok(());
  };

  let position = window.outer_position().map_err(to_error)?;
  let size = window.outer_size().map_err(to_error)?;
  let snapshot = WindowStateSnapshot {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
    maximized: window.is_maximized().map_err(to_error)?,
  };

  let store = ensure_store(app, SETTINGS_STORE)?;
  store.set(WINDOW_STATE_KEY, json!(snapshot));
  store.save().map_err(to_error)
}

fn restore_window_state(app: &AppHandle) -> Result<(), String> {
  let Some(snapshot) = load_window_state(app) else {
    return Ok(());
  };
  let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
    return Ok(());
  };

  if snapshot.width > 0 && snapshot.height > 0 {
    window
      .set_size(PhysicalSize::new(snapshot.width, snapshot.height))
      .map_err(to_error)?;
  }
  window
    .set_position(PhysicalPosition::new(snapshot.x, snapshot.y))
    .map_err(to_error)?;
  if snapshot.maximized {
    let _ = window.maximize();
  }
  Ok(())
}

fn legacy_store_dir(app: &AppHandle) -> Option<PathBuf> {
  #[cfg(target_os = "macos")]
  {
    return app
      .path()
      .home_dir()
      .ok()
      .map(|home| home.join("Library/Application Support/Beaver Notes"));
  }

  #[cfg(target_os = "windows")]
  {
    return app
      .path()
      .app_data_dir()
      .ok()
      .and_then(|dir| dir.parent().map(|parent| parent.join("Beaver Notes")));
  }

  #[cfg(target_os = "linux")]
  {
    return app
      .path()
      .config_dir()
      .ok()
      .map(|config| config.join("Beaver Notes"));
  }

  #[allow(unreachable_code)]
  None
}

fn merge_json_preserving_target(target: &mut serde_json::Value, source: serde_json::Value) {
  match (target, source) {
    (serde_json::Value::Object(target_map), serde_json::Value::Object(source_map)) => {
      for (key, source_value) in source_map {
        if let Some(target_value) = target_map.get_mut(&key) {
          merge_json_preserving_target(target_value, source_value);
        } else {
          target_map.insert(key, source_value);
        }
      }
    }
    _ => {
      // Keep the current Tauri-side value. Migration must not overwrite newer data.
    }
  }
}

fn merge_store_file(source_path: &Path, target_path: &Path) -> Result<(), String> {
  if !source_path.exists() {
    return Ok(());
  }

  if !target_path.exists() {
    fs::copy(source_path, target_path).map_err(to_error)?;
    return Ok(());
  }

  let source_text = fs::read_to_string(source_path).map_err(to_error)?;
  let target_text = fs::read_to_string(target_path).map_err(to_error)?;
  let source_json = serde_json::from_str::<serde_json::Value>(&source_text).map_err(to_error)?;
  let mut target_json = serde_json::from_str::<serde_json::Value>(&target_text).map_err(to_error)?;

  merge_json_preserving_target(&mut target_json, source_json);

  let serialized = serde_json::to_string_pretty(&target_json).map_err(to_error)?;
  fs::write(target_path, format!("{serialized}\n")).map_err(to_error)
}

fn copy_directory_missing(source: &Path, target: &Path) -> Result<(), String> {
  fs::create_dir_all(target).map_err(to_error)?;

  for entry in fs::read_dir(source).map_err(to_error)? {
    let entry = entry.map_err(to_error)?;
    let source_path = entry.path();
    let target_path = target.join(entry.file_name());

    if source_path.is_dir() {
      copy_directory_missing(&source_path, &target_path)?;
    } else if !target_path.exists() {
      fs::copy(&source_path, &target_path).map_err(to_error)?;
    }
  }

  Ok(())
}

pub(crate) fn migrate_legacy_store_data(app: &AppHandle) {
  let Ok(new_dir) = app.path().app_data_dir() else {
    return;
  };
  let Some(old_dir) = legacy_store_dir(app) else {
    return;
  };
  let marker = new_dir.join(".legacy-store-migrated");

  if marker.exists() || !old_dir.exists() {
    return;
  }

  if fs::create_dir_all(&new_dir).is_err() {
    return;
  }

  for name in [DATA_STORE, SETTINGS_STORE, AUTH_STORE] {
    let old = old_dir.join(name);
    let _ = merge_store_file(&old, &new_dir.join(name));
  }
  for folder in ["notes-assets", "file-assets"] {
    let old = old_dir.join(folder);
    if old.exists() {
      let _ = copy_directory_missing(&old, &new_dir.join(folder));
    }
  }

  // Intentionally non-destructive while migration is being tested.
  // Do not remove or mutate the legacy Electron directory here.
  // let _ = fs::remove_dir_all(&old_dir);

  let _ = fs::write(marker, b"ok");
}

pub(crate) fn register_asset_protocols(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
  builder
    .register_asynchronous_uri_scheme_protocol("assets", move |ctx, request, responder| {
      let app = ctx.app_handle().clone();
      let path = match resolve_asset_path_from_protocol_url(
        &app,
        request.uri().to_string().as_str(),
        "assets",
      ) {
        Ok(path) => path,
        Err(_) => {
          responder.respond(protocol_response(
            StatusCode::BAD_REQUEST,
            Path::new("asset.bin"),
            Vec::new(),
          ));
          return;
        }
      };
      let (asset_cache_dir, transient_passphrase) = {
        let state = app.state::<AppState>();
        let transient_passphrase = state
          .transient_passphrase
          .lock()
          .ok()
          .map(|value| value.clone())
          .filter(|value| !value.is_empty());
        (state.asset_cache_dir.clone(), transient_passphrase)
      };
      std::thread::spawn(move || {
        let response = match cached_or_decrypted_asset(
          &app,
          &asset_cache_dir,
          transient_passphrase.as_deref(),
          &path,
        )
        .and_then(|resolved| fs::read(&resolved).map_err(to_error).map(|bytes| (resolved, bytes)))
        {
          Ok((resolved, bytes)) => protocol_response(StatusCode::OK, &resolved, bytes),
          Err(_) => protocol_response(StatusCode::NOT_FOUND, &path, Vec::new()),
        };
        responder.respond(response);
      });
    })
    .register_asynchronous_uri_scheme_protocol("file-assets", move |ctx, request, responder| {
      let app = ctx.app_handle().clone();
      let path = match resolve_asset_path_from_protocol_url(
        &app,
        request.uri().to_string().as_str(),
        "file-assets",
      ) {
        Ok(path) => path,
        Err(_) => {
          responder.respond(protocol_response(
            StatusCode::BAD_REQUEST,
            Path::new("asset.bin"),
            Vec::new(),
          ));
          return;
        }
      };
      let (asset_cache_dir, transient_passphrase) = {
        let state = app.state::<AppState>();
        let transient_passphrase = state
          .transient_passphrase
          .lock()
          .ok()
          .map(|value| value.clone())
          .filter(|value| !value.is_empty());
        (state.asset_cache_dir.clone(), transient_passphrase)
      };
      std::thread::spawn(move || {
        let response = match cached_or_decrypted_asset(
          &app,
          &asset_cache_dir,
          transient_passphrase.as_deref(),
          &path,
        )
        .and_then(|resolved| fs::read(&resolved).map_err(to_error).map(|bytes| (resolved, bytes)))
        {
          Ok((resolved, bytes)) => protocol_response(StatusCode::OK, &resolved, bytes),
          Err(_) => protocol_response(StatusCode::NOT_FOUND, &path, Vec::new()),
        };
        responder.respond(response);
      });
    })
}

pub(crate) fn setup_app(app: &mut App<Wry>) -> Result<(), String> {
  migrate_legacy_store_data(app.handle());
  let state = app.state::<AppState>();
  sync_roots_from_settings(app.handle(), &state);
  grant_trusted_path(&state, &app.path().app_data_dir().map_err(to_error)?);
  grant_trusted_path(&state, &app.path().temp_dir().map_err(to_error)?);
  fs::create_dir_all(&state.asset_cache_dir).map_err(to_error)?;
  *state.updater.lock().map_err(to_error)? = UpdaterState {
    auto_update_enabled: commands::load_auto_update_enabled(app.handle()).unwrap_or(true),
    current_version: Some(app.package_info().version.to_string()),
    ..Default::default()
  };
  let menu = menu::build_app_menu(app.handle())?;
  app.set_menu(menu).map_err(to_error)?;
  if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    restore_window_state(app.handle())?;
    let app_handle = app.handle().clone();
    window.on_window_event(move |event| {
      if matches!(
        event,
        WindowEvent::Moved(_)
          | WindowEvent::Resized(_)
          | WindowEvent::CloseRequested { .. }
          | WindowEvent::Destroyed
      ) {
        let _ = save_window_state(&app_handle);
      }
    });
    let _ = window.eval(
      r#"
        if (!window.__beaverContextMenuBound) {
          window.__beaverContextMenuBound = true;
          window.addEventListener('contextmenu', (event) => {
            const target = event.target;
            const editable = target && (
              target.closest('[contenteditable="true"]') ||
              ['INPUT', 'TEXTAREA'].includes(target.tagName)
            );
            if (!editable) return;
            event.preventDefault();
            if (window.__TAURI_INTERNALS__?.invoke) {
              window.__TAURI_INTERNALS__.invoke('show_edit_context_menu');
            }
          });
        }
      "#,
    );
  }
  bootstrap_file_open_from_argv(app.handle(), &state);
  Ok(())
}
