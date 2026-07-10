import JSZip from 'jszip';
import {
  PluginValidationError,
  PluginLoadError as PluginLoadErr,
} from './PluginError';
import { PluginSandbox } from './PluginSandbox';

function parseBeax(arrayBuffer) {
  return JSZip.loadAsync(arrayBuffer);
}

function readTextFile(zip, path) {
  return zip.files[path] ? zip.files[path].async('text') : null;
}

function readBinaryFile(zip, path) {
  return zip.files[path] ? zip.files[path].async('arraybuffer') : null;
}

export function validateManifest(manifest, pluginId) {
  if (!manifest || typeof manifest !== 'object') {
    throw new PluginValidationError('manifest.json is missing or invalid');
  }

  const id = manifest.id;
  if (!id || typeof id !== 'string') {
    throw new PluginValidationError(
      'manifest.json must have a string "id" field'
    );
  }

  const name = manifest.name;
  if (!name || typeof name !== 'string') {
    throw new PluginValidationError(
      'manifest.json must have a string "name" field'
    );
  }

  const version = manifest.version;
  if (!version || typeof version !== 'string') {
    throw new PluginValidationError(
      'manifest.json must have a string "version" field'
    );
  }

  const minAppVersion = manifest.minAppVersion;
  if (minAppVersion !== undefined && typeof minAppVersion !== 'string') {
    throw new PluginValidationError(
      'manifest.json "minAppVersion" must be a string'
    );
  }

  const main = manifest.main;
  if (!main || typeof main !== 'string') {
    throw new PluginValidationError(
      'manifest.json must have a string "main" field'
    );
  }

  const planes = manifest.planes;
  if (planes !== undefined) {
    if (!Array.isArray(planes)) {
      throw new PluginValidationError(
        'manifest.json "planes" must be an array'
      );
    }
    for (const plane of planes) {
      if (!['app', 'editor'].includes(plane)) {
        throw new PluginValidationError(
          `Unknown plane "${plane}" in manifest.json. Valid: "app", "editor"`
        );
      }
    }
  }

  const permissions = manifest.permissions;
  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) {
      throw new PluginValidationError(
        'manifest.json "permissions" must be an array'
      );
    }
    const valid = CoreAccess.VALID_PERMISSIONS;
    for (const perm of permissions) {
      if (!valid.includes(perm)) {
        throw new PluginValidationError(
          `Unknown permission "${perm}" in manifest.json. Valid: ${valid.join(
            ', '
          )}`
        );
      }
    }
  }

  return {
    id,
    name,
    version,
    author: manifest.author || '',
    description: manifest.description || '',
    icon: manifest.icon || 'riPuzzle2Line',
    planes: planes || [],
    permissions: permissions || [],
    minAppVersion: minAppVersion || null,
    isDesktopOnly: manifest.isDesktopOnly || false,
    main: manifest.main,
    settings: manifest.settings || null,
    settingsFile: manifest.settingsFile || null,
    storageSchemaVersion: manifest.storageSchemaVersion || null,
  };
}

export async function loadBeaxFile(arrayBuffer) {
  const zip = await parseBeax(arrayBuffer);

  const manifestRaw = await readTextFile(zip, 'manifest.json');
  if (!manifestRaw) {
    throw new PluginValidationError('.beax file must contain manifest.json');
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (e) {
    throw new PluginValidationError('manifest.json is not valid JSON', e);
  }

  const validated = validateManifest(manifest);
  const mainPath = validated.main;

  const sourceCode = await readTextFile(zip, mainPath);
  if (!sourceCode) {
    throw new PluginValidationError(
      `Entry file "${mainPath}" not found in .beax`
    );
  }

  const iconBuffer =
    validated.icon && !validated.icon.startsWith('ri')
      ? await readBinaryFile(zip, validated.icon)
      : null;

  let settingsSource = null;
  if (validated.settingsFile) {
    settingsSource = await readTextFile(zip, validated.settingsFile);
  }

  return {
    manifest: validated,
    sourceCode,
    settingsSource,
    iconBuffer,
  };
}

export async function evaluatePlugin(beaverNotes, sourceCode) {
  const sandbox = new PluginSandbox(beaverNotes.id, sourceCode, beaverNotes);
  let exports;
  try {
    exports = sandbox.evaluate();
  } catch (e) {
    throw new PluginLoadErr(
      beaverNotes.id,
      `Failed to evaluate plugin code: ${e.message}`,
      e
    );
  }

  if (typeof exports.setup !== 'function') {
    throw new PluginLoadErr(
      beaverNotes.id,
      'Plugin must export a "setup" function'
    );
  }

  return exports;
}

export async function evaluateSettings(settingsSource, pluginId, manifest) {
  if (!settingsSource) return null;

  const sandbox = new PluginSandbox(pluginId, settingsSource, {});
  let exports;
  try {
    exports = sandbox.evaluate();
  } catch (e) {
    console.warn(
      `[PluginLoader] Failed to load settings for "${pluginId}":`,
      e
    );
    return null;
  }

  if (typeof exports.settings !== 'function') {
    console.warn(
      `[PluginLoader] settingsFile for "${pluginId}" must export a "settings" function`
    );
    return null;
  }

  return exports.settings;
}
