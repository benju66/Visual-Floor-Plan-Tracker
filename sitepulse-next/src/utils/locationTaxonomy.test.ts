import { describe, it, expect } from 'vitest';
import {
  CANONICAL_ROLES,
  PROJECT_TYPES,
  ROLE_DISPLAY_LABELS,
  SEED_SUBTYPES,
  PENDING_SUBTYPE_NAME,
  roleLabel,
  subtypesForProjectType,
  mapLegacyUnitType,
  suggestTaxonomyFromText,
  type TopLevelRole,
  type ProjectType,
} from './locationTaxonomy';

const ROLE_SET = new Set<string>(CANONICAL_ROLES);
const PROJECT_TYPE_SET = new Set<string>(PROJECT_TYPES);

describe('canonical constants', () => {
  it('has the 4 canonical roles', () => {
    expect([...CANONICAL_ROLES]).toEqual(['program', 'common', 'support', 'other']);
  });

  it('has the 9 project types (Housing and Hotel split into separate types)', () => {
    expect(PROJECT_TYPES).toHaveLength(9);
    expect(PROJECT_TYPE_SET.has('Housing')).toBe(true);
    expect(PROJECT_TYPE_SET.has('Hotel')).toBe(true);
    // The merged legacy type is gone.
    expect(PROJECT_TYPE_SET.has('Housing and Hotel')).toBe(false);
  });
});

