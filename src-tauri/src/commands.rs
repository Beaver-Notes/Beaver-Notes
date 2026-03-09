use std::{
  fs,
  io::Write,
  path::{Path, PathBuf},
  sync::{Arc, Mutex},
  time::SystemTime,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use bcrypt::{hash, verify, DEFAULT_COST};
use font_kit::source::SystemSource;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager, State, Theme, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

use crate::{menu::build_context_menu, shared::*};

fn key_segments(key: &str) -> Vec<&str> {
  key.split('.').filter(|segment| !segment.is_empty()).collect()
}

fn store_entries_value(store: &Arc<tauri_plugin_store::Store<Wry>>) -> Result<Value, String> {
  store.reload().map_err(to_error)?;
  let mut object = Map::new();
  for (key, value) in store.entries() {
    object.insert(key, value);
  }
  Ok(Value::Object(object))
}

fn replace_store_contents(
  store: &Arc<tauri_plugin_store::Store<Wry>>,
  data: Value,
) -> Result<(), String> {
  store.clear();
  if let Value::Object(entries) = data {
    for (key, value) in entries {
      store.set(key, value);
    }
  }
  store.save().map_err(to_error)
}

fn get_nested_value<'a>(value: &'a Value, segments: &[&str]) -> Option<&'a Value> {
  let mut current = value;
  for segment in segments {
    current = current.as_object()?.get(*segment)?;
  }
  Some(current)
}

fn set_nested_value(current: &mut Value, segments: &[&str], new_value: Value) {
  if segments.is_empty() {
    *current = new_value;
    return;
  }

  if !current.is_object() {
    *current = Value::Object(Map::new());
  }

  let mut node = current;
  for segment in &segments[..segments.len() - 1] {
    let object = node.as_object_mut().expect("object expected");
    node = object
      .entry((*segment).to_string())
      .or_insert_with(|| Value::Object(Map::new()));
    if !node.is_object() {
      *node = Value::Object(Map::new());
    }
  }

  let object = node.as_object_mut().expect("object expected");
  object.insert(segments[segments.len() - 1].to_string(), new_value);
}

fn delete_nested_value(current: &mut Value, segments: &[&str]) -> bool {
  if segments.is_empty() {
    return false;
  }

  let Some(object) = current.as_object_mut() else {
    return false;
  };

  if segments.len() == 1 {
    return object.remove(segments[0]).is_some();
  }

  let segment = segments[0];
  let mut should_remove_child = false;
  let removed = if let Some(child) = object.get_mut(segment) {
    let removed = delete_nested_value(child, &segments[1..]);
    should_remove_child = matches!(child, Value::Object(map) if map.is_empty());
    removed
  } else {
    false
  };

  if should_remove_child {
    object.remove(segment);
  }

  removed
}

#[tauri::command]
pub(crate) fn app_info(app: AppHandle) -> Result<AppInfo, String> {
  Ok(AppInfo {
    name: app.package_info().name.clone(),
    version: app.package_info().version.to_string(),
  })
}

#[tauri::command]
pub(crate) fn show_notification(
  app: AppHandle,
  title: String,
  body: String,
) -> Result<(), String> {
  app
    .notification()
    .builder()
    .title(title)
    .body(body)
    .show()
    .map_err(to_error)
}

#[tauri::command]
pub(crate) fn set_spellcheck(app: AppHandle, enabled: bool) -> Result<(), String> {
  if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    window
      .emit("spellcheck-changed", json!({ "enabled": enabled }))
      .map_err(to_error)?;
  }
  Ok(())
}

#[tauri::command]
pub(crate) fn set_zoom(
  app: AppHandle,
  state: State<AppState>,
  level: f64,
) -> Result<(), String> {
  if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    window.set_zoom(level).map_err(to_error)?;
  }
  *state.zoom_level.lock().map_err(to_error)? = level;
  Ok(())
}

#[tauri::command]
pub(crate) fn get_zoom(state: State<AppState>) -> Result<f64, String> {
  Ok(*state.zoom_level.lock().map_err(to_error)?)
}

#[tauri::command]
pub(crate) fn change_menu_visibility(app: AppHandle, visible: bool) -> Result<(), String> {
  if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    if visible {
      window.show_menu().map_err(to_error)?;
    } else {
      window.hide_menu().map_err(to_error)?;
    }
  }
  Ok(())
}

