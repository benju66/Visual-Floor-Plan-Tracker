import { describe, it, expect } from 'vitest';
import { ROLES, ROLE_OPTIONS, isPrivilegedRole, normalizeLegacyRole } from './roles';

describe('ROLES', () => {
  it('includes the two real-world values the type used to miss', () => {
    expect(ROLES).toContain('owner');
    expect(ROLES).toContain('sub');
  });

  it('is the full canonical set', () => {
    expect([...ROLES]).toEqual(['owner', 'admin', 'pm', 'superintendent', 'sub', 'viewer']);
  });
});

describe('ROLE_OPTIONS', () => {
  it('is the ordered, assignable dropdown set (no owner) with the view-only sub label', () => {
    expect(ROLE_OPTIONS).toEqual([
      { value: 'admin', label: 'Admin' },
      { value: 'pm', label: 'Project Manager' },
      { value: 'superintendent', label: 'Superintendent' },
      { value: 'sub', label: 'Subcontractor (view-only)' },
      { value: 'viewer', label: 'Viewer' },
    ]);
  });

  it('never offers owner as a reassignable option', () => {
    expect(ROLE_OPTIONS.some((o) => o.value === 'owner')).toBe(false);
  });

  it('writes the canonical superintendent value, never the legacy super', () => {
    const values = ROLE_OPTIONS.map((o) => o.value);
    expect(values).toContain('superintendent');
    expect(values).not.toContain('super');
  });
});

describe('isPrivilegedRole', () => {
  it('is true only for owner, admin, and pm', () => {
    expect(isPrivilegedRole('owner')).toBe(true);
    expect(isPrivilegedRole('admin')).toBe(true);
    expect(isPrivilegedRole('pm')).toBe(true);
  });

  it('is false for superintendent, sub, viewer, and legacy super', () => {
    expect(isPrivilegedRole('superintendent')).toBe(false);
    expect(isPrivilegedRole('sub')).toBe(false);
    expect(isPrivilegedRole('viewer')).toBe(false);
    expect(isPrivilegedRole('super')).toBe(false);
  });

  it('is false for null/undefined (loading)', () => {
    expect(isPrivilegedRole(null)).toBe(false);
    expect(isPrivilegedRole(undefined)).toBe(false);
  });
});

describe('normalizeLegacyRole', () => {
  it('maps the legacy super to the canonical superintendent', () => {
    expect(normalizeLegacyRole('super')).toBe('superintendent');
  });

  it('passes canonical values through unchanged', () => {
    expect(normalizeLegacyRole('superintendent')).toBe('superintendent');
    expect(normalizeLegacyRole('admin')).toBe('admin');
    expect(normalizeLegacyRole('sub')).toBe('sub');
    expect(normalizeLegacyRole('viewer')).toBe('viewer');
    expect(normalizeLegacyRole('owner')).toBe('owner');
  });

  it('passes null/undefined/empty through unchanged (role query loading)', () => {
    expect(normalizeLegacyRole(null)).toBeNull();
    expect(normalizeLegacyRole(undefined)).toBeUndefined();
    expect(normalizeLegacyRole('')).toBe('');
  });
});
