mod bootstrap;
mod commands;
mod db;
#[cfg(desktop)]
mod menu;
mod shared;

use tauri::{Manager, RunEvent};

use crate::{
    bootstrap::{focus_main_window, queue_or_emit_file_open},
    shared::{clear_asset_cache, clear_external_open_dir, AppState},
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_rustls_provider();

    let cache_dir = std::env::temp_dir().join("beaver-notes-asset-cache");
    let external_open_dir = std::env::temp_dir().join("beaver-notes-open");
    let state = AppState::new(cache_dir, external_open_dir);
    let mut updater = tauri_plugin_updater::Builder::new();
    if let Ok(pubkey) = std::env::var("TAURI_UPDATER_PUBKEY") {
        if !pubkey.trim().is_empty() {
            updater = updater.pubkey(pubkey);
        }
    }
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_scoped_storage::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(updater.build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(state);

    #[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_safe_area_insets_css::init());
    }

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            focus_main_window(app);
            let state = app.state::<AppState>();
            for arg in args {
                if arg.ends_with(".bea") {
                    queue_or_emit_file_open(app, state.inner(), arg);
                }
            }
        }));
    }

    #[cfg(target_os = "ios")]
    {
        builder = builder.plugin(tauri_plugin_swipe_back_ios::init());
    }

    let mut builder = bootstrap::register_asset_protocols(builder)
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::migration_status,
            commands::migration_run,
            commands::show_notification,
            commands::set_spellcheck,
            commands::open_file_external,
            commands::set_zoom,
            commands::get_zoom,
            commands::change_menu_visibility,
            commands::fs_copy,
            commands::fs_output_json,
            commands::fs_read_json,
            commands::fs_ensure_dir,
            commands::fs_path_exists,
            commands::fs_remove,
            commands::fs_write_file,
            commands::fs_mkdir,
            commands::fs_read_file,
            commands::fs_readdir,
            commands::fs_stat,
            commands::fs_unlink,
            commands::fs_read_data,
            commands::fs_is_file,
            commands::fs_access,
            commands::path_join,
            commands::path_dirname,
            commands::path_basename,
            commands::path_extname,
            commands::storage::storage_get_store,
            commands::storage::storage_replace,
            commands::storage::storage_get,
            commands::storage::storage_set,
            commands::storage::storage_delete,
            commands::storage::storage_has,
            commands::storage::storage_clear,
            commands::safe_storage_is_available,
            commands::safe_storage_encrypt,
            commands::safe_storage_decrypt,
            commands::safe_storage_store_blob,
            commands::safe_storage_fetch_blob,
            commands::safe_storage_clear_blob,
            commands::asset_crypto_set_passphrase,
            commands::asset_crypto_clear_passphrase,
            commands::passwd_hash,
            commands::passwd_compare,
            commands::passwd_record_failure,
            commands::passwd_reset_failures,
            commands::dialog_open,
            commands::dialog_message,
            commands::dialog_save,
            commands::get_system_fonts,
            commands::print_pdf,
            commands::is_encrypted_asset,
            commands::encrypt_asset,
            commands::decrypt_asset,
            commands::check_for_updates,
            commands::download_update,
            commands::install_update,
            commands::toggle_auto_update,
            commands::get_auto_update_status,
            commands::is_update_downloading,
            commands::get_update_info,
            commands::app_ready,
            commands::helper_relaunch,
            commands::helper_get_path,
            commands::helper_is_dark_theme,
            commands::imports::import_evernote,
            commands::imports::import_apple_notes,
            commands::show_edit_context_menu
        ])
        .setup(|app| {
            bootstrap::setup_app(app)?;
            Ok(())
        });

    #[cfg(desktop)]
    {
        builder = builder.on_menu_event(menu::handle_menu_event);
    }

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| match event {
        RunEvent::Exit => {
            let state = app.state::<AppState>();
            if let Ok(open_files) = state.external_open_files.lock() {
                for (original, temp) in open_files.iter() {
                    let _ = crate::commands::sync_external_temp_file(app, original, temp);
                }
            }
            clear_asset_cache(state.inner());
            clear_external_open_dir(state.inner());
        }
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        RunEvent::Opened { urls } => {
            let state = app.state::<AppState>();
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path = path.to_string_lossy().to_string();
                    if path.ends_with(".bea") {
                        queue_or_emit_file_open(app, state.inner(), path);
                    }
                }
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            focus_main_window(app);
        }
        _ => {}
    });
}

fn install_rustls_provider() {
    // reqwest/rustls can be reached during early webview bootstrap on iOS.
    // Installing the default provider up front avoids a runtime panic.
    let _ = rustls::crypto::ring::default_provider().install_default();
}
