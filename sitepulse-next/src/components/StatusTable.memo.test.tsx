import type { ComponentProps } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { Unit, StatusLog, Activity, Subtype, PendingChange, TrackingMode } from '@/types/domain';

// ─────────────────────────────────────────────────────────────────────────────
// List View Performance — Phase 3. The whole point of extracting a memoized
// `LocationRow` + `useCallback`-ing the edit handlers + passing per-row slices is
// re-render SCOPE: an edit to one row (or a save/selection change on one row) must
// re-render ONLY that row, not the whole table. This is the headless stand-in for
// the owner's React-DevTools-Profiler check on the auth-locked live List.
//
// LocationRow is replaced with a render-COUNTING spy that is itself wrapped in
// React.memo (the real component IS `React.memo(LocationRowInner)`, so a shallow-memo
// spy faithfully models it). The counts then prove that StatusTable feeds each row
// referentially-stable props — even while the "parent" (this test) hands StatusTable
// FRESH inline callbacks on every render, exactly like the real page/container that
// does not memoize onRename / onChooseStatus / onToggleApplicability / etc.
// ─────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({ counts: new Map<string, number>() }));

// jsdom has no layout, so @tanstack/react-virtual's real windowing computes an
// EMPTY range (its `outerSize === 0` guard) and would render zero rows here.
// This test's concern is re-render SCOPE (the Phase-3 memo), which is orthogonal
// to windowing — the spacer math is unit-tested in `listWindow.test.ts`, and the
// on-screen window is a live-verify item. So we stub `useVirtualizer` to a
// no-windowing pass-through that renders ALL `count` blocks (index-ordered),
// letting the memo assertions below stay exactly as they were pre-Phase-4.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: {
    count: number;
    getItemKey?: (index: number) => string | number;
  }) => {
    const items = Array.from({ length: opts.count }, (_, index) => ({
      index,
      key: opts.getItemKey ? opts.getItemKey(index) : index,
      start: index * 64,
      end: (index + 1) * 64,
      size: 64,
      lane: 0,
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => opts.count * 64,
      measureElement: () => {},
    };
  },
}));

vi.mock('./manage/LocationRow', async () => {
  const React = await import('react');
  interface SpyProps {
    unit: { id: string };
    auditEnabled: boolean;
    pendingTimelineForUnit?: unknown;
  }
  const Spy = (props: SpyProps) => {
    h.counts.set(props.unit.id, (h.counts.get(props.unit.id) ?? 0) + 1);
    return React.createElement('tbody', {
      'data-unit-id': props.unit.id,
      'data-audit-enabled': String(props.auditEnabled),
      'data-has-timeline': String(!!props.pendingTimelineForUnit),
    });
  };
  // Mirror the real export: a shallow React.memo. If StatusTable's per-row props are
  // referentially stable, this memo skips the row — which is exactly what we assert.
  return { default: React.memo(Spy) };
});

import StatusTable from './StatusTable';

type Props = ComponentProps<typeof StatusTable>;

const unit = (id: string) =>
  ({ id, unit_number: id, unit_type: 'Apartment Unit', assigned_to: null, subtype_id: null }) as unknown as Unit;
const row = (id: string) => ({ unit: unit(id), log: null });

// Stable shared references — the table's context data does NOT change across an edit,
// so its derived memos (varianceByUnitId / logMap / staleByUnitId) keep stable identity.
const VISIBLE = [row('a'), row('b'), row('c')];
const CURRENT_ACTIVITIES: Activity[] = [];
const RAW_STATUSES: StatusLog[] = [];
const SUBTYPES: Subtype[] = [];
const SELECTED: string[] = [];

// The two EDIT handlers are stabilized at their source (useFieldData useCallback), so
// the test passes stable refs for them — matching production.
const handleLocalUpdate = vi.fn();
const handleTimelineUpdate = vi.fn();
const toggleSelectedUnitId = vi.fn();
const setSelectedUnitIds = vi.fn();
const setHistoryModalUnitId = vi.fn();
const handleSort = vi.fn();
const handleDiscardAll = vi.fn();
const handleApplyAll = vi.fn();

const pending = (id: string): PendingChange =>
  ({ unit: unit(id), log: null, state: 'completed', capturedAt: '2026-07-10T00:00:00.000Z', extraProps: {} }) as PendingChange;

