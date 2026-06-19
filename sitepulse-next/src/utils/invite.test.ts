import { describe, it, expect } from 'vitest';
import {
  normalizeEmail,
  isValidEmail,
  isAssignableRole,
  validateInvitePayload,
  parseBearerToken,
} from './invite';

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
});

describe('isValidEmail', () => {
  it('accepts a normal address', () => {
    expect(isValidEmail('user@company.com')).toBe(true);
  });
  it('rejects obvious garbage', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});

describe('isAssignableRole', () => {
  it('accepts dropdown roles', () => {
    for (const r of ['admin', 'pm', 'super', 'sub', 'viewer']) {
      expect(isAssignableRole(r)).toBe(true);
    }
  });
  it('rejects owner (not assignable via invite) and junk', () => {
    expect(isAssignableRole('owner')).toBe(false);
    expect(isAssignableRole('superuser')).toBe(false);
    expect(isAssignableRole(undefined)).toBe(false);
    expect(isAssignableRole(42)).toBe(false);
  });
});

describe('validateInvitePayload', () => {
  it('returns the normalized payload for valid input', () => {
    const result = validateInvitePayload({
      project_id: ' p1 ',
      email: '  Person@Co.COM ',
      role: 'pm',
    });
    expect(result).toEqual({ ok: true, value: { project_id: 'p1', email: 'person@co.com', role: 'pm' } });
  });

  it('rejects a missing project_id', () => {
    const result = validateInvitePayload({ email: 'a@b.com', role: 'pm' });
    expect(result.ok).toBe(false);
  });

  it('rejects a bad email', () => {
    const result = validateInvitePayload({ project_id: 'p1', email: 'nope', role: 'pm' });
    expect(result.ok).toBe(false);
  });

  it('rejects an unassignable role', () => {
    const result = validateInvitePayload({ project_id: 'p1', email: 'a@b.com', role: 'owner' });
    expect(result.ok).toBe(false);
  });
});

describe('parseBearerToken', () => {
  it('extracts the token (case-insensitive scheme)', () => {
    expect(parseBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(parseBearerToken('bearer  xyz ')).toBe('xyz');
  });
  it('returns empty string when absent or malformed', () => {
    expect(parseBearerToken(null)).toBe('');
    expect(parseBearerToken(undefined)).toBe('');
    expect(parseBearerToken('abc.def.ghi')).toBe('');
    expect(parseBearerToken('Basic abc')).toBe('');
  });
});
