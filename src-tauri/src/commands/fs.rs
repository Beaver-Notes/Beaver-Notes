use std::{
    collections::HashMap,
    fs,
    io::Write,
    net::IpAddr,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use reqwest::Url;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::shared::{RawJson, *};

const DOWNLOAD_CHUNK_SIZE: usize = 64 * 1024; // 64 KB

#[tauri::command]
#[specta::specta]
pub(crate) async fn fs_copy(app: AppHandle, path: String, dest: String) -> Result<(), AppError> {
    // Recursive copy plus per-file AES is I/O heavy: run off main thread.
    let app = app.clone();
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
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
            fs::create_dir_all(parent)?;
        }
        // Asset destinations are encrypted with the items key. For a plaintext
        // file source, stream the encryption (constant memory) instead of
        // reading the whole file into RAM; already-encrypted bodies are copied
        // verbatim, matching `encrypt_asset` idempotency.
        if is_local_asset_path(&app, &final_dest) && !source_is_encrypted(&src_path)? {
            let key = current_app_key(&state)?.ok_or(AppError::EncryptionLocked)?;
            let temp = final_dest.with_file_name(format!(
                ".{}.tmp",
                final_dest
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("asset")
            ));
            encrypt_asset_streaming(&src_path, &temp, &key)?;
            fs::rename(&temp, &final_dest)?;
        } else {
            fs::copy(&src_path, &final_dest)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

fn copy_dir_recursive(
    app: &AppHandle,
    state: &State<'_, AppState>,
    src: &Path,
    dest: &Path,
) -> Result<(), AppError> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(app, state, &src_path, &dest_path)?;
        } else {
            let raw = fs::read(&src_path)?;
            let payload = encrypt_asset(app, state, &dest_path, &raw)?;
            fs::write(dest_path, payload)?;
        }
    }
    Ok(())
}

/// True when the file already carries an encrypted-asset magic header, so a
/// copy must not encrypt it a second time.
fn source_is_encrypted(path: &Path) -> Result<bool, AppError> {
    use std::io::Read;
    let size = fs::metadata(path)?.len();
    let mut magic = [0u8; 4];
    let mut file = fs::File::open(path)?;
    if file.read_exact(&mut magic).is_err() {
        return Ok(false);
    }
    Ok(is_encrypted_asset_header(&magic, size))
}