pub(crate) fn sync_external_temp_file(
  app: &AppHandle,
  original_path: &Path,
  temp_file: &Path,
) -> Result<(), String> {
  if !temp_file.exists() {
    return Ok(());
  }

  let state = app.state::<AppState>();
  let raw = fs::read(temp_file).map_err(to_error)?;
  let existing = fs::read(original_path).map_err(to_error)?;
  let payload = if is_encrypted_asset_buffer(&existing) {
    maybe_encrypt_asset(app, &state, original_path, &raw, false)?
  } else {
    raw
  };
  fs::write(original_path, payload).map_err(to_error)?;
  app
    .emit_to(
      MAIN_WINDOW_LABEL,
      "file-updated",
      json!({ "originalPath": original_path.to_string_lossy().to_string() }),
    )
    .map_err(to_error)
}

fn temp_file_signature(path: &Path) -> Option<(u128, u64)> {
  let metadata = fs::metadata(path).ok()?;
  let modified = metadata
    .modified()
    .ok()?
    .duration_since(SystemTime::UNIX_EPOCH)
    .ok()?
    .as_millis();
  Some((modified, metadata.len()))
}

fn tracked_temp_file(app: &AppHandle, original_path: &Path) -> Option<PathBuf> {
  app
    .state::<AppState>()
    .external_open_files
    .lock()
    .ok()
    .and_then(|files| files.get(original_path).cloned())
}

fn track_temp_file(app: &AppHandle, original_path: &Path, temp_file: &Path) {
  if let Ok(mut files) = app.state::<AppState>().external_open_files.lock() {
    files.insert(original_path.to_path_buf(), temp_file.to_path_buf());
  }
}

fn watch_external_temp_file(
  app: AppHandle,
  original_path: PathBuf,
  temp_file: PathBuf,
) -> Result<(), String> {
  let initial_signature = temp_file_signature(&temp_file);

  std::thread::spawn(move || {
    let mut last_signature = initial_signature;
    loop {
      std::thread::sleep(std::time::Duration::from_millis(350));

      let current_signature = temp_file_signature(&temp_file);
      if current_signature.is_none() {
        break;
      }
      if current_signature == last_signature {
        continue;
      }

      std::thread::sleep(std::time::Duration::from_millis(150));
      if let Err(error) = sync_external_temp_file(&app, &original_path, &temp_file) {
        eprintln!(
          "[external-open] failed syncing {} back to {}: {}",
          temp_file.display(),
          original_path.display(),
          error
        );
      } else {
        last_signature = temp_file_signature(&temp_file);
      }
    }
  });

  Ok(())
}

