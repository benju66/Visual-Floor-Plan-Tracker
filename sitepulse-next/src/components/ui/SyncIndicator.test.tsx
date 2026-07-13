import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import SyncIndicator from './SyncIndicator';

// ─────────────────────────────────────────────────────────────────────────────
// Save Visibility — Phase 3 regression backstop for the mobile sync dot. The dot
// renders purely from primitive props via deriveSyncState, so this locks the
// WIRING: each of the five sync states shows its distinct dot tone + label, and —
// the load-bearing one — a FAILED save shows the RED "N failed" copy instead of
// blending into the amber pending count. Plain render (no React Query / Supabase):
// the component takes only primitive props.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => cleanup());

// The dot is the first rounded-full span; its bg-* class encodes the tone.
const dotClassOf = (container: HTMLElement) =>
  container.querySelector('span.rounded-full')?.className ?? '';

// aria-label mirrors syncStateLabel(state) — the accessible name field crews' phones read.
const labelOf = () => screen.getByRole('status').getAttribute('aria-label');

describe('SyncIndicator — renders each sync state (Save Visibility Phase 3)', () => {
  it('loading before rehydrate → amber dot + "Loading saved changes…"', () => {
    const { container } = render(
      <SyncIndicator hasRehydrated={false} isApplying={false} pendingCount={0} failedCount={0} />,
    );
    expect(labelOf()).toBe('Loading saved changes…');
    expect(dotClassOf(container)).toContain('bg-amber-500');
  });

  it('syncing while applying → amber dot + "Syncing…"', () => {
    const { container } = render(
      <SyncIndicator hasRehydrated={true} isApplying={true} pendingCount={3} failedCount={0} />,
    );
    expect(labelOf()).toBe('Syncing…');
    expect(screen.getByText('Syncing…')).toBeTruthy();
    expect(dotClassOf(container)).toContain('bg-amber-500');
  });

  it('pending with queued changes → amber dot + the count', () => {
    const { container } = render(
      <SyncIndicator hasRehydrated={true} isApplying={false} pendingCount={3} failedCount={0} />,
    );
    expect(labelOf()).toBe('3 unsaved');
    expect(screen.getByText('3')).toBeTruthy();
    expect(dotClassOf(container)).toContain('bg-amber-500');
  });

  it('error when a save failed → RED dot + red "N failed" copy (not a silent pending count)', () => {
    // A failure is present alongside pending work: 'error' must win, and the copy must be red —
    // this is the whole point of the workstream, so it gets the most explicit assertion.
    const { container } = render(
      <SyncIndicator hasRehydrated={true} isApplying={false} pendingCount={3} failedCount={2} />,
    );
    expect(labelOf()).toBe('2 failed to save');
    const failed = screen.getByText('2 failed');
    expect(failed).toBeTruthy();
    expect(failed.className).toContain('text-red-600');
    expect(dotClassOf(container)).toContain('bg-red-500');
    // It does NOT fall back to the amber pending count.
    expect(screen.queryByText('3')).toBeNull();
  });

  it('synced when the queue is clean → steady emerald dot + no count text', () => {
    const { container } = render(
      <SyncIndicator hasRehydrated={true} isApplying={false} pendingCount={0} failedCount={0} />,
    );
    expect(labelOf()).toBe('All changes synced');
    expect(dotClassOf(container)).toContain('bg-emerald-500');
    // No count/label text once everything is synced — the dot alone conveys it.
    expect(screen.queryByText(/unsaved|failed|Syncing/)).toBeNull();
  });
});