// Every call mints FRESH inline callbacks for the page/container-owned handlers —
// the adversarial condition Phase 3 must survive (unstable closures from above must
// NOT re-render un-edited rows, thanks to StatusTable's useStableCallback wrappers).
function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    visible: VISIBLE,
    pendingChanges: {},
    pendingTimelineChanges: {},
    handleLocalUpdate,
    handleTimelineUpdate,
    savingUnitId: null,
    isApplying: false,
    sortColumn: 'unit',
    sortDirection: 'asc',
    handleSort,
    selectedUnitIds: SELECTED,
    toggleSelectedUnitId,
    setSelectedUnitIds,
    setHistoryModalUnitId,
    pendingCount: 0,
    handleDiscardAll,
    handleApplyAll,
    rawStatuses: RAW_STATUSES,
    currentActivities: CURRENT_ACTIVITIES,
    trackingMode: 'Production' as TrackingMode,
    subtypes: SUBTYPES,
    projectType: null,
    onChooseStatus: () => {},
    onToggleApplicability: () => {},
    onRenameLocation: () => {},
    onChangeUnitType: () => {},
    onLocateUnit: () => {},
    onDeleteLocation: () => {},
    onAssignUnit: () => {},
    ...overrides,
  };
}

beforeEach(() => h.counts.clear());
afterEach(() => cleanup());

describe('StatusTable — Phase 3 memoized row re-render scope', () => {
  it('maps every visible location to a row and fails the audit gate OPEN in jsdom (no IntersectionObserver)', () => {
    const { container } = render(<StatusTable {...makeProps()} />);
    expect(h.counts.get('a')).toBe(1);
    expect(h.counts.get('b')).toBe(1);
    expect(h.counts.get('c')).toBe(1);
    // Phase-2 invariant preserved: with IntersectionObserver unavailable, every row
    // is treated as near (auditEnabled=true) — degrade to "always fetch", never "never".
    for (const el of container.querySelectorAll('[data-unit-id]')) {
      expect(el.getAttribute('data-audit-enabled')).toBe('true');
    }
  });

  it('re-renders ONLY the edited row when its pendingChange slice changes (unstable parent callbacks and all)', () => {
    const { rerender } = render(<StatusTable {...makeProps()} />);
    expect([h.counts.get('a'), h.counts.get('b'), h.counts.get('c')]).toEqual([1, 1, 1]);

    // Stage a primary edit on 'b' only. makeProps() also hands fresh inline callbacks
    // for onRename/onChooseStatus/etc — the memo must survive that.
    rerender(<StatusTable {...makeProps({ pendingChanges: { b: pending('b') } })} />);

    expect(h.counts.get('a')).toBe(1); // untouched → memo skipped
    expect(h.counts.get('b')).toBe(2); // its own slice changed → re-rendered
    expect(h.counts.get('c')).toBe(1); // untouched → memo skipped
  });

  it('routes a per-activity (timeline) edit to only its own row via the per-unit slice', () => {
    const { rerender, container } = render(<StatusTable {...makeProps()} />);
    expect([h.counts.get('a'), h.counts.get('b'), h.counts.get('c')]).toEqual([1, 1, 1]);

    rerender(<StatusTable {...makeProps({ pendingTimelineChanges: { 'b_Paint': pending('b') } })} />);

    expect(h.counts.get('a')).toBe(1);
    expect(h.counts.get('b')).toBe(2);
    expect(h.counts.get('c')).toBe(1);
    // Only 'b' receives a non-empty timeline slice — the whole map never leaks to a row.
    const cell = (id: string) => container.querySelector(`[data-unit-id="${id}"]`);
    expect(cell('b')?.getAttribute('data-has-timeline')).toBe('true');
    expect(cell('a')?.getAttribute('data-has-timeline')).toBe('false');
    expect(cell('c')?.getAttribute('data-has-timeline')).toBe('false');
  });

  it('re-renders ONLY the saving row when savingUnitId flips (per-row isSaving boolean, not the shared id)', () => {
    const { rerender } = render(<StatusTable {...makeProps()} />);
    expect([h.counts.get('a'), h.counts.get('b'), h.counts.get('c')]).toEqual([1, 1, 1]);

    rerender(<StatusTable {...makeProps({ savingUnitId: 'b' })} />);

    expect(h.counts.get('a')).toBe(1);
    expect(h.counts.get('b')).toBe(2);
    expect(h.counts.get('c')).toBe(1);
  });
});