#[tauri::command]
pub(crate) fn open_file_external(
  app: AppHandle,
  state: State<AppState>,
  src: String,
) -> Result<String, String> {
  let mut src = src;
  if src.starts_with("file-assets:") && !src.starts_with("file-assets://") {
    src = src.replacen("file-assets:", "file-assets://", 1);
  }
  let full_path =
    resolve_asset_path_from_uri(&app, &src).unwrap_or_else(|_| PathBuf::from(&src));
  assert_path_access(&app, &state, &full_path, "open file externally")?;
  if !full_path.exists() {
    return Err(format!("File not found: {}", full_path.display()));
  }

  if let Some(existing_temp) = tracked_temp_file(&app, &full_path) {
    if existing_temp.exists() {
      let _ = sync_external_temp_file(&app, &full_path, &existing_temp);
      app
        .opener()
        .open_path(existing_temp.to_string_lossy().to_string(), None::<String>)
        .map_err(to_error)?;
      return Ok(existing_temp.to_string_lossy().to_string());
    }
  }

  let temp_dir = state.external_open_dir.clone();
  fs::create_dir_all(&temp_dir).map_err(to_error)?;
  let ext = full_path
    .extension()
    .and_then(|v| v.to_str())
    .unwrap_or_default();
  let stem = full_path
    .file_stem()
    .and_then(|v| v.to_str())
    .unwrap_or("asset");
  let temp_file = temp_dir.join(if ext.is_empty() {
    format!("{stem}-{}", now_millis())
  } else {
    format!("{stem}-{}.{}", now_millis(), ext)
  });
  let raw = fs::read(&full_path).map_err(to_error)?;
  let payload = maybe_decrypt_asset(&app, &state, &full_path, &raw)?;
  fs::write(&temp_file, payload).map_err(to_error)?;
  track_temp_file(&app, &full_path, &temp_file);
  watch_external_temp_file(app.clone(), full_path.clone(), temp_file.clone())?;
  app
    .opener()
    .open_path(temp_file.to_string_lossy().to_string(), None::<String>)
    .map_err(|error| {
      let _ = fs::remove_file(&temp_file);
      to_error(error)
    })?;
  Ok(temp_file.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn fs_copy(
  app: AppHandle,
  state: State<AppState>,
  path: String,
  dest: String,
) -> Result<(), String> {
  let src_path = PathBuf::from(path);
  let dest_path = PathBuf::from(dest);
  assert_path_access(&app, &state, &src_path, "copy source")?;
  assert_path_access(&app, &state, &dest_path, "copy destination")?;

  if src_path.is_dir() {
    copy_dir_recursive(&app, &state, &src_path, &dest_path)?;
    return Ok(());
  }

  let mut final_dest = dest_path.clone();
  if final_dest.exists() && final_dest.is_dir() {
    final_dest = final_dest.join(src_path.file_name().unwrap_or_default());
  }
  if let Some(parent) = final_dest.parent() {
    fs::create_dir_all(parent).map_err(to_error)?;
  }
  let raw = fs::read(&src_path).map_err(to_error)?;
  let payload = maybe_encrypt_asset(&app, &state, &final_dest, &raw, false)?;
  fs::write(final_dest, payload).map_err(to_error)
}

fn copy_dir_recursive(
  app: &AppHandle,
  state: &State<'_, AppState>,
  src: &Path,
  dest: &Path,
) -> Result<(), String> {
  fs::create_dir_all(dest).map_err(to_error)?;
  for entry in fs::read_dir(src).map_err(to_error)? {
    let entry = entry.map_err(to_error)?;
    let src_path = entry.path();
    let dest_path = dest.join(entry.file_name());
    if src_path.is_dir() {
      copy_dir_recursive(app, state, &src_path, &dest_path)?;
    } else {
      let raw = fs::read(&src_path).map_err(to_error)?;
      let payload = maybe_encrypt_asset(app, state, &dest_path, &raw, false)?;
      fs::write(dest_path, payload).map_err(to_error)?;
    }
  }
  Ok(())
}

#[tauri::command]
pub(crate) fn fs_output_json(
  app: AppHandle,
  state: State<AppState>,
  path: String,
  data: Value,
) -> Result<(), String> {
  let path = PathBuf::from(path);
  assert_path_access(&app, &state, &path, "write json")?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(to_error)?;
  }
  let serialized = serde_json::to_vec_pretty(&data).map_err(to_error)?;
  fs::write(path, serialized).map_err(to_error)
}

#[tauri::command]
pub(crate) fn fs_read_json(
  app: AppHandle,
  state: State<AppState>,
  path: String,
) -> Result<Value, String> {
  let path = PathBuf::from(path);
  assert_path_access(&app, &state, &path, "read json")?;
  let raw = fs::read_to_string(path).map_err(to_error)?;
  serde_json::from_str(&raw).map_err(to_error)
}

#[tauri::command]
pub(crate) fn fs_ensure_dir(
  app: AppHandle,
  state: State<AppState>,
  path: String,
) -> Result<(), String> {
  let path = PathBuf::from(path);
  assert_path_access(&app, &state, &path, "ensure directory")?;
  fs::create_dir_all(path).map_err(to_error)
}

#[tauri::command]
pub(crate) fn fs_path_exists(
  app: AppHandle,
  state: State<AppState>,
  path: String,
) -> Result<bool, String> {
  let path = PathBuf::from(path);
  assert_path_access(&app, &state, &path, "check path exists")?;
  Ok(path.exists())
}

#[tauri::command]
pub(crate) fn fs_remove(
  app: AppHandle,
  state: State<AppState>,
  path: String,
) -> Result<(), String> {
  let path = PathBuf::from(path);
  assert_path_access(&app, &state, &path, "remove path")?;
  if path.is_dir() {
    fs::remove_dir_all(path).map_err(to_error)
  } else {
    fs::remove_file(path).map_err(to_error)
  }
}

#[tauri::command]
pub(crate) fn fs_write_file(
  app: AppHandle,
  state: State<AppState>,
  path: String,
  data: Vec<u8>,
  mode: Option<u32>,
  skip_asset_encryption: Option<bool>,
) -> Result<(), String> {
  let path = PathBuf::from(path);
  assert_path_access(&app, &state, &path, "write file")?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(to_error)?;
  }
  let payload = maybe_encrypt_asset(
    &app,
    &state,
    &path,
    &data,
    skip_asset_encryption.unwrap_or(false),
  )?;
  let mut file = fs::File::create(&path).map_err(to_error)?;
  file.write_all(&payload).map_err(to_error)?;
  #[cfg(unix)]
  if let Some(mode) = mode {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(to_error)?;
  }
  Ok(())
}

#[tauri::command]
pub(crate) fn fs_mkdir(
  app: AppHandle,
  state: State<AppState>,
  path: String,
  mode: Option<u32>,
) -> Result<(), String> {
  let path = PathBuf::from(path);
  assert_path_access(&app, &state, &path, "mkdir")?;
  fs::create_dir_all(&path).map_err(to_error)?;
  #[cfg(unix)]
  if let Some(mode) = mode {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(to_error)?;
  }
  Ok(())
}

