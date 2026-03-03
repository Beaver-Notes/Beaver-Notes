import path from 'path';
import store from '../../store';

const ROOT_BY_SCHEME = {
  assets: 'notes-assets',
  'file-assets': 'file-assets',
};

function _stripQueryAndHash(value) {
  const noHash = value.split('#')[0];
  return noHash.split('?')[0];
}

function _decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function _safeResolve(baseDir, relativePath) {
  const target = path.resolve(baseDir, relativePath);
  const rel = path.relative(baseDir, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Asset path escapes base directory: ${relativePath}`);
  }
  return target;
}

function _relativeFromProtocolUrl(protocolUrl, scheme) {
  const prefix = `${scheme}://`;
  if (!protocolUrl.startsWith(prefix)) return null;
  const raw = protocolUrl.slice(prefix.length).replace(/^\/+/, '');
  return _decode(_stripQueryAndHash(raw));
}

function _getDataDir() {
  return store.settings.get('dataDir');
}

export function resolveAssetPathFromProtocolUrl(protocolUrl, scheme) {
  const root = ROOT_BY_SCHEME[scheme];
  if (!root) throw new Error(`Unsupported asset scheme: ${scheme}`);

  const rel = _relativeFromProtocolUrl(protocolUrl, scheme);
  if (!rel) throw new Error(`Invalid ${scheme} protocol URL: ${protocolUrl}`);

  const dataDir = _getDataDir();
  if (!dataDir) throw new Error('Data directory not configured');

  return _safeResolve(path.join(dataDir, root), rel);
}

export function resolveAssetPathFromAssetUri(assetUri) {
  if (typeof assetUri !== 'string') return assetUri;

  if (assetUri.startsWith('assets://')) {
    return resolveAssetPathFromProtocolUrl(assetUri, 'assets');
  }
  if (assetUri.startsWith('file-assets://')) {
    return resolveAssetPathFromProtocolUrl(assetUri, 'file-assets');
  }

  return assetUri;
}
