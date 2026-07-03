import { invoke } from '@tauri-apps/api/core';

const textEncoder = new TextEncoder();

const commandAliases = {
  'app:info': 'app_info',
  'app:directory': 'app_directory',
  'app:get-high-contrast': 'get_high_contrast',
  'app:set-high-contrast': 'set_high_contrast',
  'app:get-reduced-motion': 'get_reduced_motion',
  'app:set-reduced-motion': 'set_reduced_motion',
  'migration:status': 'migration_status',
  'migration:run': 'migration_run',
  'migration:probe-path': 'migration_probe_path',
  'migration:run-with-path': 'migration_run_with_path',
  'app:spellcheck': 'set_spellcheck',
  'app:set-zoom': 'set_zoom',
  'app:get-zoom': 'get_zoom',
  'app:change-menu-visibility': 'change_menu_visibility',
  'open-file-external': 'open_file_external',
  'fs:output-json': 'fs_output_json',
  'fs:read-json': 'fs_read_json',
  'fs:ensureDir': 'fs_ensure_dir',
  'fs:pathExists': 'fs_path_exists',
  'fs:readFile': 'fs_read_file',
  'fs:readData': 'fs_read_data',
  'fs:writeFile': 'fs_write_file',
  'fs:copy': 'fs_copy',
  'fs:isFile': 'fs_is_file',
  'fs:access': 'fs_access',
  'fs:readdir': 'fs_readdir',
  'fs:stat': 'fs_stat',
  'fs:unlink': 'fs_unlink',
  'fs:mkdir': 'fs_mkdir',
  'storage:store': 'storage_get_store',
  'storage:replace': 'storage_replace',
  'storage:clear': 'storage_clear',
  'storage:get': 'storage_get',
  'storage:set': 'storage_set',
  'storage:delete': 'storage_delete',
  'storage:has': 'storage_has',
  'safeStorage:isEncryptionAvailable': 'safe_storage_is_available',
  'safeStorage:encryptString': 'safe_storage_encrypt',
  'safeStorage:decryptString': 'safe_storage_decrypt',
  'safeStorage:storeBlob': 'safe_storage_store_blob',
  'safeStorage:fetchBlob': 'safe_storage_fetch_blob',
  'safeStorage:clearBlob': 'safe_storage_clear_blob',
  'assetCrypto:setAppPassphrase': 'asset_crypto_set_passphrase',
  'assetCrypto:clearAppPassphrase': 'asset_crypto_clear_passphrase',
  'assetCrypto:migrateDir': 'asset_crypto_migrate_dir',
  'crypto:clearDecryptedCaches': 'encryption_clear_decrypted_caches',
  'encryption:getState': 'encryption_get_state',
  'encryption:submitPassword': 'encryption_submit_password',
  'encryption:enable': 'encryption_enable',
  'encryption:disable': 'encryption_disable',
  'encryption:unlock': 'encryption_unlock',
  'encryption:lock': 'encryption_lock',
  'encryption:exportAppKey': 'encryption_export_app_key',
  'encryption:encryptNotePayload': 'encryption_encrypt_note_payload',
  'encryption:decryptNotePayload': 'encryption_decrypt_note_payload',
  'encryption:encryptSyncPayload': 'encryption_encrypt_sync_payload',
  'encryption:decryptSyncPayload': 'encryption_decrypt_sync_payload',

  'assetCrypto:decryptAssetStream': 'encryption_decrypt_asset_stream',
  'assetCrypto:encryptAssetStream': 'encryption_encrypt_asset_stream',
  'crypto:cacheDecryptedNote': 'encryption_cache_decrypted_note',
  'crypto:getCachedDecryptedNote': 'encryption_get_cached_decrypted_note',
  'crypto:decryptLegacyNote': 'decrypt_legacy_cryptojs_note',
  'crypto:deriveArgon2Key': 'derive_argon2_key',
  'passwd:hash': 'passwd_hash',
  'passwd:compare': 'passwd_compare',
  'passwd:recordFailure': 'passwd_record_failure',
  'passwd:resetFailures': 'passwd_reset_failures',
  'dialog:open': 'dialog_open',
  'dialog:message': 'dialog_message',
  'dialog:save': 'dialog_save',
  'get-system-fonts': 'get_system_fonts',
  'check-for-updates': 'check_for_updates',
  'download-update': 'download_update',
  'install-update': 'install_update',
  'toggle-auto-update': 'toggle_auto_update',
  'get-auto-update-status': 'get_auto_update_status',
  'is-update-downloading': 'is_update_downloading',
  'get-update-info': 'get_update_info',
  'app-ready': 'app_ready',
  'helper:relaunch': 'helper_relaunch',
  'helper:get-path': 'helper_get_path',
  'helper:is-dark-theme': 'helper_is_dark_theme',
  'import:evernote': 'import_evernote',
  'import:apple-notes': 'import_apple_notes',
  'show-edit-context-menu': 'show_edit_context_menu',
  'search:notes': 'search_notes',
  'search:indexNote': 'search_index_note',
  'search:removeNote': 'search_remove_note',
  'search:rebuildIndex': 'search_rebuild_index',
  'spotsearch:enableIndexing': 'enable_indexing',
  'spotsearch:indexItems': 'index_items',
  'spotsearch:deleteItems': 'delete_items',
  'spotsearch:deleteDomain': 'delete_domain',
  'app-icon:isSupported': 'is_supported',
  'app-icon:getName': 'get_name',
  'app-icon:change': 'change',
  'app-icon:reset': 'reset',
  'pdf:render': 'render_pdf',
};

