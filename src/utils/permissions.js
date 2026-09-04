export const ROLES = {
  OWNER: 'owner',
  EDITOR: 'editor',
  VIEWER: 'viewer',
  GUEST: 'guest',
}

const ROLE_HIERARCHY = {
  [ROLES.OWNER]: 4,
  [ROLES.EDITOR]: 3,
  [ROLES.VIEWER]: 2,
  [ROLES.GUEST]: 1,
}

export function canEdit(role) {
  return role === ROLES.OWNER || role === ROLES.EDITOR
}

export function canView(role) {
  return role in ROLE_HIERARCHY
}

export function canDeleteNote(role) {
  return role === ROLES.OWNER
}

export function hasMinimumRole(userRole, requiredRole) {
  const userLevel = ROLE_HIERARCHY[userRole] ?? 0
  const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 0
  return userLevel >= requiredLevel
}
