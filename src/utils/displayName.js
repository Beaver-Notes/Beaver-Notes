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
  return 'Unknown';
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

function colorFromId(userId) {
  const s = String(userId || 'unknown');
  let hash = 0;
  for (const c of s) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
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
