// src/lib/database/__tests__/permissions.spec.js
import { describe,it,expect } from 'vitest'
import {
  roleAtLeast,
  canView,
  canEditCells,
  canEditSchema,
  canDeleteDb,
  effectiveRole,
  assertCan,
  PermissionError,
} from '../permissions'

describe('roleAtLeast', () => {
  it('orders viewer < editor < owner', () => {
    expect(roleAtLeast('viewer', 'viewer')).toBe(true)
    expect(roleAtLeast('editor', 'viewer')).toBe(true)
    expect(roleAtLeast('owner', 'viewer')).toBe(true)
    expect(roleAtLeast('editor', 'editor')).toBe(true)
    expect(roleAtLeast('owner', 'editor')).toBe(true)
    expect(roleAtLeast('owner', 'owner')).toBe(true)
    expect(roleAtLeast('viewer', 'editor')).toBe(false)
    expect(roleAtLeast('viewer', 'owner')).toBe(false)
    expect(roleAtLeast('editor', 'owner')).toBe(false)
  })
  it('rejects unknown roles', () => {
    expect(roleAtLeast('admin', 'viewer')).toBe(false)
    expect(roleAtLeast(undefined, 'viewer')).toBe(false)
    expect(roleAtLeast(null, 'viewer')).toBe(false)
  })
})

describe('canView', () => {
  it('is true for any known role and false for unknown', () => {
    for (const role of ['viewer', 'editor', 'owner']) expect(canView(role)).toBe(true)
    expect(canView('admin')).toBe(false)
    expect(canView('toString')).toBe(false)
    expect(canView(undefined)).toBe(false)
  })
})

describe('canEditCells / canEditSchema', () => {
  it('require editor or owner', () => {
    expect(canEditCells('viewer')).toBe(false)
    expect(canEditCells('editor')).toBe(true)
    expect(canEditCells('owner')).toBe(true)
    expect(canEditSchema('viewer')).toBe(false)
    expect(canEditSchema('editor')).toBe(true)
    expect(canEditSchema('owner')).toBe(true)
  })
})

describe('canDeleteDb', () => {
  it('requires owner', () => {
    expect(canDeleteDb('viewer')).toBe(false)
    expect(canDeleteDb('editor')).toBe(false)
    expect(canDeleteDb('owner')).toBe(true)
  })
})

describe('effectiveRole', () => {
  it('intersects note ACL with database ACL, lesser role wins', () => {
    expect(effectiveRole('viewer', 'owner')).toBe('viewer')
    expect(effectiveRole('owner', 'viewer')).toBe('viewer')
    expect(effectiveRole('editor', 'owner')).toBe('editor')
    expect(effectiveRole('owner', 'editor')).toBe('editor')
    expect(effectiveRole('viewer', 'editor')).toBe('viewer')
    expect(effectiveRole('owner', 'owner')).toBe('owner')
  })
  it('unknown role wins as least privileged', () => {
    expect(effectiveRole(undefined, 'owner')).toBe(undefined)
    expect(effectiveRole('owner', undefined)).toBeUndefined()
  })
})

describe('assertCan', () => {
  it('passes silently when role is sufficient', () => {
    expect(() => assertCan('editor', 'viewer')).not.toThrow()
    expect(() => assertCan('owner', 'editor')).not.toThrow()
  })
  it('throws PermissionError when insufficient', () => {
    expect(() => assertCan('viewer', 'editor')).toThrow(PermissionError)
    try {
      assertCan('viewer', 'editor')
    } catch (e) {
      expect(e).toBeInstanceOf(PermissionError)
      expect(e.name).toBe('PermissionError')
    }
    expect(() => assertCan(undefined, 'viewer')).toThrow(PermissionError)
  })
})
