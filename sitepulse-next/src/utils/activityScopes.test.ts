import { describe, it, expect } from 'vitest';
import {
  buildScopeChips,
  countScopeUsage,
  activeScopeNames,
  scopeExists,
} from './activityScopes';
import type { ActivityScope } from '@/types/domain';

function scope(name: string, sort_order: number, status: 'active' | 'archived' = 'active'): ActivityScope {
  return {
    id: `id-${name}`,
    name,
    description: null,
    sort_order,
    status,
    created_by: null,
    created_at: null,
    updated_at: null,
  };
}

describe('countScopeUsage', () => {
  it('trims, drops empties/nullish, and counts by name', () => {
    const counts = countScopeUsage(['Production', ' Production ', '', null, undefined, 'Inspections']);
    expect(counts.get('Production')).toBe(2);
    expect(counts.get('Inspections')).toBe(1);
    expect(counts.has('')).toBe(false);
  });
});

describe('buildScopeChips', () => {
  it('lists active managed scopes first in palette order, with usage counts (incl. zero)', () => {
    const scopes = [scope('Production', 0), scope('Inspections', 1), scope('Exterior', 2)];
    const chips = buildScopeChips(scopes, ['Production', 'Production', 'Inspections']);
    expect(chips.map((c) => c.name)).toEqual(['Production', 'Inspections', 'Exterior']);
    expect(chips.every((c) => c.managed)).toBe(true);
    expect(chips.find((c) => c.name === 'Production')?.count).toBe(2);
    expect(chips.find((c) => c.name === 'Exterior')?.count).toBe(0); // empty scope still shows
  });

  it('appends unmanaged scopes (used by an activity, not in the active palette) alphabetically', () => {
    const scopes = [scope('Production', 0)];
    const chips = buildScopeChips(scopes, ['Production', 'Sitework', 'Demo', 'Demo']);
    expect(chips.map((c) => c.name)).toEqual(['Production', 'Demo', 'Sitework']);
    const demo = chips.find((c) => c.name === 'Demo')!;
    expect(demo.managed).toBe(false);
    expect(demo.id).toBeNull();
    expect(demo.count).toBe(2);
  });

  it('excludes archived scopes from the active-managed list', () => {
    const scopes = [scope('Production', 0), scope('Retired Scope', 1, 'archived')];
    const chips = buildScopeChips(scopes, ['Production']);
    expect(chips.map((c) => c.name)).toEqual(['Production']);
  });

  it('surfaces an archived-but-still-used scope as unmanaged (needs attention)', () => {
    const scopes = [scope('Old', 0, 'archived')];
    const chips = buildScopeChips(scopes, ['Old']);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ name: 'Old', managed: false, id: null, count: 1 });
  });
});

describe('activeScopeNames', () => {
  it('returns active names in palette order, dropping archived', () => {
    const scopes = [scope('B', 0), scope('A', 1, 'archived'), scope('C', 2)];
    expect(activeScopeNames(scopes)).toEqual(['B', 'C']);
  });
});

describe('scopeExists', () => {
  it('matches case-insensitively and trims, regardless of status', () => {
    const scopes = [scope('Production', 0), scope('Old', 1, 'archived')];
    expect(scopeExists(scopes, ' production ')).toBe(true);
    expect(scopeExists(scopes, 'OLD')).toBe(true);
    expect(scopeExists(scopes, 'Nope')).toBe(false);
  });
});
