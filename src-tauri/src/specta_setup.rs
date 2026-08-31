use std::path::Path;
use specta::Types;
use tauri_specta::LanguageExt;

pub fn generate_bindings() {
    let child = std::thread::Builder::new()
        .stack_size(512 * 1024 * 1024)
        .spawn(|| {
            let mut types = Types::default();

            let all_fns = vec![
                // ── App lifecycle ────────────────────────────────────────────────
                specta::_fn_datatype!(crate::commands::app::app_info)(&mut types),
                specta::_fn_datatype!(crate::commands::app::app_directory)(&mut types),
                specta::_fn_datatype!(crate::commands::app::migration_status)(&mut types),
                specta::_fn_datatype!(crate::commands::app::migration_run)(&mut types),
                specta::_fn_datatype!(crate::commands::app::migration_probe_path)(&mut types),
                specta::_fn_datatype!(crate::commands::app::migration_run_with_path)(&mut types),
                specta::_fn_datatype!(crate::commands::app::migration_read_legacy_data)(&mut types),
                specta::_fn_datatype!(crate::commands::app::migration_write_legacy_data)(&mut types),
                specta::_fn_datatype!(crate::commands::app::show_notification)(&mut types),
                specta::_fn_datatype!(crate::commands::app::set_spellcheck)(&mut types),
                specta::_fn_datatype!(crate::commands::app::set_zoom)(&mut types),
                specta::_fn_datatype!(crate::commands::app::get_zoom)(&mut types),
                specta::_fn_datatype!(crate::commands::app::set_reduced_motion)(&mut types),
                specta::_fn_datatype!(crate::commands::app::get_reduced_motion)(&mut types),
                specta::_fn_datatype!(crate::commands::app::set_high_contrast)(&mut types),
                specta::_fn_datatype!(crate::commands::app::get_high_contrast)(&mut types),
                specta::_fn_datatype!(crate::commands::app::change_menu_visibility)(&mut types),
                specta::_fn_datatype!(crate::commands::app::app_ready)(&mut types),
                specta::_fn_datatype!(crate::commands::app::helper_relaunch)(&mut types),
                specta::_fn_datatype!(crate::commands::app::helper_get_path)(&mut types),
                specta::_fn_datatype!(crate::commands::app::helper_is_dark_theme)(&mut types),
                specta::_fn_datatype!(crate::commands::app::show_edit_context_menu)(&mut types),
                // ── Backup ──────────────────────────────────────────────────────
                specta::_fn_datatype!(crate::commands::backup::backup_export)(&mut types),
                specta::_fn_datatype!(crate::commands::backup::backup_import)(&mut types),
                // ── External files ───────────────────────────────────────────────
                specta::_fn_datatype!(crate::commands::external::open_file_external)(&mut types),
                // ── Filesystem ───────────────────────────────────────────────────
                specta::_fn_datatype!(crate::commands::fs::fs_copy)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_output_json)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_read_json)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_ensure_dir)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_path_exists)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_remove)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_write_file)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_mkdir)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_read_file)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_read_file_binary)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_readdir)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_stat)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_unlink)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_read_data)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_is_file)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_access)(&mut types),
                specta::_fn_datatype!(crate::commands::fs::fs_download_url)(&mut types),
                // ── KV storage ───────────────────────────────────────────────────
                specta::_fn_datatype!(crate::commands::storage::storage_get_store)(&mut types),
                specta::_fn_datatype!(crate::commands::storage::storage_replace)(&mut types),
                specta::_fn_datatype!(crate::commands::storage::storage_get)(&mut types),
                specta::_fn_datatype!(crate::commands::storage::storage_set)(&mut types),
                specta::_fn_datatype!(crate::commands::storage::storage_delete)(&mut types),
                specta::_fn_datatype!(crate::commands::storage::storage_has)(&mut types),
                specta::_fn_datatype!(crate::commands::storage::storage_clear)(&mut types),
                specta::_fn_datatype!(crate::commands::storage::storage_reencrypt_legacy_rows)(&mut types),
                specta::_fn_datatype!(crate::commands::storage::storage_repair_settings)(&mut types),
                // ── Encryption & security ────────────────────────────────────────
                specta::_fn_datatype!(crate::commands::security::safe_storage_is_available)(&mut types),
                specta::_fn_datatype!(crate::commands::security::safe_storage_get_backend_info)(&mut types),
                specta::_fn_datatype!(crate::commands::security::safe_storage_encrypt)(&mut types),
                specta::_fn_datatype!(crate::commands::security::safe_storage_decrypt)(&mut types),
                specta::_fn_datatype!(crate::commands::security::safe_storage_store_blob)(&mut types),
                specta::_fn_datatype!(crate::commands::security::safe_storage_fetch_blob)(&mut types),
                specta::_fn_datatype!(crate::commands::security::safe_storage_clear_blob)(&mut types),
                specta::_fn_datatype!(crate::commands::security::safe_storage_set_device_password)(&mut types),
                specta::_fn_datatype!(crate::commands::security::asset_crypto_set_passphrase)(&mut types),
                specta::_fn_datatype!(crate::commands::security::asset_crypto_clear_passphrase)(&mut types),
                specta::_fn_datatype!(crate::commands::security::asset_crypto_migrate_dir)(&mut types),
                specta::_fn_datatype!(crate::commands::security::encryption_get_state)(&mut types),
                specta::_fn_datatype!(crate::commands::security::encryption_submit_password)(&mut types),
                specta::_fn_datatype!(crate::commands::security::encryption_enable)(&mut types),
                specta::_fn_datatype!(crate::commands::security::encryption_unlock)(&mut types),
                specta::_fn_datatype!(crate::commands::security::encryption_lock)(&mut types),
                specta::_fn_datatype!(crate::commands::security::encryption_encrypt_note_payload)(&mut types),
                specta::_fn_datatype!(crate::commands::security::encryption_decrypt_note_payload)(&mut types),
                specta::_fn_datatype!(crate::commands::security::sync_encrypt_payload)(&mut types),
                specta::_fn_datatype!(crate::commands::security::sync_decrypt_payload)(&mut types),
                specta::_fn_datatype!(crate::commands::security::sync_encrypt_batch)(&mut types),
                specta::_fn_datatype!(crate::commands::security::sync_decrypt_batch)(&mut types),
                specta::_fn_datatype!(crate::commands::security::sync_key_ready)(&mut types),
                specta::_fn_datatype!(crate::commands::security::encryption_reconcile_key_params)(&mut types),
                specta::_fn_datatype!(crate::commands::security::encryption_adopt_key_params)(&mut types),
                specta::_fn_datatype!(crate::commands::security::encryption_has_remote_key_params)(&mut types),
                specta::_fn_datatype!(crate::commands::security::passwd_hash)(&mut types),
                specta::_fn_datatype!(crate::commands::security::passwd_compare)(&mut types),
                specta::_fn_datatype!(crate::commands::security::passwd_record_failure)(&mut types),
                specta::_fn_datatype!(crate::commands::security::passwd_reset_failures)(&mut types),
                specta::_fn_datatype!(crate::commands::security::encryption_decrypt_asset_stream)(&mut types),
                specta::_fn_datatype!(crate::commands::security::encryption_encrypt_asset_stream)(&mut types),
                specta::_fn_datatype!(crate::commands::security::encryption_cache_decrypted_note)(&mut types),
                specta::_fn_datatype!(crate::commands::security::encryption_get_cached_decrypted_note)(&mut types),
                specta::_fn_datatype!(crate::commands::security::encryption_clear_decrypted_caches)(&mut types),
                specta::_fn_datatype!(crate::commands::security::decrypt_legacy_cryptojs_note)(&mut types),
                specta::_fn_datatype!(crate::commands::security::derive_argon2_key)(&mut types),
                specta::_fn_datatype!(crate::commands::security::vault_derive_proof)(&mut types),
                // ── Dialogs ──────────────────────────────────────────────────────
                specta::_fn_datatype!(crate::commands::dialogs::dialog_open)(&mut types),
                specta::_fn_datatype!(crate::commands::dialogs::dialog_message)(&mut types),
                specta::_fn_datatype!(crate::commands::dialogs::dialog_save)(&mut types),
                specta::_fn_datatype!(crate::commands::dialogs::get_system_fonts)(&mut types),
                // ── Updates ──────────────────────────────────────────────────────
                specta::_fn_datatype!(crate::commands::updates::get_installation_source)(&mut types),
                specta::_fn_datatype!(crate::commands::updates::check_for_updates)(&mut types),
                specta::_fn_datatype!(crate::commands::updates::download_update)(&mut types),
                specta::_fn_datatype!(crate::commands::updates::install_update)(&mut types),
                specta::_fn_datatype!(crate::commands::updates::toggle_auto_update)(&mut types),
                specta::_fn_datatype!(crate::commands::updates::get_auto_update_status)(&mut types),
                specta::_fn_datatype!(crate::commands::updates::is_update_downloading)(&mut types),
                specta::_fn_datatype!(crate::commands::updates::get_update_info)(&mut types),
                // ── Imports ──────────────────────────────────────────────────────
                specta::_fn_datatype!(crate::commands::imports::import_evernote)(&mut types),
                specta::_fn_datatype!(crate::commands::imports::import_apple_notes)(&mut types),
                // ── PDF ──────────────────────────────────────────────────────────
                specta::_fn_datatype!(crate::commands::pdf::render_pdf)(&mut types),
                // ── Yjs CRDT ─────────────────────────────────────────────────────
                specta::_fn_datatype!(crate::commands::yjs::yjs_append)(&mut types),
                specta::_fn_datatype!(crate::commands::yjs::yjs_append_batch)(&mut types),
                specta::_fn_datatype!(crate::commands::yjs::yjs_get_updates)(&mut types),
                specta::_fn_datatype!(crate::commands::yjs::yjs_get_snapshot)(&mut types),
                specta::_fn_datatype!(crate::commands::yjs::yjs_get_snapshots)(&mut types),
                specta::_fn_datatype!(crate::commands::yjs::yjs_compact)(&mut types),
                specta::_fn_datatype!(crate::commands::yjs::yjs_compact_batch)(&mut types),
                specta::_fn_datatype!(crate::commands::yjs::yjs_delete)(&mut types),
                // ── Index persistence ────────────────────────────────────────────
                specta::_fn_datatype!(crate::commands::index::index_save)(&mut types),
                specta::_fn_datatype!(crate::commands::index::index_load)(&mut types),
                // ── Search index ──────────────────────────────────────────────────
                specta::_fn_datatype!(crate::commands::search::search_extract_index_data)(&mut types),
                // ── Workspaces ───────────────────────────────────────────────────
                specta::_fn_datatype!(crate::commands::workspace::workspace_list)(&mut types),
                specta::_fn_datatype!(crate::commands::workspace::workspace_get_active)(&mut types),
                specta::_fn_datatype!(crate::commands::workspace::workspace_create)(&mut types),
                specta::_fn_datatype!(crate::commands::workspace::workspace_register_cloud)(&mut types),
                specta::_fn_datatype!(crate::commands::workspace::workspace_switch)(&mut types),
                specta::_fn_datatype!(crate::commands::workspace::workspace_rename)(&mut types),
                specta::_fn_datatype!(crate::commands::workspace::workspace_delete)(&mut types),
            ];

            eprintln!("Collected {} commands, {} types", all_fns.len(), types.len());

            let mut cfg = tauri_specta::BuilderConfiguration::default();
            cfg.commands = all_fns;
            cfg.types = types;
            cfg.dangerously_cast_bigints_to_number = true;

            eprintln!("Starting export...");
            let start = std::time::Instant::now();
            specta_typescript::Typescript::default()
                .export(&cfg, Path::new("../src/lib/tauri/bindings.ts"))
                .expect("failed to generate specta bindings");
            eprintln!("Export complete in {:?}", start.elapsed());
        })
        .expect("failed to spawn thread");
    child.join().expect("binding generation panicked");
}
