export const ROLES = {
  OWNER: 'owner',
  EDITOR: 'editor',
  VIEWER: 'viewer',
  GUEST: 'guest',
}

export function canEdit(role) {
  return role === ROLES.OWNER || role === ROLES.EDITOR
}