#[tauri::command]
#[specta::specta]
pub(crate) fn fs_output_json(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    data: RawJson,
) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "write json")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let serialized = serde_json::to_vec_pretty(&*data)?;
    fs::write(path, serialized)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn fs_read_json(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<RawJson, AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "read json")?;
    let raw = fs::read_to_string(path)?;
    Ok(serde_json::from_str::<Value>(&raw)?.into())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn fs_ensure_dir(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "ensure directory")?;
    fs::create_dir_all(path)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn fs_path_exists(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<bool, AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "check path exists")?;
    Ok(path.exists())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn fs_remove(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "remove path")?;
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn fs_write_file(
    app: AppHandle,
    path: String,
    data: String,
    mode: Option<u32>,
) -> Result<(), AppError> {
    let app = app.clone();
    tokio::task::spawn_blocking(move || {
        let _t = crate::shared::speed_log::scope("fs.fs_write_file");
        let state = app.state::<AppState>();
        let data = BASE64.decode(data)?;
        let path = PathBuf::from(path);
        assert_path_access(&app, &state, &path, "write file")?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let payload = encrypt_asset(&app, &state, &path, &data)?;
        let mut file = fs::File::create(&path)?;
        file.write_all(&payload)?;
        #[cfg(unix)]
        if let Some(mode) = mode {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

// Appends raw (plaintext) bytes. Used to stage large browser File/Blob inputs in
// bounded chunks so a whole multi-hundred-MB asset never buffers in the WebView.
// Unlike fs_write_file this never encrypts; callers stage plaintext and then
// stream-encrypt via fs_copy into the assets directory.
#[tauri::command]
#[specta::specta]
pub(crate) async fn fs_append_file(
    app: AppHandle,
    path: String,
    data: String,
) -> Result<(), AppError> {
    let app = app.clone();
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let data = BASE64.decode(data)?;
        let path = PathBuf::from(path);
        assert_path_access(&app, &state, &path, "append file")?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        file.write_all(&data)?;
        file.flush()?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub(crate) fn fs_mkdir(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    mode: Option<u32>,
) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "mkdir")?;
    fs::create_dir_all(&path)?;
    #[cfg(unix)]
    if let Some(mode) = mode {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn fs_read_file(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<String, AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "read file")?;
    Ok(fs::read_to_string(path)?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn fs_read_file_binary(app: AppHandle, path: String) -> Result<String, AppError> {
    let app = app.clone();
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let path = PathBuf::from(path);
        assert_path_access(&app, &state, &path, "read file binary")?;
        Ok(BASE64.encode(fs::read(path)?))
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub(crate) fn fs_readdir(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<Vec<String>, AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "read directory")?;
    let mut entries = fs::read_dir(path)?
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    entries.sort();
    Ok(entries)
}

#[tauri::command]
#[specta::specta]
pub(crate) fn fs_stat(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<FileStat, AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "stat")?;
    Ok(to_file_stat(fs::metadata(path)?))
}

static FILE_ICON_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

// Linux resolves icons via GTK and must run on the main thread.
#[cfg(target_os = "linux")]
fn fetch_file_icon(
    app: &AppHandle,
    path: &Path,
    size: u16,
) -> Option<file_icon_provider::Icon> {
    let (tx, rx) = std::sync::mpsc::channel();
    let path = path.to_path_buf();
    if app
        .run_on_main_thread(move || {
            let _ = tx.send(file_icon_provider::get_file_icon(path, size).ok());
        })
        .is_err()
    {
        return None;
    }
    rx.recv().ok().flatten()
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn fetch_file_icon(
    _app: &AppHandle,
    path: &Path,
    size: u16,
) -> Option<file_icon_provider::Icon> {
    file_icon_provider::get_file_icon(path, size).ok()
}

/// System icon for a file, as base64 PNG. Cached by extension; the frontend
/// falls back to a generic icon when this errors (mobile, missing file).
#[tauri::command]
#[specta::specta]
pub(crate) fn fs_file_icon(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    size: Option<u16>,
) -> Result<String, AppError> {
    let actual_path = resolve_asset_path_from_uri(&app, &path)?;
    assert_path_access(&app, &state, &actual_path, "read file icon")?;
    if !actual_path.is_file() {
        return Err(AppError::Other("File not found".into()));
    }
    let size = size.unwrap_or(96).clamp(16, 256);
    let ext = actual_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    // Windows embeds a per-file icon in .exe: key those by path, the rest by extension.
    let key = if ext == "exe" {
        format!("exe:{}", actual_path.display())
    } else {
        format!("{ext}:{size}")
    };
    if let Some(hit) = FILE_ICON_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .ok()
        .and_then(|cache| cache.get(&key).cloned())
    {
        return Ok(hit);
    }
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        let icon = fetch_file_icon(&app, &actual_path, size)
            .ok_or_else(|| AppError::Other("No system icon available".into()))?;
        let image = image::RgbaImage::from_raw(icon.width, icon.height, icon.pixels)
            .ok_or_else(|| AppError::Other("Invalid icon pixels".into()))?;
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_to(
                &mut std::io::Cursor::new(&mut png),
                image::ImageFormat::Png,
            )
            .map_err(|e| AppError::Other(e.to_string()))?;
        let encoded = BASE64.encode(png);
        if let Ok(mut cache) = FILE_ICON_CACHE
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
        {
            cache.insert(key, encoded.clone());
        }
        return Ok(encoded);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err(AppError::Other(
            "File icons are not supported on this platform".into(),
        ))
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) fn fs_unlink(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "unlink")?;
    fs::remove_file(path)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn fs_read_data(
    app: AppHandle,
    path: String,
    skip_decryption: Option<bool>,
) -> Result<String, AppError> {
    let app = app.clone();
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let actual_path = resolve_asset_path_from_uri(&app, &path)?;
        assert_path_access(&app, &state, &actual_path, "read data")?;
        let raw = fs::read(&actual_path)?;
        let plain = if skip_decryption.unwrap_or(false) {
            raw
        } else {
            decrypt_asset(&app, &state, &actual_path, &raw)?
        };
        Ok(BASE64.encode(plain))
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub(crate) fn fs_is_file(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<bool, AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "is file")?;
    Ok(path.is_file())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn fs_access(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<bool, AppError> {
    let path = PathBuf::from(path);
    assert_path_access(&app, &state, &path, "access check")?;
    Ok(path.exists())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn fs_download_url(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    dest: String,
) -> Result<u64, AppError> {
    let dest_path = PathBuf::from(&dest);
    assert_path_access(&app, &state, &dest_path, "download destination")?;

    let parsed = Url::parse(&url).map_err(|e| AppError::Other(format!("Invalid URL: {e}")))?;
    if parsed.scheme() != "https" {
        return Err(AppError::Other("Only https:// URLs are allowed".into()));
    }
    let host = parsed.host_str().ok_or_else(|| AppError::Other("URL missing host".into()))?;
    if host.eq_ignore_ascii_case("localhost")
        || host.eq_ignore_ascii_case("metadata.google.internal")
        || host.eq_ignore_ascii_case("kubernetes.default.svc")
    {
        return Err(AppError::Other("Blocked host".into()));
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_ip(&ip) {
            return Err(AppError::Other("Blocked private IP".into()));
        }
    }
    if parsed.username() != "" || parsed.password().is_some() {
        return Err(AppError::Other("URL must not contain credentials".into()));
    }

    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Other(format!("Failed to create HTTP client: {e}")))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Download request failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Other(format!(
            "Download failed with status {}",
            resp.status()
        )));
    }

    const MAX_DOWNLOAD_BYTES: u64 = 50 * 1024 * 1024;
    let mut file = fs::File::create(&dest_path)?;
    let mut total: u64 = 0;
    let mut stream = resp.bytes_stream();

    use futures_util::StreamExt;
    while let Some(chunk_result) = stream.next().await {
        let chunk =
            chunk_result.map_err(|e| AppError::Other(format!("Download stream error: {e}")))?;
        total += chunk.len() as u64;
        if total > MAX_DOWNLOAD_BYTES {
            drop(file);
            let _ = fs::remove_file(&dest_path);
            return Err(AppError::Other("Download exceeds size limit".into()));
        }
        file.write_all(&chunk)?;
    }

    file.flush()?;
    Ok(total)
}

fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.octets()[0] == 0
        }
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified() || v6.is_multicast(),
    }
}
