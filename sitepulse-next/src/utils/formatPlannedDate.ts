// Quiet display form for the list view's date chips (UI Polish plan, Phase 4).
// Pure + framework-free: strings in, string out — no `Date.now()`, no locale
// drift (pinned to en-US so tests and UI render identically everywhere).

/**
 * Format a stored planned/logged date (`YYYY-MM-DD`) for a quiet text chip:
 * "—" when unset, a short local form ("Jul 7, 2026") otherwise.
 *
 * The Y/M/D fields are parsed manually (never `new Date(iso)`) because a bare
 * date-only string parses as UTC midnight and would render one day early in
 * any western-hemisphere timezone. Malformed input degrades to "—".
 */
export function formatPlannedDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return '—';
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  // Reject out-of-range fields (e.g. month 13) that Date would silently roll over.
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) {
    return '—';
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