#[tauri::command]
pub(crate) fn fs_read_file(
  app: AppHandle,
  state: State<AppState>,
  path: String,
) -> Result<String, String> {
  let path = PathBuf::from(path);
  assert_path_access(&app, &state, &path, "read file")?;
  fs::read_to_string(path).map_err(to_error)
}

#[tauri::command]
pub(crate) fn fs_readdir(
  app: AppHandle,
  state: State<AppState>,
  path: String,
) -> Result<Vec<String>, String> {
  let path = PathBuf::from(path);
  assert_path_access(&app, &state, &path, "read directory")?;
  let mut entries = fs::read_dir(path)
    .map_err(to_error)?
    .flatten()
    .map(|entry| entry.file_name().to_string_lossy().to_string())
    .collect::<Vec<_>>();
  entries.sort();
  Ok(entries)
}

#[tauri::command]
pub(crate) fn fs_stat(
  app: AppHandle,
  state: State<AppState>,
  path: String,
) -> Result<FileStat, String> {
  let path = PathBuf::from(path);
  assert_path_access(&app, &state, &path, "stat")?;
  Ok(to_file_stat(fs::metadata(path).map_err(to_error)?))
}

#[tauri::command]
pub(crate) fn fs_unlink(
  app: AppHandle,
  state: State<AppState>,
  path: String,
) -> Result<(), String> {
  let path = PathBuf::from(path);
  assert_path_access(&app, &state, &path, "unlink")?;
  fs::remove_file(path).map_err(to_error)
}

#[tauri::command]
pub(crate) fn fs_read_data(
  app: AppHandle,
  state: State<AppState>,
  path: String,
) -> Result<String, String> {
  let actual_path = resolve_asset_path_from_uri(&app, &path)?;
  assert_path_access(&app, &state, &actual_path, "read data")?;
  let raw = fs::read(&actual_path).map_err(to_error)?;
  let plain = maybe_decrypt_asset(&app, &state, &actual_path, &raw)?;
  Ok(BASE64.encode(plain))
}

#[tauri::command]
pub(crate) fn fs_is_file(
  app: AppHandle,
  state: State<AppState>,
  path: String,
) -> Result<bool, String> {
  let path = PathBuf::from(path);
  assert_path_access(&app, &state, &path, "is file")?;
  Ok(path.is_file())
}

#[tauri::command]
pub(crate) fn fs_access(
  app: AppHandle,
  state: State<AppState>,
  path: String,
) -> Result<bool, String> {
  let path = PathBuf::from(path);
  assert_path_access(&app, &state, &path, "access check")?;
  Ok(path.exists())
}

