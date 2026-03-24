function detectWindowsPath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\');
}

function pathSeparator(values) {
  return values.some(
    (value) => typeof value === 'string' && detectWindowsPath(value)
  )
    ? '\\'
    : '/';
}

export function buildPath(...parts) {
  if (parts.length === 0) return '';

  const source = parts.map((part) => String(part ?? ''));
  const sep = pathSeparator(source);
  const first = source[0].replace(/\\/g, '/');
  const driveMatch = first.match(/^([A-Za-z]:)(\/.*)?$/);
  const isAbsolute = first.startsWith('/') || Boolean(driveMatch);
  const prefix = driveMatch ? driveMatch[1] : isAbsolute ? sep : '';
  const stack = [];

  source.forEach((part) => {
    const normalized = String(part || '').replace(/\\/g, '/');
    normalized.split('/').forEach((segment) => {
      if (!segment || segment === '.') return;
      if (segment === '..') {
        if (stack.length > 0) stack.pop();
        return;
      }
      if (/^[A-Za-z]:$/.test(segment)) {
        stack.length = 0;
        return;
      }
      stack.push(segment);
    });
  });

  const body = stack.join(sep);
  if (!prefix) return body;
  if (!body) return prefix;
  return prefix.endsWith(sep) ? `${prefix}${body}` : `${prefix}${sep}${body}`;
}

export function dirnameSync(value) {
  const raw = String(value || '');
  if (!raw) return '';
  const normalized = raw.replace(/\\/g, '/');
  const withoutTrailing = normalized.replace(/\/+$/, '');
  const lastSlash = withoutTrailing.lastIndexOf('/');

  if (lastSlash <= 0) {
    const driveMatch = withoutTrailing.match(/^([A-Za-z]:)$/);
    if (driveMatch) return `${driveMatch[1]}\\`;
    return lastSlash === 0 ? raw.slice(0, 1) : '';
  }

  const dir = withoutTrailing.slice(0, lastSlash);
  return pathSeparator([raw]) === '\\' ? dir.replace(/\//g, '\\') : dir;
}

export function basenameSync(value) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  return normalized.split('/').pop() || '';
}

export function extnameSync(value) {
  const base = basenameSync(value);
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(index) : '';
}

export function parseSync(value) {
  const base = basenameSync(value);
  const ext = extnameSync(base);
  return {
    root: '',
    dir: dirnameSync(value),
    base,
    ext,
    name: ext ? base.slice(0, -ext.length) : base,
  };
}
