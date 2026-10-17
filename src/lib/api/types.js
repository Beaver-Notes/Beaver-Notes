export const PLAN_NAMES = Object.freeze({
  FREE: 'free',
  STARTER: 'starter',
  PRO: 'pro',
  TEAM: 'team',
  ENTERPRISE: 'enterprise',
});

export const PAID_PLANS = Object.freeze([
  PLAN_NAMES.STARTER,
  PLAN_NAMES.PRO,
  PLAN_NAMES.TEAM,
  PLAN_NAMES.ENTERPRISE,
]);

// Single source of truth for user-facing plan labels. Plan ids stay stable in
// PLAN_NAMES; the entry tier (`starter`) is marketed as "Basic".
export const PLAN_LABELS = Object.freeze({
  [PLAN_NAMES.FREE]: 'Free',
  [PLAN_NAMES.STARTER]: 'Basic',
  [PLAN_NAMES.PRO]: 'Pro',
  [PLAN_NAMES.TEAM]: 'Team',
  [PLAN_NAMES.ENTERPRISE]: 'Enterprise',
});

export function planLabel(plan) {
  return PLAN_LABELS[plan] || PLAN_LABELS[PLAN_NAMES.FREE];
}

// Compact differentiators shown on the plan chooser. Kept here next to the
// labels so the copy stays in one place; the limits themselves live server-side.
export const PLAN_FEATURES = Object.freeze({
  [PLAN_NAMES.FREE]: 'Local notes',
  [PLAN_NAMES.STARTER]: 'Cloud sync · Basic history',
  [PLAN_NAMES.PRO]: 'Cloud sync · Extended history',
  [PLAN_NAMES.TEAM]: 'Team dashboard · Pooled storage · Unlimited history',
  [PLAN_NAMES.ENTERPRISE]: 'Team dashboard · Unlimited history · SSO & audit',
});

export function planFeatures(plan) {
  return PLAN_FEATURES[plan] || PLAN_FEATURES[PLAN_NAMES.FREE];
}

