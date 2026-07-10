export const PLAN_NAMES = Object.freeze({
  FREE: 'free',
  BASIC: 'basic',
  PRO: 'pro',
  TEAM: 'team',
  ENTERPRISE: 'enterprise',
});

export const PAID_PLANS = Object.freeze([
  PLAN_NAMES.BASIC,
  PLAN_NAMES.PRO,
  PLAN_NAMES.TEAM,
  PLAN_NAMES.ENTERPRISE,
]);

export const SYNC_TRANSPORT = Object.freeze({
  FOLDER: 'folder',
  REMOTE: 'remote',
  BOTH: 'both',
});

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
  createdAt: 'string?',
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
    createdAt: raw.createdAt || null,
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
    plan: raw.plan || PLAN_NAMES.ENTERPRISE,
    status: raw.status || 'active',
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
  return {
    profile: normalizeProfile(raw.user || raw.profile),
    subscription: normalizeSubscription(raw.subscription),
    devices: Array.isArray(raw.devices)
      ? raw.devices.map(normalizeDevice).filter(Boolean)
      : [],
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