describe('SEED_SUBTYPES', () => {
  it('maps every seed sub-type to a valid canonical role', () => {
    for (const subtype of SEED_SUBTYPES) {
      expect(ROLE_SET.has(subtype.role)).toBe(true);
    }
  });

  it('scopes every seed sub-type to valid project types', () => {
    for (const subtype of SEED_SUBTYPES) {
      expect(subtype.defaultProjectTypes.length).toBeGreaterThan(0);
      for (const pt of subtype.defaultProjectTypes) {
        expect(PROJECT_TYPE_SET.has(pt)).toBe(true);
      }
    }
  });

  it('has globally-unique sub-type names (DB column is UNIQUE)', () => {
    const names = SEED_SUBTYPES.map(s => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('does not seed the pending sentinel (it is seeded separately by Phase 2)', () => {
    expect(SEED_SUBTYPES.some(s => s.name === PENDING_SUBTYPE_NAME)).toBe(false);
  });

  it('seeds Restaurant Kitchen and Prep as Back of House (support), not Program', () => {
    expect(SEED_SUBTYPES.find(s => s.name === 'Kitchen')?.role).toBe('support');
    expect(SEED_SUBTYPES.find(s => s.name === 'Prep')?.role).toBe('support');
  });

  it('re-scopes the former Housing-and-Hotel sub-types onto Housing / Hotel', () => {
    expect(SEED_SUBTYPES.find(s => s.name === 'Dwelling Unit')?.defaultProjectTypes).toEqual(['Housing']);
    expect(SEED_SUBTYPES.find(s => s.name === 'Live/Work Unit')?.defaultProjectTypes).toEqual(['Housing']);
    expect(SEED_SUBTYPES.find(s => s.name === 'Guestroom')?.defaultProjectTypes).toEqual(['Hotel']);
    expect(SEED_SUBTYPES.find(s => s.name === 'Suite')?.defaultProjectTypes).toEqual(['Hotel']);
  });

  it('has no seed sub-type still scoped to the retired "Housing and Hotel" type', () => {
    for (const subtype of SEED_SUBTYPES) {
      expect((subtype.defaultProjectTypes as readonly string[]).includes('Housing and Hotel')).toBe(false);
    }
  });

  it('treats universal Common/Support as available in every project type', () => {
    const corridor = SEED_SUBTYPES.find(s => s.name === 'Corridor');
    expect(corridor?.role).toBe('common');
    expect(corridor?.defaultProjectTypes).toHaveLength(PROJECT_TYPES.length);
  });

  it('keeps a shared sub-type (Lab) as a single entry spanning verticals', () => {
    const labs = SEED_SUBTYPES.filter(s => s.name === 'Lab');
    expect(labs).toHaveLength(1);
    expect([...labs[0].defaultProjectTypes].sort()).toEqual(['Healthcare', 'Industrial']);
  });
});

describe('roleLabel', () => {
  it('returns the per-project-type override where defined', () => {
    expect(roleLabel('program', 'Housing')).toBe('Units');
    expect(roleLabel('program', 'Hotel')).toBe('Rooms');
    // The overrides are exactly the ones declared in ROLE_DISPLAY_LABELS.
    expect(ROLE_DISPLAY_LABELS['Housing']?.program).toBe('Units');
    expect(ROLE_DISPLAY_LABELS['Hotel']?.program).toBe('Rooms');
  });

  it('falls back to the friendly user-facing label where no override exists', () => {
    // Same role, different project type → friendly fallback (presentation-only;
    // the stored/exported value stays the canonical `program`/`common`/`support`).
    expect(roleLabel('program', 'Commercial')).toBe('Primary Spaces');
    // A role with no overrides anywhere.
    expect(roleLabel('support', 'Housing')).toBe('Back of House');
    expect(roleLabel('common', 'Healthcare')).toBe('Common Areas');
    expect(roleLabel('other', 'Workplace')).toBe('Other');
  });

  it('falls back to the friendly label when project type is null/undefined', () => {
    expect(roleLabel('program', null)).toBe('Primary Spaces');
    expect(roleLabel('program', undefined)).toBe('Primary Spaces');
  });

  it('keeps the per-project-type override ahead of the friendly fallback', () => {
    // Housing relabels program → "Units" and Hotel → "Rooms"; every other
    // vertical uses the "Primary Spaces" fallback.
    expect(roleLabel('program', 'Housing')).toBe('Units');
    expect(roleLabel('program', 'Hotel')).toBe('Rooms');
    expect(roleLabel('program', 'Workplace')).toBe('Primary Spaces');
  });

  it('produces a label for every (role × project type) pair', () => {
    for (const role of CANONICAL_ROLES) {
      for (const pt of PROJECT_TYPES) {
        expect(roleLabel(role, pt).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('subtypesForProjectType', () => {
  it('never restricts — returns the whole dictionary', () => {
    const ordered = subtypesForProjectType('Healthcare', SEED_SUBTYPES);
    expect(ordered).toHaveLength(SEED_SUBTYPES.length);
    expect(new Set(ordered.map(s => s.name))).toEqual(new Set(SEED_SUBTYPES.map(s => s.name)));
  });

  it('orders defaults (matching project type) before the rest', () => {
    const ordered = subtypesForProjectType('Healthcare', SEED_SUBTYPES);
    const firstNonDefault = ordered.findIndex(s => !s.defaultProjectTypes.includes('Healthcare'));
    const lastDefault = ordered.reduce(
      (acc, s, i) => (s.defaultProjectTypes.includes('Healthcare') ? i : acc),
      -1,
    );
    // Every default sorts ahead of every non-default.
    expect(lastDefault).toBeLessThan(firstNonDefault);
  });

  it('puts a vertical Program sub-type ahead of an unrelated one', () => {
    const ordered = subtypesForProjectType('Restaurant', SEED_SUBTYPES);
    const diningIdx = ordered.findIndex(s => s.name === 'Dining Area'); // Restaurant default
    const classroomIdx = ordered.findIndex(s => s.name === 'Classroom'); // Educational only
    expect(diningIdx).toBeLessThan(classroomIdx);
  });

  it('keeps stable original order within the defaults group', () => {
    const ordered = subtypesForProjectType('Commercial', SEED_SUBTYPES);
    const defaults = ordered.filter(s => s.defaultProjectTypes.includes('Commercial'));
    const seedDefaults = SEED_SUBTYPES.filter(s => s.defaultProjectTypes.includes('Commercial'));
    expect(defaults.map(s => s.name)).toEqual(seedDefaults.map(s => s.name));
  });
});

describe('mapLegacyUnitType', () => {
  it('maps Apartment Unit to program / Dwelling Unit', () => {
    expect(mapLegacyUnitType('Apartment Unit')).toEqual({
      role: 'program',
      subtypeName: 'Dwelling Unit',
    });
  });

  it('maps the generic legacy strings to their confident role + pending sub-type', () => {
    expect(mapLegacyUnitType('Common Area')).toEqual({
      role: 'common',
      subtypeName: PENDING_SUBTYPE_NAME,
    });
    expect(mapLegacyUnitType('Back of House')).toEqual({
      role: 'support',
      subtypeName: PENDING_SUBTYPE_NAME,
    });
    expect(mapLegacyUnitType('Commercial Space')).toEqual({
      role: 'program',
      subtypeName: PENDING_SUBTYPE_NAME,
    });
  });

  it('maps Other to other / pending', () => {
    expect(mapLegacyUnitType('Other')).toEqual({
      role: 'other',
      subtypeName: PENDING_SUBTYPE_NAME,
    });
  });

  it('falls back to other / pending for unknown, empty, and null inputs', () => {
    const fallback = { role: 'other', subtypeName: PENDING_SUBTYPE_NAME };
    expect(mapLegacyUnitType('Something Bespoke')).toEqual(fallback);
    expect(mapLegacyUnitType('')).toEqual(fallback);
    expect(mapLegacyUnitType('   ')).toEqual(fallback);
    expect(mapLegacyUnitType(null)).toEqual(fallback);
    expect(mapLegacyUnitType(undefined)).toEqual(fallback);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(mapLegacyUnitType('  Apartment Unit  ')).toEqual({
      role: 'program',
      subtypeName: 'Dwelling Unit',
    });
  });

  it('always returns a valid canonical role', () => {
    const palette = ['Apartment Unit', 'Common Area', 'Back of House', 'Commercial Space', 'Other', 'mystery'];
    for (const t of palette) {
      expect(ROLE_SET.has(mapLegacyUnitType(t).role)).toBe(true);
    }
  });

  it('resolves non-pending sub-type names to a real seed entry (backfill can find subtype_id)', () => {
    const seedNames = new Set(SEED_SUBTYPES.map(s => s.name));
    const palette = ['Apartment Unit', 'Common Area', 'Back of House', 'Commercial Space', 'Other'];
    for (const t of palette) {
      const { subtypeName } = mapLegacyUnitType(t);
      if (subtypeName !== PENDING_SUBTYPE_NAME) {
        expect(seedNames.has(subtypeName)).toBe(true);
      }
    }
  });
});

describe('suggestTaxonomyFromText — free keyword → taxonomy map', () => {
  const seedByName = new Map(SEED_SUBTYPES.map(s => [s.name, s]));

  it('maps unambiguous room words to a seed sub-type with the seed role', () => {
    expect(suggestTaxonomyFromText('KITCHEN')).toEqual({ role: 'support', subtypeName: 'Kitchen' });
    expect(suggestTaxonomyFromText('MECH')).toEqual({ role: 'support', subtypeName: 'Mechanical' });
    expect(suggestTaxonomyFromText('CORRIDOR')).toEqual({ role: 'common', subtypeName: 'Corridor' });
    expect(suggestTaxonomyFromText('OFFICE')).toEqual({ role: 'program', subtypeName: 'Office' });
  });

  it('is case-insensitive and matches a word inside the full candidate name', () => {
    expect(suggestTaxonomyFromText('417 women')).toEqual({ role: 'common', subtypeName: 'Public Restroom' });
    expect(suggestTaxonomyFromText('Office 110')).toEqual({ role: 'program', subtypeName: 'Office' });
  });

  it('always derives the role FROM the matched seed entry (never disagrees)', () => {
    for (const text of ['KITCHEN', 'STORAGE', 'LOBBY', 'CONFERENCE', 'ELECTRICAL']) {
      const result = suggestTaxonomyFromText(text);
      expect(result).not.toBeNull();
      expect(result!.role).toBe(seedByName.get(result!.subtypeName)?.role);
    }
  });

  it('every keyword target is a real seed sub-type name', () => {
    for (const text of ['KITCHEN', 'MECH', 'ELEC', 'DATA', 'JANITOR', 'TRASH', 'STORAGE',
      'RECEIVING', 'CORRIDOR', 'VESTIBULE', 'LOBBY', 'STAIR', 'ELEVATOR', 'RESTROOM',
      'RECEPTION', 'CONFERENCE', 'OFFICE', 'CLASSROOM', 'DINING', 'RETAIL']) {
      const result = suggestTaxonomyFromText(text);
      expect(result).not.toBeNull();
      expect(seedByName.has(result!.subtypeName)).toBe(true);
    }
  });

  it('returns null for an unknown word, a bare number, or blank input', () => {
    expect(suggestTaxonomyFromText('417')).toBeNull();
    expect(suggestTaxonomyFromText('FLEX SPACE')).toBeNull();
    expect(suggestTaxonomyFromText('')).toBeNull();
    expect(suggestTaxonomyFromText(null)).toBeNull();
    expect(suggestTaxonomyFromText(undefined)).toBeNull();
  });
});

// Type-level sanity: the exported unions are usable as types (compile-time only).
const _role: TopLevelRole = 'program';
const _projectType: ProjectType = 'Housing';
void _role;
void _projectType;