#[tauri::command]
pub(crate) fn path_join(segments: Vec<String>) -> Result<String, String> {
  let mut output = PathBuf::new();
  for segment in segments {
    output.push(segment);
  }
  Ok(output.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn path_dirname(path: String) -> Result<String, String> {
  Ok(Path::new(&path)
    .parent()
    .unwrap_or_else(|| Path::new(""))
    .to_string_lossy()
    .to_string())
}

#[tauri::command]
pub(crate) fn path_basename(path: String) -> Result<String, String> {
  Ok(Path::new(&path)
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or_default()
    .to_string())
}

#[tauri::command]
pub(crate) fn path_extname(path: String) -> Result<String, String> {
  Ok(Path::new(&path)
    .extension()
    .and_then(|value| value.to_str())
    .map(|value| format!(".{value}"))
    .unwrap_or_default())
}

#[tauri::command]
pub(crate) fn storage_get_store(app: AppHandle, name: String) -> Result<Value, String> {
  let store_name = allowed_store_name(&name)?;
  let store = ensure_store(&app, store_name)?;
  store_entries_value(&store)
}

#[tauri::command]
pub(crate) fn storage_replace(
  app: AppHandle,
  name: String,
  data: Value,
) -> Result<(), String> {
  let store_name = allowed_store_name(&name)?;
  let store = ensure_store(&app, store_name)?;
  replace_store_contents(&store, data)
}

#[tauri::command]
pub(crate) fn storage_get(
  app: AppHandle,
  name: String,
  key: String,
  def: Value,
) -> Result<Value, String> {
  let store_name = allowed_store_name(&name)?;
  let store = ensure_store(&app, store_name)?;
  let root = store_entries_value(&store)?;
  let segments = key_segments(&key);
  if segments.is_empty() {
    return Ok(def);
  }
  Ok(get_nested_value(&root, &segments).cloned().unwrap_or(def))
}

#[tauri::command]
pub(crate) fn storage_set(
  app: AppHandle,
  name: String,
  key: String,
  value: Value,
) -> Result<(), String> {
  let store_name = allowed_store_name(&name)?;
  let store = ensure_store(&app, store_name)?;
  let mut root = store_entries_value(&store)?;
  let segments = key_segments(&key);
  if segments.is_empty() {
    return Ok(());
  }
  set_nested_value(&mut root, &segments, value);
  replace_store_contents(&store, root)
}

#[tauri::command]
pub(crate) fn storage_delete(
  app: AppHandle,
  name: String,
  key: String,
) -> Result<(), String> {
  let store_name = allowed_store_name(&name)?;
  let store = ensure_store(&app, store_name)?;
  let mut root = store_entries_value(&store)?;
  let segments = key_segments(&key);
  if segments.is_empty() {
    return Ok(());
  }
  let _ = delete_nested_value(&mut root, &segments);
  replace_store_contents(&store, root)
}

#[tauri::command]
pub(crate) fn storage_has(
  app: AppHandle,
  name: String,
  key: String,
) -> Result<bool, String> {
  let store_name = allowed_store_name(&name)?;
  let store = ensure_store(&app, store_name)?;
  let root = store_entries_value(&store)?;
  let segments = key_segments(&key);
  if segments.is_empty() {
    return Ok(false);
  }
  Ok(get_nested_value(&root, &segments).is_some())
}

#[tauri::command]
pub(crate) fn storage_clear(app: AppHandle, name: String) -> Result<(), String> {
  let store_name = allowed_store_name(&name)?;
  let store = ensure_store(&app, store_name)?;
  store.clear();
  store.save().map_err(to_error)
}

#[tauri::command]
pub(crate) fn safe_storage_is_available() -> Result<bool, String> {
  Ok(true)
}

#[tauri::command]
pub(crate) fn safe_storage_encrypt(plain_text: String) -> Result<String, String> {
  safe_storage_encrypt_bytes(plain_text.as_bytes())
}

#[tauri::command]
pub(crate) fn safe_storage_decrypt(encrypted_base64: String) -> Result<String, String> {
  let decrypted = safe_storage_decrypt_bytes(&encrypted_base64)?;
  String::from_utf8(decrypted).map_err(to_error)
}

#[tauri::command]
pub(crate) fn safe_storage_store_blob(
  app: AppHandle,
  key: String,
  blob: String,
) -> Result<(), String> {
  allowed_blob_key(&key)?;
  if stronghold_save_record(&app, &key, blob.as_bytes().to_vec()).is_ok() {
    return Ok(());
  }
  keyring_entry(&key)?.set_password(&blob).map_err(to_error)
}

#[tauri::command]
pub(crate) fn safe_storage_fetch_blob(
  app: AppHandle,
  key: String,
) -> Result<Option<String>, String> {
  allowed_blob_key(&key)?;
  if let Some(value) =
    stronghold_get_record(&app, &key)?.and_then(|bytes| String::from_utf8(bytes).ok())
  {
    return Ok(Some(value));
  }

  let entry = keyring_entry(&key)?;
  match entry.get_password() {
    Ok(value) => {
      let _ = stronghold_save_record(&app, &key, value.as_bytes().to_vec());
      Ok(Some(value))
    }
    Err(_) => Ok(None),
  }
}

#[tauri::command]
pub(crate) fn safe_storage_clear_blob(
  app: AppHandle,
  key: String,
) -> Result<(), String> {
  allowed_blob_key(&key)?;
  let _ = stronghold_remove_record(&app, &key);
  let entry = keyring_entry(&key)?;
  let _ = entry.delete_password();
  Ok(())
}

#[tauri::command]
pub(crate) fn asset_crypto_set_passphrase(
  app: AppHandle,
  state: State<AppState>,
  passphrase: String,
) -> Result<(), String> {
  *state.transient_passphrase.lock().map_err(to_error)? = passphrase.clone();
  if stronghold_save_record(&app, APP_PASSPHRASE_ACCOUNT, passphrase.as_bytes().to_vec())
    .is_ok()
  {
    return Ok(());
  }
  keyring_entry(APP_PASSPHRASE_ACCOUNT)?
    .set_password(&passphrase)
    .map_err(to_error)
}

#[tauri::command]
pub(crate) fn asset_crypto_clear_passphrase(
  app: AppHandle,
  state: State<AppState>,
) -> Result<(), String> {
  state.transient_passphrase.lock().map_err(to_error)?.clear();
  let _ = stronghold_remove_record(&app, APP_PASSPHRASE_ACCOUNT);
  let _ = keyring_entry(APP_PASSPHRASE_ACCOUNT)?.delete_password();
  Ok(())
}

#[tauri::command]
pub(crate) fn passwd_hash(password: String) -> Result<String, String> {
  hash(password, DEFAULT_COST).map_err(to_error)
}

#[tauri::command]
pub(crate) fn passwd_compare(password: String, hash: String) -> Result<bool, String> {
  if hash.is_empty() {
    return Ok(false);
  }
  verify(password, &hash).map_err(to_error)
}

#[tauri::command]
pub(crate) fn passwd_record_failure(state: State<AppState>) -> Result<FailureResult, String> {
  let mut failures = state.failure_count.lock().map_err(to_error)?;
  *failures += 1;
  Ok(FailureResult {
    fail_count: *failures,
    warn: *failures >= WARN_THRESHOLD,
  })
}

#[tauri::command]
pub(crate) fn passwd_reset_failures(state: State<AppState>) -> Result<(), String> {
  *state.failure_count.lock().map_err(to_error)? = 0;
  Ok(())
}

#[tauri::command]
pub(crate) async fn dialog_open(
  app: AppHandle,
  state: State<'_, AppState>,
  props: OpenDialogOptions,
) -> Result<DialogResult, String> {
  let app_clone = app.clone();
  let window = app.get_webview_window(MAIN_WINDOW_LABEL);
  let props_clone = props.clone();
  let result = tokio::task::spawn_blocking(move || {
    let builder = configure_file_dialog(app_clone.dialog().file(), &props_clone, window.as_ref());
    let properties = props_clone.properties.unwrap_or_default();
    let multiple = props_clone
      .multiple
      .unwrap_or_else(|| properties.iter().any(|p| p == "multiSelections"));
    let wants_directory = props_clone
      .directory
      .unwrap_or_else(|| properties.iter().any(|p| p == "openDirectory"));
    if wants_directory {
      if multiple {
        builder
          .blocking_pick_folders()
          .map(dialog_file_paths_to_strings)
          .unwrap_or_default()
      } else {
        builder
          .blocking_pick_folder()
          .and_then(dialog_file_path_to_string)
          .map(|path| vec![path])
          .unwrap_or_default()
      }
    } else if multiple {
      builder
        .blocking_pick_files()
        .map(dialog_file_paths_to_strings)
        .unwrap_or_default()
    } else {
      builder
        .blocking_pick_file()
        .and_then(dialog_file_path_to_string)
        .map(|path| vec![path])
        .unwrap_or_default()
    }
  })
  .await
  .map_err(to_error)?;

  let trusted = result.iter().map(PathBuf::from).collect::<Vec<_>>();
  grant_dialog_paths(&state, &trusted);
  Ok(DialogResult {
    canceled: result.is_empty(),
    file_paths: result,
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
    let mut builder = app
      .dialog()
      .message(props.message)
      .title(title)
      .kind(kind);
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
    if let Some(window) = window.as_ref() {
      builder = builder.set_parent(window);
    }
    if let Some(filters) = props_clone.filters {
      for filter in filters {
        let exts = filter.extensions.iter().map(String::as_str).collect::<Vec<_>>();
        builder = builder.add_filter(filter.name, &exts);
      }
    }
    builder.blocking_save_file().and_then(dialog_file_path_to_string)
  })
  .await
  .map_err(to_error)?;

  if let Some(path) = &file_path {
    grant_dialog_paths(&state, &[PathBuf::from(path)]);
  }

  Ok(SaveDialogResult {
    canceled: file_path.is_none(),
    file_path,
  })
}

#[tauri::command]
pub(crate) fn get_system_fonts() -> Result<Vec<String>, String> {
  let fonts = SystemSource::new()
    .all_families()
    .map_err(to_error)?
    .into_iter()
    .collect::<Vec<_>>();
  Ok(fonts)
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
    app
      .emit_to(
        MAIN_WINDOW_LABEL,
        "print-pdf-request",
        json!({ "pdfName": pdf_name, "filePath": save.file_path }),
      )
      .map_err(to_error)?;
  }
  Ok(())
}

#[tauri::command]
pub(crate) fn is_encrypted_asset(path: String) -> Result<bool, String> {
  let raw = fs::read(path).map_err(to_error)?;
  Ok(is_encrypted_asset_buffer(&raw))
}

#[tauri::command]
pub(crate) fn encrypt_asset(
  app: AppHandle,
  state: State<AppState>,
  path: String,
) -> Result<(), String> {
  let path = PathBuf::from(path);
  let raw = fs::read(&path).map_err(to_error)?;
  let passphrase = current_asset_passphrase(&app, &state)?;
  let salt_hex = app_crypto_salt_hex(&app)?;
  let encrypted = encrypt_asset_bytes(&passphrase, &raw, &salt_hex)?;
  fs::write(path, encrypted).map_err(to_error)
}

#[tauri::command]
pub(crate) fn decrypt_asset(
  app: AppHandle,
  state: State<AppState>,
  path: String,
) -> Result<Vec<u8>, String> {
  let path = PathBuf::from(path);
  let raw = fs::read(&path).map_err(to_error)?;
  let passphrase = current_asset_passphrase(&app, &state)?;
  let salt_hex = app_crypto_salt_hex(&app)?;
  decrypt_asset_bytes(&passphrase, &raw, &salt_hex)
}

fn emit_update_status(
  app: &AppHandle,
  message: &str,
  kind: &str,
  extra: Value,
) -> Result<(), String> {
  let mut payload = json!({
    "message": message,
    "type": kind,
    "timestamp": chrono::Utc::now().to_rfc3339(),
  });
  if let Some(map) = payload.as_object_mut() {
    if let Some(extra_map) = extra.as_object() {
      for (key, value) in extra_map {
        map.insert(key.clone(), value.clone());
      }
    }
  }
  app
    .emit_to(MAIN_WINDOW_LABEL, "update-status-changed", payload)
    .map_err(to_error)
}

fn emit_update_progress(
  app: &AppHandle,
  percent: f64,
  transferred: u64,
  total: u64,
  bytes_per_second: f64,
) -> Result<(), String> {
  app
    .emit_to(
      MAIN_WINDOW_LABEL,
      "update-progress-changed",
      json!({
        "percent": percent,
        "transferred": transferred,
        "total": total,
        "bytesPerSecond": bytes_per_second,
      }),
    )
    .map_err(to_error)
}

pub(crate) fn load_auto_update_enabled(app: &AppHandle) -> Result<bool, String> {
  let store = ensure_store(app, SETTINGS_STORE)?;
  Ok(store
    .get("autoUpdateEnabled")
    .and_then(|value| value.as_bool())
    .unwrap_or(true))
}

fn save_auto_update_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
  let store = ensure_store(app, SETTINGS_STORE)?;
  store.set("autoUpdateEnabled", json!(enabled));
  store.save().map_err(to_error)
}

