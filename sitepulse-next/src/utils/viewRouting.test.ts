import { describe, it, expect } from 'vitest';
import {
  VIEW_MODES,
  MOBILE_VIEWS,
  isValidViewMode,
  isMobileView,
  resolveInitialView,
  controlVisibility,
  type ControlVisibility,
} from './viewRouting';

describe('VIEW_MODES / isValidViewMode', () => {
  it('pins the canonical list and order', () => {
    expect(VIEW_MODES).toEqual(['dashboard', 'list', 'schedule', 'map', 'lookahead']);
  });

  it('accepts every canonical mode', () => {
    for (const mode of VIEW_MODES) expect(isValidViewMode(mode)).toBe(true);
  });

  it('rejects unknown, empty, and nullish values', () => {
    expect(isValidViewMode('gantt')).toBe(false);
    expect(isValidViewMode('Map')).toBe(false);
    expect(isValidViewMode('')).toBe(false);
    expect(isValidViewMode(null)).toBe(false);
    expect(isValidViewMode(undefined)).toBe(false);
  });
});

describe('MOBILE_VIEWS / isMobileView', () => {
  it('is the field-focused 4 — schedule intentionally excluded', () => {
    expect(MOBILE_VIEWS).toEqual(['list', 'map', 'lookahead', 'dashboard']);
    expect(isMobileView('schedule')).toBe(false);
  });

  it('accepts each mobile view and rejects junk', () => {
    for (const mode of MOBILE_VIEWS) expect(isMobileView(mode)).toBe(true);
    expect(isMobileView('gantt')).toBe(false);
    expect(isMobileView(null)).toBe(false);
  });
});

describe('resolveInitialView — precedence table', () => {
  it('a valid URL param wins on desktop', () => {
    expect(resolveInitialView({ urlParam: 'map', isMobile: false, defaultViewMode: 'dashboard' })).toBe('map');
  });

  it('a valid URL param wins on mobile, even for a non-mobile view (deep link honored)', () => {
    expect(resolveInitialView({ urlParam: 'map', isMobile: true, defaultViewMode: 'list' })).toBe('map');
    expect(resolveInitialView({ urlParam: 'schedule', isMobile: true, defaultViewMode: 'list' })).toBe('schedule');
  });

  it('an invalid URL param falls through to defaultViewMode', () => {
    expect(resolveInitialView({ urlParam: 'bogus', isMobile: false, defaultViewMode: 'dashboard' })).toBe('dashboard');
    expect(resolveInitialView({ urlParam: '', isMobile: false, defaultViewMode: 'schedule' })).toBe('schedule');
  });

  it('no param on desktop → defaultViewMode', () => {
    expect(resolveInitialView({ urlParam: null, isMobile: false, defaultViewMode: 'schedule' })).toBe('schedule');
  });

  it('no param on mobile → defaultViewMode clamped to a mobile-allowed view', () => {
    // schedule is not mobile-allowed → clamp to list
    expect(resolveInitialView({ urlParam: null, isMobile: true, defaultViewMode: 'schedule' })).toBe('list');
    // map is mobile-allowed → kept
    expect(resolveInitialView({ urlParam: null, isMobile: true, defaultViewMode: 'map' })).toBe('map');
  });

  it('invalid or missing defaultViewMode → list', () => {
    expect(resolveInitialView({ urlParam: null, isMobile: false, defaultViewMode: 'bogus' })).toBe('list');
    expect(resolveInitialView({ urlParam: null, isMobile: false, defaultViewMode: null })).toBe('list');
    expect(resolveInitialView({ urlParam: null, isMobile: false })).toBe('list');
  });

  it('nothing at all → list (mobile and desktop)', () => {
    expect(resolveInitialView({ urlParam: undefined, isMobile: true })).toBe('list');
    expect(resolveInitialView({ urlParam: undefined, isMobile: false })).toBe('list');
  });

  it('a custom mobileAllowed list overrides the default clamp set', () => {
    expect(
      resolveInitialView({ urlParam: null, isMobile: true, defaultViewMode: 'schedule', mobileAllowed: ['schedule'] })
    ).toBe('schedule');
  });

  it('Phase-4 wiring: mobileAllowed MOBILE_VIEWS keeps any mobile view as the fallback; only Schedule clamps to list', () => {
    // The page passes MOBILE_VIEWS since the bottom tab bar shipped (Nav Phase 4).
    for (const mode of MOBILE_VIEWS) {
      expect(
        resolveInitialView({ urlParam: null, isMobile: true, defaultViewMode: mode, mobileAllowed: MOBILE_VIEWS })
      ).toBe(mode);
    }
    expect(
      resolveInitialView({ urlParam: null, isMobile: true, defaultViewMode: 'schedule', mobileAllowed: MOBILE_VIEWS })
    ).toBe('list');
    // A ?view=schedule deep link still wins even on a phone.
    expect(
      resolveInitialView({ urlParam: 'schedule', isMobile: true, defaultViewMode: 'list', mobileAllowed: MOBILE_VIEWS })
    ).toBe('schedule');
  });

  it("historical Phase-1 wiring: mobileAllowed ['list'] forces list on phones without a param, but a deep link still wins", () => {
    // No param → forced to list even though dashboard is a mobile view.
    expect(
      resolveInitialView({ urlParam: null, isMobile: true, defaultViewMode: 'dashboard', mobileAllowed: ['list'] })
    ).toBe('list');
    // A valid ?view= param wins regardless.
    expect(
      resolveInitialView({ urlParam: 'map', isMobile: true, defaultViewMode: 'dashboard', mobileAllowed: ['list'] })
    ).toBe('map');
    // Desktop is unaffected by the mobile clamp.
    expect(
      resolveInitialView({ urlParam: null, isMobile: false, defaultViewMode: 'dashboard', mobileAllowed: ['list'] })
    ).toBe('dashboard');
  });
});

