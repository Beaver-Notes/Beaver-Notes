import { invoke } from '@tauri-apps/api/core';

const textEncoder = new TextEncoder();

const commandAliases = {
  'app:info': 'app_info',
  'migration:status': 'migration_status',
  'migration:run': 'migration_run',
  'migration:probe-path': 'migration_probe_path',
  'migration:run-with-path': 'migration_run_with_path',
  'app:spellcheck': 'set_spellcheck',
  'app:set-zoom': 'set_zoom',
  'app:get-zoom': 'get_zoom',
  'app:change-menu-visibility': 'change_menu_visibility',
  'open-file-external': 'open_file_external',
  'print-pdf': 'print_pdf',
  'fs:output-json': 'fs_output_json',
  'fs:read-json': 'fs_read_json',
  'fs:ensureDir': 'fs_ensure_dir',
  'fs:pathExists': 'fs_path_exists',
  'fs:readFile': 'fs_read_file',
  'fs:readData': 'fs_read_data',
  'fs:writeFile': 'fs_write_file',
  'fs:copy': 'fs_copy',
  'fs:isFile': 'fs_is_file',
  'storage:store': 'storage_get_store',
  'storage:replace': 'storage_replace',
  'safeStorage:isEncryptionAvailable': 'safe_storage_is_available',
  'safeStorage:encryptString': 'safe_storage_encrypt',
  'safeStorage:decryptString': 'safe_storage_decrypt',
  'safeStorage:storeBlob': 'safe_storage_store_blob',
  'safeStorage:fetchBlob': 'safe_storage_fetch_blob',
  'safeStorage:clearBlob': 'safe_storage_clear_blob',
  'assetCrypto:setAppPassphrase': 'asset_crypto_set_passphrase',
  'assetCrypto:clearAppPassphrase': 'asset_crypto_clear_passphrase',
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
    case 'fs:remove':
    case 'fs:readFile':
    case 'fs:readdir':
    case 'fs:stat':
    case 'fs:unlink':
    case 'fs:readData':
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
    case 'passwd:hash':
      return withKeyVariants('password', payload);
    case 'dialog:open':
    case 'dialog:message':
    case 'dialog:save':
      return { props: payload };
    case 'print-pdf':
      return {
        ...payload,
        ...withKeyVariants('pdf_name', payload?.pdfName ?? payload?.pdf_name),
      };
    case 'migration:probe-path':
    case 'migration:run-with-path':
      return withKeyVariants('path', payload);
    case 'toggle-auto-update':
      return withKeyVariants('enabled', payload);
    case 'helper:get-path':
      return withKeyVariants('name', payload);
    case 'show-edit-context-menu':
      return payload;
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