#[tauri::command]
pub(crate) async fn check_for_updates(
  app: AppHandle,
  state: State<'_, AppState>,
) -> Result<CheckResult, String> {
  {
    let mut updater = state.updater.lock().map_err(to_error)?;
    if updater.is_checking || updater.is_downloading {
      return Ok(CheckResult {
        success: false,
        available: updater.available_version.is_some(),
        version: updater.available_version.clone(),
        error: Some("Update check already in progress".into()),
      });
    }
    updater.is_checking = true;
  }
  let _ = emit_update_status(&app, "Checking for updates...", "checking", json!({}));

  let updater_client = match app.updater().map_err(to_error) {
    Ok(client) => client,
    Err(error) => {
      let mut updater = state.updater.lock().map_err(to_error)?;
      updater.is_checking = false;
      let _ = emit_update_status(
        &app,
        &format!("Update check failed: {error}"),
        "error",
        json!({ "error": error.clone() }),
      );
      return Ok(CheckResult {
        success: false,
        available: false,
        version: None,
        error: Some(error),
      });
    }
  };

  match updater_client.check().await.map_err(to_error) {
    Err(error) => {
      let mut updater = state.updater.lock().map_err(to_error)?;
      updater.is_checking = false;
      let _ = emit_update_status(
        &app,
        &format!("Update check failed: {error}"),
        "error",
        json!({ "error": error.clone() }),
      );
      Ok(CheckResult {
        success: false,
        available: false,
        version: None,
        error: Some(error),
      })
    }
    Ok(Some(update)) => {
      let mut updater = state.updater.lock().map_err(to_error)?;
      updater.is_checking = false;
      updater.available_version = Some(update.version.clone());
      updater.current_version = Some(update.current_version.clone());
      updater.downloaded_update = Some(update.clone());
      let version = update.version.clone();
      let _ = emit_update_status(
        &app,
        &format!("Update available: {version}"),
        "available",
        json!({ "version": version }),
      );
      Ok(CheckResult {
        success: true,
        available: true,
        version: Some(update.version),
        error: None,
      })
    }
    Ok(None) => {
      let current = app.package_info().version.to_string();
      let mut updater = state.updater.lock().map_err(to_error)?;
      updater.is_checking = false;
      updater.current_version = Some(current.clone());
      updater.available_version = None;
      let _ = emit_update_status(
        &app,
        "You have the latest version",
        "not-available",
        json!({ "version": current }),
      );
      Ok(CheckResult {
        success: true,
        available: false,
        version: None,
        error: None,
      })
    }
  }
}