export function formatBytes(bytes) {
  if (bytes == null) return '';
  if (bytes >= 1024 * 1024 * 1024) {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

// Concrete limits from GET /plans, e.g. "10 GB · 30 days of history".
// Returns '' when the plan carries no limits (free) so the caller can show
// nothing rather than a misleading zero.
export function planLimitsText(limits) {
  if (!limits) return '';
  const parts = [];
  if (limits.quotaBytes) parts.push(formatBytes(limits.quotaBytes));
  if (limits.historyDays == null) parts.push('Unlimited history');
  else if (limits.historyDays > 0) {
    const d = limits.historyDays;
    parts.push(d >= 365 ? '1 year of history' : `${d} days of history`);
  }
  return parts.join(' · ');
}

export const SYNC_TRANSPORT = Object.freeze({
  FOLDER: 'folder',
  REMOTE: 'remote',
});

// The "both" option was removed. Stored `syncTransport` values of "both"
// (from older installs) map to remote so existing users keep cloud sync.
export function normalizeSyncTransport(value) {
  if (value === SYNC_TRANSPORT.REMOTE) return SYNC_TRANSPORT.REMOTE;
  if (value === 'both') return SYNC_TRANSPORT.REMOTE;
  return SYNC_TRANSPORT.FOLDER;
}

export function isPaidPlan(plan) {
  return PAID_PLANS.includes(plan);
}

export function canUseCloudSync(subscription) {
  if (!subscription) return false;
  return isPaidPlan(subscription.plan);
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string';
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value) {
  return typeof value === 'boolean';
}

function isArray(value) {
  return Array.isArray(value);
}

export function assertShape(value, shape, label) {
  if (!isObject(value)) {
    throw new Error(`Invalid ${label}: expected an object.`);
  }
  for (const [key, type] of Object.entries(shape)) {
    const v = value[key];
    if (type === 'string' && !isString(v)) {
      throw new Error(`Invalid ${label}.${key}: expected string.`);
    }
    if (type === 'number' && !isNumber(v)) {
      throw new Error(`Invalid ${label}.${key}: expected number.`);
    }
    if (type === 'boolean' && !isBoolean(v)) {
      throw new Error(`Invalid ${label}.${key}: expected boolean.`);
    }
    if (type === 'object' && !isObject(v)) {
      throw new Error(`Invalid ${label}.${key}: expected object.`);
    }
    if (type === 'array' && !isArray(v)) {
      throw new Error(`Invalid ${label}.${key}: expected array.`);
    }
  }
  return value;
}

export const ProfileShape = Object.freeze({
  id: 'string',
  username: 'string?',
  emailHash: 'string?',
  email: 'string?',
  emailVerified: 'boolean?',
  createdAt: 'string?',
  kemPublicKey: 'string?',
});

export const SubscriptionShape = Object.freeze({
  plan: 'string',
  status: 'string',
  renewsAt: 'string?',
  storage: 'object?',
});

export const StorageShape = Object.freeze({
  usedBytes: 'number',
  quotaBytes: 'number',
  usedPercent: 'number',
  usedMB: 'string?',
  quotaMB: 'string?',
});

export const DeviceShape = Object.freeze({
  deviceId: 'string',
  label: 'string',
  lastSeen: 'string',
});

export const SessionShape = Object.freeze({
  id: 'string',
  deviceLabel: 'string',
  ipSubnet: 'string?',
  lastSeenAt: 'string',
  createdAt: 'string',
});

export function normalizeProfile(raw) {
  if (!isObject(raw)) return null;
  return {
    id: raw.id || raw.userId || null,
    username: raw.username || null,
    emailHash: raw.emailHash || raw.emailHmac || null,
    email: raw.email || null,
    emailVerified: typeof raw.emailVerified === 'boolean' ? raw.emailVerified : null,
    createdAt: raw.createdAt || null,
    kemPublicKey: raw.kemPublicKey ?? null,
  };
}

export function normalizeSubscription(raw) {
  if (!isObject(raw)) return null;
  const storage = isObject(raw.storage)
    ? {
        usedBytes: Number(raw.storage.usedBytes) || 0,
        quotaBytes: Number(raw.storage.quotaBytes) || 0,
        usedPercent: Number(raw.storage.usedPercent) || 0,
        usedMB: raw.storage.usedMB || null,
        quotaMB: raw.storage.quotaMB || null,
      }
    : null;
  return {
    plan: raw.plan || PLAN_NAMES.FREE,
    status: raw.status || 'inactive',
    renewsAt: raw.renewsAt || null,
    storage,
  };
}

export function normalizeDevice(raw) {
  if (!isObject(raw)) return null;
  return {
    deviceId: raw.deviceId || raw.id,
    label: raw.label || raw.deviceLabel || 'Unknown device',
    lastSeen: raw.lastSeen || raw.lastSeenAt || null,
  };
}

export function normalizeSession(raw) {
  if (!isObject(raw)) return null;
  return {
    id: raw.id || raw.idHash,
    deviceLabel: raw.deviceLabel || 'Unknown device',
    ipSubnet: raw.ipSubnet || null,
    lastSeenAt: raw.lastSeenAt || null,
    createdAt: raw.createdAt || null,
  };
}

export function normalizeAccountResponse(raw) {
  if (!isObject(raw)) return null;
  const organizations = Array.isArray(raw.organizations)
    ? raw.organizations.map((org) => ({
        id: org.id,
        name: org.name || org.nameEncrypted,
        slug: org.slug,
        role: org.role || 'owner',
        subscription: org.subscription ? normalizeSubscription(org.subscription) : null,
        workspaces: Array.isArray(org.workspaces)
          ? org.workspaces.map(normalizeWorkspace).filter(Boolean)
          : [],
      }))
    : [];
  return {
    profile: normalizeProfile(raw.user || raw.profile),
    subscription: normalizeSubscription(raw.subscription),
    devices: Array.isArray(raw.devices)
      ? raw.devices.map(normalizeDevice).filter(Boolean)
      : [],
    organizations,
  };
}

export const CommitPayloadShape = Object.freeze({
  enc: 'string',
  iv: 'string',
  ct: 'string',
  tag: 'string',
});

export function normalizeCommit(raw) {
  if (!isObject(raw)) return null;
  return {
    commitId: raw.commitId || raw.id,
    deviceId: raw.deviceId,
    clock: Number(raw.clock) || 0,
    ts: Number(raw.ts) || 0,
  };
}

export const WorkspaceShape = Object.freeze({
  id: 'string',
  name: 'string',
  role: 'string',
  ownerId: 'string?',
  storageUsedBytes: 'number?',
  createdAt: 'string?',
});

export function normalizeWorkspace(raw) {
  if (!isObject(raw)) return null;
  return {
    id: raw.id,
    name: raw.name || 'Untitled Workspace',
    role: raw.role || 'owner',
    ownerId: raw.ownerId || null,
    storageUsedBytes: Number(raw.storageUsedBytes) || 0,
    createdAt: raw.createdAt || null,
    wrappedKey: raw.wrappedKey || null,
    wrappedKeys: Array.isArray(raw.wrappedKeys) && raw.wrappedKeys.length ? raw.wrappedKeys : null,
    vaultWrappedKeys: raw.vaultWrappedKeys || null,
    nameEncrypted: raw.nameEncrypted || null,
    orgId: raw.orgId || null,
    emoji: raw.emoji || null,
    color: raw.color || null,
  };
}

export function normalizeWorkspaceList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeWorkspace).filter(Boolean);
}
