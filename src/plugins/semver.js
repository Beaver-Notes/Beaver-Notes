const PREID_RE = /^([-0-9]+|[a-zA-Z]+)$/;

export function parse(version) {
  if (typeof version !== 'string') return null;
  const v = version.trim();
  if (!v) return null;

  const plusIdx = v.indexOf('+');
  const build = plusIdx !== -1 ? v.slice(plusIdx + 1) : '';
  const base = plusIdx !== -1 ? v.slice(0, plusIdx) : v;

  const dashIdx = base.indexOf('-');
  const pre = dashIdx !== -1 ? base.slice(dashIdx + 1) : '';
  const core = dashIdx !== -1 ? base.slice(0, dashIdx) : base;

  const parts = core.split('.');
  if (parts.length !== 3) return null;

  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  const patch = parseInt(parts[2], 10);

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) return null;

  const preTokens = pre
    ? pre.split('.').map((t) => {
        const n = parseInt(t, 10);
        return Number.isNaN(n) ? String(t) : n;
      })
    : [];

  return { major, minor, patch, prerelease: preTokens, build };
}

export function compare(a, b) {
  const va = parse(a);
  const vb = parse(b);
  if (!va && !vb) return 0;
  if (!va) return -1;
  if (!vb) return 1;

  const coreCmp = compareCore(va, vb);
  if (coreCmp !== 0) return coreCmp;

  return comparePre(va.prerelease, vb.prerelease);
}

function compareCore(a, b) {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

function comparePre(aPre, bPre) {
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1;
  if (bPre.length === 0) return -1;

  const len = Math.min(aPre.length, bPre.length);
  for (let i = 0; i < len; i++) {
    const ai = aPre[i];
    const bi = bPre[i];
    if (typeof ai === 'number' && typeof bi === 'number') {
      if (ai !== bi) return ai > bi ? 1 : -1;
    } else if (typeof ai === 'string' && typeof bi === 'string') {
      if (ai !== bi) return ai > bi ? 1 : -1;
    } else if (typeof ai === 'number') {
      return -1;
    } else {
      return 1;
    }
  }

  if (aPre.length !== bPre.length) return aPre.length > bPre.length ? 1 : -1;
  return 0;
}

export function lt(a, b) {
  return compare(a, b) < 0;
}

export function gt(a, b) {
  return compare(a, b) > 0;
}

export function eq(a, b) {
  return compare(a, b) === 0;
}

export function gte(a, b) {
  return compare(a, b) >= 0;
}
