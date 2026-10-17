export function displayName(user) {
  if (!user) return 'Unknown';
  const u = user.username;
  if (typeof u === 'string' && u.trim()) return u.trim();
  const email = user.email;
  if (typeof email === 'string' && email.includes('@')) {
    const local = email.split('@')[0].trim();
    if (local) return local;
  }
  if (typeof email === 'string' && email.trim()) return email.trim();
  // Last resort: a stable friendly name, so accounts with no username stay
  // distinguishable in presence avatars and remote caret labels.
  const id = user.id || user.userId || user.accountId;
  if (typeof id === 'string' && id.trim()) return funnyName(id);
  return 'Unknown';
}

const ADJECTIVES = [
  'Amber', 'Blue', 'Brave', 'Bright', 'Calm', 'Clever', 'Copper', 'Crimson',
  'Curious', 'Daring', 'Eager', 'Fair', 'Gentle', 'Golden', 'Happy', 'Hollow',
  'Ivory', 'Jolly', 'Keen', 'Lively', 'Lucid', 'Mellow', 'Nimble', 'Noble',
  'Olive', 'Quiet', 'Rapid', 'Silver', 'Sleepy', 'Sunny', 'Swift', 'Velvet',
];

const NOUNS = [
  'Badger', 'Beacon', 'Cedar', 'Comet', 'Coral', 'Dolphin', 'Ember', 'Falcon',
  'Fern', 'Harbor', 'Heron', 'Juniper', 'Kestrel', 'Lantern', 'Lynx', 'Maple',
  'Meadow', 'Otter', 'Pebble', 'Puffin', 'Quartz', 'Raven', 'Robin',
  'Sable', 'Slate', 'Sorrel', 'Sparrow', 'Thistle', 'Willow', 'Wren', 'Yarrow', 'Zephyr',
];

function cap(word) {
  return word[0] + word.slice(1).toLowerCase();
}

export function funnyName(id) {
  const h = hashId(id);
  const a = ADJECTIVES[Math.abs(h) % ADJECTIVES.length];
  const n = NOUNS[Math.floor(Math.abs(h) / ADJECTIVES.length) % NOUNS.length];
  return `${cap(a)} ${cap(n)}`;
}

function initialsFrom(display) {
  const d = String(display || '').trim();
  if (!d) return '?';
  const words = d.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  // if single token contains non-space separators like _.- treat as words?
  const single = words[0];
  return (single[0] || '?').toUpperCase();
}

function hashId(userId) {
  const s = String(userId || 'unknown');
  let hash = 0;
  for (const c of s) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return hash;
}

function colorFromId(userId) {
  return `hsl(${Math.abs(hashId(userId)) % 360}, 55%, 45%)`;
}

export function avatarMeta(user) {
  const name = displayName(user);
  const id = user?.id || user?.userId || user?.accountId || name;
  return {
    displayName: name,
    initials: initialsFrom(name),
    color: colorFromId(id),
  };
}

export const getInitials = initialsFrom;
export const getAvatarColor = colorFromId;