function withKeyVariants(key, value) {
  if (key.includes('_')) {
    const camel = key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    return { [key]: value, [camel]: value };
  }

  const snake = key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
  return { [key]: value, [snake]: value };
}

function normalizeBinaryData(data) {
  if (data == null) return [];
  if (typeof data === 'string') return Array.from(textEncoder.encode(data));
  if (data instanceof ArrayBuffer) return Array.from(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) {
    return Array.from(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    );
  }
  if (Array.isArray(data)) return data;
  return Array.from(textEncoder.encode(String(data)));
}

function normalizePayload(channel, payload) {
  switch (channel) {
    case 'app:spellcheck':
      return withKeyVariants('enabled', payload);
    case 'open-file-external':
      return withKeyVariants('src', payload);
    case 'app:set-zoom':
      return withKeyVariants('level', payload);
    case 'app:change-menu-visibility':
      return withKeyVariants('visible', payload);
    case 'fs:read-json':
    case 'fs:ensureDir':
    case 'fs:pathExists':
    case 'fs:readFile':
    case 'fs:readdir':
    case 'fs:stat':
    case 'fs:unlink':
    case 'fs:remove':
    case 'fs:readData':
      return {
        ...withKeyVariants('path', payload?.path ?? payload),
        ...(payload?.skipDecryption != null
          ? withKeyVariants('skipDecryption', payload.skipDecryption)
          : {}),
      };
    case 'fs:isFile':
    case 'fs:access':
      return withKeyVariants('path', payload);
    case 'fs:copy':
      return {
        ...withKeyVariants('path', payload?.path),
        ...withKeyVariants('dest', payload?.dest),
      };
    case 'fs:mkdir':
      return {
        ...withKeyVariants('path', payload?.path),
        ...(payload?.mode != null ? withKeyVariants('mode', payload.mode) : {}),
      };
    case 'fs:writeFile':
      return {
        ...payload,
        ...withKeyVariants('path', payload?.path),
        ...withKeyVariants('data', normalizeBinaryData(payload?.data)),
        ...withKeyVariants('mode', payload?.mode),
      };
    case 'storage:store':
    case 'storage:clear':
      return withKeyVariants('name', payload);
    case 'storage:get':
      return {
        ...payload,
        ...withKeyVariants('name', payload?.name),
        ...withKeyVariants('key', payload?.key),
        ...withKeyVariants('def', payload?.def ?? null),
      };
    case 'storage:replace':
      return {
        ...withKeyVariants('name', payload?.name),
        data: payload?.data ?? {},
      };
    case 'storage:set':
      return {
        ...payload,
        ...withKeyVariants('name', payload?.name),
        ...withKeyVariants('key', payload?.key),
        ...withKeyVariants('value', payload?.value),
      };
    case 'storage:delete':
    case 'storage:has':
      return {
        ...payload,
        ...withKeyVariants('name', payload?.name),
        ...withKeyVariants('key', payload?.key),
      };
    case 'safeStorage:encryptString':
      return withKeyVariants('plain_text', payload);
    case 'safeStorage:decryptString':
      return withKeyVariants('encrypted_base64', payload);
    case 'safeStorage:fetchBlob':
    case 'safeStorage:clearBlob':
      return withKeyVariants('key', payload);
    case 'assetCrypto:setAppPassphrase':
      return withKeyVariants('passphrase', payload);
    case 'assetCrypto:migrateDir':
      return {
        ...withKeyVariants('encrypt_at_rest', payload?.encryptAtRest),
      };
    case 'encryption:getState':
      return {};
    case 'encryption:submitPassword':
      return {
        ...withKeyVariants('password', payload?.password),
        ...(payload?.createIfMissing != null
          ? withKeyVariants('create_if_missing', payload.createIfMissing)
          : {}),
      };
    case 'encryption:enable':
      return withKeyVariants('password', payload);
    case 'encryption:disable':
      return {
        ...withKeyVariants(
          'remove_manifest',
          payload?.removeManifest ?? payload?.remove_manifest ?? true
        ),
      };
    case 'encryption:unlock':
      return withKeyVariants('password', payload?.password);
    case 'encryption:lock':
      return {};
    case 'crypto:cacheDecryptedNote':
      return {
        ...withKeyVariants('note_id', payload?.noteId),
        content: payload?.content,
      };
    case 'crypto:decryptLegacyNote':
      return {
        ...withKeyVariants(
          'ciphertext_b64',
          payload?.ciphertextB64 ?? payload?.ciphertext_b64 ?? payload
        ),
        ...withKeyVariants('password', payload?.password),
      };
    case 'encryption:encryptNotePayload':
      return withKeyVariants('plain_json', payload);
    case 'encryption:decryptNotePayload':
      return withKeyVariants('payload', payload);
    case 'encryption:encryptSyncPayload':
      return withKeyVariants('plain_text', payload);
    case 'encryption:decryptSyncPayload':
      return withKeyVariants('payload', payload);
    case 'passwd:hash':
      return withKeyVariants('password', payload);
    case 'dialog:open':
    case 'dialog:message':
    case 'dialog:save':
      return { props: payload };
    case 'migration:probe-path':
    case 'migration:run-with-path':
      return withKeyVariants('path', payload);
    case 'toggle-auto-update':
      return withKeyVariants('enabled', payload);
    case 'helper:get-path':
      return withKeyVariants('name', payload);
    case 'show-edit-context-menu':
      return payload;
    case 'search:notes':
      return {
        ...withKeyVariants('query', payload?.query),
        ...(payload?.limit != null
          ? withKeyVariants('limit', payload.limit)
          : {}),
      };
    case 'search:indexNote':
      return {
        ...withKeyVariants('id', payload?.id),
        ...withKeyVariants('title', payload?.title ?? ''),
        ...withKeyVariants('body', payload?.body ?? ''),
      };
    case 'search:removeNote':
      return withKeyVariants('id', payload?.id);
    case 'search:rebuildIndex':
      return {};
    default:
      return payload ?? {};
  }
}

function mapCommand(channel) {
  return commandAliases[channel] || channel.replace(/[:-]/g, '_');
}

export function invokeCommand(channel, payload) {
  return invoke(mapCommand(channel), normalizePayload(channel, payload));
}
