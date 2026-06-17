import { describe, it, expect } from 'vitest';
import { memberLabel, memberOptions, resolveAssignee, initials, type MemberLike } from './assignee';

const ROSTER: MemberLike[] = [
  { user_id: 'u1', user_email: 'jane@x.com', profiles: { display_name: 'Jane Moss', email: 'jane@x.com' } },
  { user_id: 'u2', user_email: 'al@x.com', profiles: { display_name: null, email: 'al@x.com' } },
  { user_id: 'u3', user_email: null, profiles: null },
];

describe('memberLabel', () => {
  it('prefers display name, falls back to member email, then profile email, then "Member"', () => {
    expect(memberLabel(ROSTER[0])).toBe('Jane Moss');
    expect(memberLabel(ROSTER[1])).toBe('al@x.com'); // no display name → member email
    expect(memberLabel(ROSTER[2])).toBe('Member'); // nothing → fallback
    expect(memberLabel({ user_id: 'u4', profiles: { email: 'p@x.com' } })).toBe('p@x.com');
  });
});

describe('memberOptions', () => {
  it('maps roster to {id,label} sorted by label', () => {
    const opts = memberOptions(ROSTER);
    expect(opts.map((o) => o.id)).toEqual(['u2', 'u1', 'u3']); // "al@x.com" < "Jane Moss" < "Member"
    expect(opts[1]).toMatchObject({ id: 'u1', label: 'Jane Moss', sublabel: 'jane@x.com' });
  });
});

describe('resolveAssignee', () => {
  it('returns null when unassigned', () => {
    expect(resolveAssignee(ROSTER, null)).toBeNull();
    expect(resolveAssignee(ROSTER, undefined)).toBeNull();
    expect(resolveAssignee(ROSTER, '')).toBeNull();
  });
  it('resolves a known assignee to its label', () => {
    expect(resolveAssignee(ROSTER, 'u1')).toEqual({ id: 'u1', label: 'Jane Moss' });
  });
  it('resolves an unknown id to an "Unknown" label (e.g. a removed member)', () => {
    expect(resolveAssignee(ROSTER, 'ghost')).toEqual({ id: 'ghost', label: 'Unknown' });
  });
});

describe('initials', () => {
  it('derives 1–2 letter initials', () => {
    expect(initials('Jane Moss')).toBe('JM');
    expect(initials('Cher')).toBe('CH');
    expect(initials('  alex  reed  jr ')).toBe('AJ'); // first + last token
    expect(initials('')).toBe('?');
  });
});
