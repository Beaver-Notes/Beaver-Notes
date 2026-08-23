// src/lib/database/permissions.js
import { ROLES, canView as canViewRole, hasMinimumRole } from '../../utils/permissions'

export class PermissionError extends Error {
  constructor(message = 'Insufficient permission') {
    super(message)
    this.name = 'PermissionError'
  }
}

export const roleAtLeast = hasMinimumRole

export const canView = canViewRole

export const canEditCells = role => roleAtLeast(role, ROLES.EDITOR)

export const canEditSchema = role => roleAtLeast(role, ROLES.EDITOR)

export const canDeleteDb = role => role === ROLES.OWNER

export function effectiveRole(noteRole, dbRole) {
  return roleAtLeast(noteRole, dbRole) ? dbRole : noteRole
}

export function assertCan(role, min) {
  if (!roleAtLeast(role, min)) throw new PermissionError(`Requires '${min}' role`)
}
