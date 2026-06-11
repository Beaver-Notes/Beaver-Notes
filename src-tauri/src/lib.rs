mod bootstrap;
mod commands;
mod db;
#[cfg(desktop)]
mod menu;
mod secure_blob;
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

    let portable_storage_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.to_path_buf()))
        .filter(|dir| dir.join(".portable").exists())
        .map(|dir| {
            let data = dir.join("data");
            let _ = std::fs::create_dir_all(&data);
            data
        });

    let state = AppState::new(cache_dir, external_open_dir, portable_storage_dir);
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
        .plugin(tauri_plugin_audio_recorder::init())
        .manage(state);

    #[cfg(mobile)]
    {
        builder = builder
            .plugin(tauri_plugin_safe_area_insets_css::init())
            .plugin(tauri_plugin_haptics::init());
    }

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            focus_main_window(app);
            let state = app.state::<AppState>();
            for arg in args {
                let lower = arg.to_lowercase();
                if lower.ends_with(".bea")
                    || lower.ends_with(".md")
                    || lower.ends_with(".mdx")
                    || lower.ends_with(".txt")
                    || lower.ends_with(".html")
                {
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
            commands::app::app_info,
            commands::app::app_directory,
            commands::app::migration_status,
            commands::app::migration_run,
            commands::app::migration_probe_path,
            commands::app::migration_run_with_path,
            commands::app::migration_read_legacy_data,
            commands::app::migration_write_legacy_data,
            commands::app::show_notification,
            commands::app::set_spellcheck,
            commands::app::set_zoom,
            commands::app::get_zoom,
            commands::app::set_reduced_motion,
            commands::app::get_reduced_motion,
            commands::app::set_high_contrast,
            commands::app::get_high_contrast,
            commands::app::change_menu_visibility,
            commands::app::app_ready,
            commands::app::helper_relaunch,
            commands::app::helper_get_path,
            commands::app::helper_is_dark_theme,
            commands::app::show_edit_context_menu,
            commands::external::open_file_external,
            commands::fs::fs_copy,
            commands::fs::fs_output_json,
            commands::fs::fs_read_json,
            commands::fs::fs_ensure_dir,
            commands::fs::fs_path_exists,
            commands::fs::fs_remove,
            commands::fs::fs_write_file,
            commands::fs::fs_mkdir,
            commands::fs::fs_read_file,
            commands::fs::fs_readdir,
            commands::fs::fs_stat,
            commands::fs::fs_unlink,
            commands::fs::fs_read_data,
            commands::fs::fs_is_file,
            commands::fs::fs_access,
            commands::storage::storage_get_store,
            commands::storage::storage_replace,
            commands::storage::storage_get,
            commands::storage::storage_set,
            commands::storage::storage_delete,
            commands::storage::storage_has,
            commands::storage::storage_clear,
            commands::security::safe_storage_is_available,
            commands::security::safe_storage_encrypt,
            commands::security::safe_storage_decrypt,
            commands::security::safe_storage_store_blob,
            commands::security::safe_storage_fetch_blob,
            commands::security::safe_storage_clear_blob,
            commands::security::asset_crypto_set_passphrase,
            commands::security::asset_crypto_clear_passphrase,
            commands::security::asset_crypto_migrate_dir,
            commands::security::encryption_get_state,
            commands::security::encryption_submit_password,
            commands::security::encryption_enable,
            commands::security::encryption_disable,
            commands::security::encryption_unlock,
            commands::security::encryption_lock,
            commands::security::encryption_export_app_key,
            commands::security::encryption_encrypt_note_payload,
            commands::security::encryption_decrypt_note_payload,
            commands::security::encryption_encrypt_sync_payload,
            commands::security::encryption_decrypt_sync_payload,
            commands::security::encryption_encrypt_sync_asset_base64,
            commands::security::encryption_decrypt_sync_asset_base64,
            commands::security::passwd_hash,
            commands::security::passwd_compare,
            commands::security::passwd_record_failure,
            commands::security::passwd_reset_failures,
            commands::security::is_encrypted_asset,
            commands::security::encrypt_asset,
            commands::security::decrypt_asset,
            commands::security::decrypt_asset_stream,
            commands::security::encrypt_asset_stream,
            commands::security::cache_decrypted_note,
            commands::security::get_cached_decrypted_note,
            commands::security::clear_decrypted_caches,
            commands::security::derive_argon2_key,
            commands::dialogs::dialog_open,
            commands::dialogs::dialog_message,
            commands::dialogs::dialog_save,
            commands::dialogs::get_system_fonts,
            commands::updates::check_for_updates,
            commands::updates::download_update,
            commands::updates::install_update,
            commands::updates::toggle_auto_update,
            commands::updates::get_auto_update_status,
            commands::updates::is_update_downloading,
            commands::updates::get_update_info,
            commands::imports::import_evernote,
            commands::imports::import_apple_notes,
            commands::search::search_notes,
            commands::search::search_index_note,
            commands::search::search_remove_note,
            commands::search::search_rebuild_index,
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
                    let _ = crate::commands::external::sync_external_temp_file(app, original, temp);
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
                    let lower = path.to_lowercase();
                    if lower.ends_with(".bea")
                        || lower.ends_with(".md")
                        || lower.ends_with(".mdx")
                        || lower.ends_with(".txt")
                        || lower.ends_with(".html")
                    {
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