#[tauri::command]
pub(crate) async fn download_update(
  app: AppHandle,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let update = {
    let mut updater = state.updater.lock().map_err(to_error)?;
    if updater.is_downloading {
      return Err("Download already in progress".into());
    }
    updater.is_downloading = true;
    updater
      .downloaded_update
      .clone()
      .ok_or_else(|| "No update available to download".to_string())?
  };

  let started = std::time::Instant::now();
  let mut transferred = 0_u64;
  let total_holder = Arc::new(Mutex::new(0_u64));
  let total_ref = total_holder.clone();
  let progress_app = app.clone();
  let bytes = update
    .download(
      move |chunk_length, total| {
        transferred += chunk_length as u64;
        let total_bytes = total.unwrap_or_default();
        if let Ok(mut total_guard) = total_ref.lock() {
          *total_guard = total_bytes;
        }
        let percent = if total_bytes > 0 {
          (transferred as f64 / total_bytes as f64) * 100.0
        } else {
          0.0
        };
        let elapsed = started.elapsed().as_secs_f64().max(0.001);
        let rate = transferred as f64 / elapsed;
        let _ = emit_update_progress(&progress_app, percent, transferred, total_bytes, rate);
      },
      || {},
    )
    .await
    .map_err(to_error)?;

  let version = update.version.clone();
  let banner = BannerData {
    content: format!("An update is ready: {version}"),
    primary_text: "Install now".into(),
    secondary_text: "Later".into(),
    version: version.clone(),
  };

  let mut updater = state.updater.lock().map_err(to_error)?;
  updater.is_downloading = false;
  updater.pending_banner_data = Some(banner.clone());
  updater.downloaded_bytes = Some(bytes);
  drop(updater);

  let _ = emit_update_status(
    &app,
    &format!("Update ready to install: {version}"),
    "ready",
    json!({ "version": version }),
  );
  app.emit_to(MAIN_WINDOW_LABEL, "update-banner", banner)
    .map_err(to_error)
}

