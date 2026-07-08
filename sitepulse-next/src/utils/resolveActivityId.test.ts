import { describe, it, expect } from 'vitest';
import { resolveActivityId } from './resolveActivityId';

// Regression: the mobile swipe deck (swipe-right + PLN/ONG/✓ buttons) and synthetic
// bottleneck placeholders stage status changes carrying only an activity NAME. Writing
// status_logs.activity_id = NULL fails a NOT-NULL constraint ("null value in column
// activity_id ...") — the toast the owner hit on a phone. resolveActivityId recovers the
// id from the project's activities so the write succeeds.
const activities = [
  { id: 'act-drywall-prod', name: 'Drywall', track: 'Production' },
  { id: 'act-drywall-safe', name: 'Drywall', track: 'Safety' },
  { id: 'act-paint-prod', name: 'Paint', track: 'Production' },
];

describe('resolveActivityId', () => {
  it('returns an explicit id verbatim (desktop paths hand a full Activity)', () => {
    expect(resolveActivityId({ id: 'act-explicit', name: 'Drywall', track: 'Production' }, activities)).toBe(
      'act-explicit',
    );
  });

  it('resolves a name-only activity by name AND track (the failing swipe-deck path)', () => {
    expect(resolveActivityId({ name: 'Drywall', track: 'Production' }, activities)).toBe('act-drywall-prod');
    expect(resolveActivityId({ name: 'Drywall', track: 'Safety' }, activities)).toBe('act-drywall-safe');
  });

  it('falls back to a name-only match when the track does not line up', () => {
    // e.g. a synthetic bottleneck log whose track string does not match any row for that name
    expect(resolveActivityId({ name: 'Paint', track: 'Nonexistent' }, activities)).toBe('act-paint-prod');
  });

  it('treats an empty-string id as missing and resolves by name', () => {
    expect(resolveActivityId({ id: '', name: 'Paint', track: 'Production' }, activities)).toBe('act-paint-prod');
  });

  it('returns null when the activity cannot be found (caller fails loudly, no NULL write)', () => {
    expect(resolveActivityId({ name: 'Framing', track: 'Production' }, activities)).toBeNull();
    expect(resolveActivityId({ name: 'Drywall', track: 'Production' }, [])).toBeNull();
  });

  it('returns null when there is no id and no name to match on', () => {
    expect(resolveActivityId({ track: 'Production' }, activities)).toBeNull();
    expect(resolveActivityId({ name: null, id: null }, activities)).toBeNull();
  });
});
