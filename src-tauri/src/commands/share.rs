// src-tauri/src/commands/share.rs
use serde::{Deserialize, Serialize};

pub const APP_GROUP: &str = "group.com.beavernotes.beaver-notes";

fn default_content_mode() -> String { "full".into() }

#[derive(Serialize, Deserialize, Clone)]
pub struct PendingShare {
    pub id: String,
    #[serde(default)] pub url: String,
    #[serde(default)] pub title: String,
    #[serde(default)] pub text: String,
    #[serde(default)] pub kind: String,
    #[serde(default)] pub mime_type: Option<String>,
    #[serde(default)] pub file_paths: Vec<String>,
    #[serde(default)] pub folder_id: Option<String>,
    #[serde(default)] pub workspace_id: Option<String>,
    #[serde(default)] pub target_note_id: Option<String>,
    #[serde(default = "default_content_mode")] pub content_mode: String,
    #[serde(default)] pub confirmed: bool,
    #[serde(default)] pub added_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShareFolderRef { pub id: String, pub name: String, pub icon: String }

#[derive(Serialize, Deserialize, Clone)]
pub struct ShareWorkspaceRef { pub id: String, pub name: String }

#[derive(Serialize, Deserialize, Clone)]
pub struct ShareNoteRef { pub id: String, pub title: String, #[serde(default)] pub updated_at: i64 }

const CHROME_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

#[tauri::command]
pub async fn fetch_page_html(url: String) -> Result<String, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Unsupported URL scheme".into());
    }
    // ponytail: no private-IP filtering; fine while only user-initiated shares hit this
    let client = reqwest::Client::builder()
        .user_agent(CHROME_UA)
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_pending_shares(app: tauri::AppHandle) -> Result<Vec<PendingShare>, String> {
    platform::read_pending(&app)
}

#[tauri::command]
pub fn clear_pending_shares(app: tauri::AppHandle) -> Result<(), String> {
    platform::clear_via(&app)
}

#[tauri::command]
pub fn sync_folders_to_extension(folders: Vec<ShareFolderRef>) -> Result<(), String> {
    platform::write_app_group_key("shareFolders", &folders)
}

#[tauri::command]
pub fn sync_workspaces_to_extension(workspaces: Vec<ShareWorkspaceRef>) -> Result<(), String> {
    platform::write_app_group_key("shareWorkspaces", &workspaces)
}

#[tauri::command]
pub fn sync_notes_to_extension(notes: Vec<ShareNoteRef>) -> Result<(), String> {
    platform::write_app_group_key("shareNotes", &notes)
}

// Freshness marker for the sheet Where footer. Separate key (not folded into
// the folder/note payloads) so existing structs and Swift decoders stay
// untouched; serde_json writes a bare number the Swift side reads as Int64.
#[tauri::command]
pub fn sync_extension_lists_timestamp(updated_at: i64) -> Result<(), String> {
    platform::write_app_group_key("shareListsUpdatedAt", &updated_at)
}

#[cfg(target_os = "ios")]
#[tauri::command]
pub fn read_shared_file(_app: tauri::AppHandle, path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_foundation::NSString;

    let suite = NSString::from_str(APP_GROUP);
    let container: String = unsafe {
        let cls = objc2::class!(NSFileManager);
        let mgr: Retained<AnyObject> = msg_send![cls, defaultManager];
        let url: Option<Retained<AnyObject>> =
            msg_send![&mgr, containerURLForSecurityApplicationGroupIdentifier: &*suite];
        let url = url.ok_or_else(|| "App Group container not found".to_string())?;
        let p: Option<Retained<NSString>> = msg_send![&url, path];
        p.map(|s| s.to_string())
            .ok_or_else(|| "App Group container path missing".to_string())?
    };
    // Security model: custom commands bypass fs-scope ACL, so this
    // container-prefix bound IS the access control.
    let canon_req = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let canon_base = std::fs::canonicalize(&container).map_err(|e| e.to_string())?;
    if !canon_req.starts_with(&canon_base) {
        return Err("Path outside App Group container".into());
    }
    Ok(BASE64.encode(std::fs::read(&canon_req).map_err(|e| e.to_string())?))
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn read_shared_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use tauri::Manager;
    // Same container-prefix bound as iOS: the frontend may only read files
    // the sharesheet plugin staged in the app cache dir (copyToCache).
    // Without this, Android file/image shares fail hydration — fs scope
    // denies /data/data/.../cache, so the preview modal shows an error chip.
    let base = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let canon_req = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let canon_base = std::fs::canonicalize(&base).map_err(|e| e.to_string())?;
    if !canon_req.starts_with(&canon_base) {
        return Err("Path outside app cache".into());
    }
    Ok(BASE64.encode(std::fs::read(&canon_req).map_err(|e| e.to_string())?))
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
pub fn read_shared_file(_app: tauri::AppHandle, path: String) -> Result<String, String> {
    let _ = path;
    Err("unsupported platform".into())
}

// ---- platform backends ----
// ponytail: Rust reads App Group via objc2; swap to Swift-side host-app drain (Readest NativeBridgePlugin pattern, Readest PR #4267) if objc2 friction grows

#[cfg(target_os = "ios")]
mod platform {
    use super::*;
    use objc2::msg_send;
    use objc2::AnyThread; // for NSUserDefaults::alloc()
    use objc2_foundation::{NSString, NSUserDefaults};

    fn defaults() -> Result<objc2::rc::Retained<NSUserDefaults>, String> {
        // init-family takes `this: Allocated<Self>`, so plain dot-syntax does
        // not resolve: call as an associated function.
        let suite = NSString::from_str(super::APP_GROUP);
        NSUserDefaults::initWithSuiteName(NSUserDefaults::alloc(), Some(&suite))
            .ok_or_else(|| "Failed to open App Group defaults".to_string())
    }

    pub fn read_pending(_app: &tauri::AppHandle) -> Result<Vec<PendingShare>, String> {
        match read_json_str("sharePendingSaves")? {
            None => Ok(vec![]),
            Some(s) => Ok(serde_json::from_str(&s).map_err(|e| e.to_string())?),
        }
    }

    pub fn clear_via(_app: &tauri::AppHandle) -> Result<(), String> {
        let d = defaults()?;
        unsafe {
            let k = NSString::from_str("sharePendingSaves");
            let _: () = msg_send![&d, removeObjectForKey: &*k];
        }
        Ok(())
    }

    pub fn write_pending(v: &[PendingShare]) -> Result<(), String> {
        write_app_group_key("sharePendingSaves", &v)
    }

    fn read_json_str(key: &str) -> Result<Option<String>, String> {
        let d = defaults()?;
        unsafe {
            let k = NSString::from_str(key);
            let s: Option<objc2::rc::Retained<NSString>> =
                msg_send![&d, stringForKey: &*k];
            Ok(s.map(|v| v.to_string()))
        }
    }

    pub fn write_app_group_key<T: serde::Serialize>(key: &str, value: &T) -> Result<(), String> {
        let json = serde_json::to_string(value).map_err(|e| e.to_string())?;
        let d = defaults()?;
        unsafe {
            let k = NSString::from_str(key);
            let s = NSString::from_str(&json);
            let _: () = msg_send![&d, setObject: &*s, forKey: &*k];
            let _: () = msg_send![&d, synchronize]; // deprecated but harmless; flush now
        }
        Ok(())
    }
}

#[cfg(target_os = "android")]
mod platform {
    use super::*;
    use tauri_plugin_sharesheet::SharesheetExt;

    pub fn read_pending(app: &tauri::AppHandle) -> Result<Vec<PendingShare>, String> {
        let payload = app.sharesheet().get_pending().map_err(|e| e.to_string())?;
        Ok(serde_json::from_str(&payload).unwrap_or_default())
    }
    pub fn clear_via(app: &tauri::AppHandle) -> Result<(), String> {
        app.sharesheet().clear_pending().map_err(|e| e.to_string())
    }
    pub fn write_app_group_key<T>(_key: &str, _value: &T) -> Result<(), String> { Ok(()) }
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod platform {
    use super::*;
    pub fn read_pending(_app: &tauri::AppHandle) -> Result<Vec<PendingShare>, String> { Ok(vec![]) }
    pub fn clear_via(_app: &tauri::AppHandle) -> Result<(), String> { Ok(()) }
    pub fn write_app_group_key<T>(_key: &str, _value: &T) -> Result<(), String> { Ok(()) }
}