#[tauri::command]
pub(crate) fn install_update(state: State<AppState>) -> Result<(), String> {
  let updater = state.updater.lock().map_err(to_error)?;
  let update = updater
    .downloaded_update
    .clone()
    .ok_or_else(|| "No downloaded update".to_string())?;
  let bytes = updater
    .downloaded_bytes
    .clone()
    .ok_or_else(|| "No update payload available".to_string())?;
  update.install(bytes).map_err(to_error)
}

#[tauri::command]
pub(crate) fn toggle_auto_update(
  app: AppHandle,
  state: State<AppState>,
  enabled: bool,
) -> Result<(), String> {
  save_auto_update_enabled(&app, enabled)?;
  state.updater.lock().map_err(to_error)?.auto_update_enabled = enabled;
  Ok(())
}

#[tauri::command]
pub(crate) fn get_auto_update_status(state: State<AppState>) -> Result<bool, String> {
  Ok(state.updater.lock().map_err(to_error)?.auto_update_enabled)
}

#[tauri::command]
pub(crate) fn is_update_downloading(state: State<AppState>) -> Result<bool, String> {
  Ok(state.updater.lock().map_err(to_error)?.is_downloading)
}

#[tauri::command]
pub(crate) fn get_update_info(state: State<AppState>) -> Result<UpdateInfo, String> {
  let updater = state.updater.lock().map_err(to_error)?;
  Ok(UpdateInfo {
    is_checking: updater.is_checking,
    is_downloading: updater.is_downloading,
    current_version: updater.current_version.clone(),
    available_version: updater.available_version.clone(),
    auto_update_enabled: updater.auto_update_enabled,
    is_busy: updater.is_checking || updater.is_downloading,
  })
}

#[tauri::command]
pub(crate) fn app_ready(app: AppHandle, state: State<AppState>) -> Result<(), String> {
  if let Some(banner) = state
    .updater
    .lock()
    .map_err(to_error)?
    .pending_banner_data
    .clone()
  {
    app.emit_to(MAIN_WINDOW_LABEL, "update-banner", banner)
      .map_err(to_error)?;
  }
  let queued = state.pending_open_files.lock().map_err(to_error)?.clone();
  for file_path in queued {
    app.emit_to(MAIN_WINDOW_LABEL, "file-opened", file_path)
      .map_err(to_error)?;
  }
  Ok(())
}

#[tauri::command]
pub(crate) fn helper_relaunch(app: AppHandle) -> Result<(), String> {
  app.restart();
  #[allow(unreachable_code)]
  Ok(())
}

#[tauri::command]
pub(crate) fn helper_get_path(app: AppHandle, name: String) -> Result<String, String> {
  Ok(path_for_name(&app, &name)?.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn helper_is_dark_theme(app: AppHandle) -> Result<bool, String> {
  let theme = app
    .get_webview_window(MAIN_WINDOW_LABEL)
    .and_then(|window| window.theme().ok())
    .unwrap_or(Theme::Light);
  Ok(matches!(theme, Theme::Dark))
}

#[tauri::command]
pub(crate) fn show_edit_context_menu(app: AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window(MAIN_WINDOW_LABEL)
    .ok_or_else(|| "Main window not found".to_string())?;
  let menu = build_context_menu(&app)?;
  window.popup_menu(&menu).map_err(to_error)
}