describe('controlVisibility — the owner-confirmed per-view matrix (locked 2026-07-06)', () => {
  // The matrix, cell by cell, exactly as recorded in the Navigation plan.
  const MATRIX: Array<[string, ControlVisibility]> = [
    ['dashboard', { level: false, scope: true, activities: false, export: false, levelAdmin: true }],
    ['list', { level: true, scope: true, activities: true, export: false, levelAdmin: true }],
    ['schedule', { level: true, scope: true, activities: false, export: false, levelAdmin: true }],
    ['map', { level: true, scope: true, activities: true, export: true, levelAdmin: true }],
    ['lookahead', { level: false, scope: false, activities: false, export: false, levelAdmin: true }],
  ];

  it.each(MATRIX)('%s shows exactly its matrix row', (mode, expected) => {
    expect(controlVisibility(mode)).toEqual(expected);
  });

  it('covers every canonical view mode', () => {
    expect(MATRIX.map(([mode]) => mode)).toEqual([...VIEW_MODES]);
  });

  it('Add/Manage Levels stays visible in every view', () => {
    for (const mode of VIEW_MODES) expect(controlVisibility(mode).levelAdmin).toBe(true);
  });

  it('Export is map-only (TopHeader additionally gates on base_image_url)', () => {
    for (const mode of VIEW_MODES) expect(controlVisibility(mode).export).toBe(mode === 'map');
  });

  it('an unknown or missing mode shows everything (pre-Phase-3 fallback, never hides on bad input)', () => {
    const allVisible = { level: true, scope: true, activities: true, export: true, levelAdmin: true };
    expect(controlVisibility('bogus')).toEqual(allVisible);
    expect(controlVisibility('')).toEqual(allVisible);
    expect(controlVisibility(null)).toEqual(allVisible);
    expect(controlVisibility(undefined)).toEqual(allVisible);
  });
});
