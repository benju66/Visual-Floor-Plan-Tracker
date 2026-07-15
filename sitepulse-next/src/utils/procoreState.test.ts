import { describe, it, expect } from 'vitest';
import { encodeState, decodeState, isSafeReturnPath } from './procoreState';

describe('encodeState / decodeState', () => {
  it('round-trips a state payload', () => {
    const state = { nonce: 'abc-123', returnTo: '/project/42?link=1' };
    const encoded = encodeState(state);
    expect(typeof encoded).toBe('string');
    expect(encoded).not.toContain('{'); // it's opaque, not raw JSON
    expect(decodeState(encoded)).toEqual(state);
  });

  it('returns null for missing/blank input', () => {
    expect(decodeState(null)).toBeNull();
    expect(decodeState(undefined)).toBeNull();
    expect(decodeState('')).toBeNull();
  });

  it('returns null for non-base64 / non-JSON / wrong-shape payloads', () => {
    expect(decodeState('not valid base64 @@@')).toBeNull();
    expect(decodeState(Buffer.from('not json', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeState(Buffer.from('{"nonce":"x"}', 'utf8').toString('base64url'))).toBeNull(); // missing returnTo
    expect(decodeState(Buffer.from('{"returnTo":"/x"}', 'utf8').toString('base64url'))).toBeNull(); // missing nonce
    expect(decodeState(Buffer.from('{"nonce":1,"returnTo":2}', 'utf8').toString('base64url'))).toBeNull(); // wrong types
  });
});

describe('isSafeReturnPath', () => {
  it('accepts absolute in-app paths', () => {
    expect(isSafeReturnPath('/dashboard')).toBe(true);
    expect(isSafeReturnPath('/project/123')).toBe(true);
    expect(isSafeReturnPath('/project/123?link_procore_project=9&x=1')).toBe(true);
    expect(isSafeReturnPath('/')).toBe(true);
  });

  it('rejects protocol-relative and scheme-bearing targets', () => {
    expect(isSafeReturnPath('//evil.com')).toBe(false);
    expect(isSafeReturnPath('https://evil.com')).toBe(false);
    expect(isSafeReturnPath('http://evil.com')).toBe(false);
    expect(isSafeReturnPath('javascript:alert(1)')).toBe(false);
    expect(isSafeReturnPath('/path/with/://embedded')).toBe(false);
  });

  it('rejects backslash tricks and bare/relative paths', () => {
    expect(isSafeReturnPath('/\\evil.com')).toBe(false);
    expect(isSafeReturnPath('\\\\evil.com')).toBe(false);
    expect(isSafeReturnPath('/legit\\..\\evil')).toBe(false);
    expect(isSafeReturnPath('dashboard')).toBe(false);
    expect(isSafeReturnPath('evil.com')).toBe(false);
  });

  it('rejects empty/nullish', () => {
    expect(isSafeReturnPath('')).toBe(false);
    expect(isSafeReturnPath(null)).toBe(false);
    expect(isSafeReturnPath(undefined)).toBe(false);
  });
});
