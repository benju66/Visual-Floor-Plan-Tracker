// View-routing helpers (Navigation & Per-View Header plan, Phase 1).
// The active view lives in the URL (`?view=<mode>`); these pure helpers own the
// canonical view list and the first-load resolution precedence. Framework-free:
// no `window`, no `Date.now()` — callers pass everything in.

/** Canonical view modes, in switcher order. */
export const VIEW_MODES = ['dashboard', 'list', 'schedule', 'map', 'lookahead'] as const;

export type ViewMode = (typeof VIEW_MODES)[number];

export function isValidViewMode(value: string | null | undefined): value is ViewMode {
  return typeof value === 'string' && (VIEW_MODES as readonly string[]).includes(value);
}

/**
 * Views reachable from the phone bottom tab bar (owner-locked, field-focused 4).
 * Schedule/Gantt is intentionally excluded — unusable at phone width.
 */
export const MOBILE_VIEWS: readonly ViewMode[] = ['list', 'map', 'lookahead', 'dashboard'];

export function isMobileView(value: string | null | undefined): boolean {
  return isValidViewMode(value) && MOBILE_VIEWS.includes(value);
}

export interface ResolveInitialViewArgs {
  /** The raw `?view=` query param (null/undefined when absent). */
  urlParam: string | null | undefined;
  /** Whether the viewport is phone-sized; callers read `window`, not this fn. */
  isMobile: boolean;
  /** The user's persisted default view setting, if any. */
  defaultViewMode?: string | null;
  /** Views a mobile fallback may land on. Defaults to MOBILE_VIEWS. */
  mobileAllowed?: readonly string[];
}

/**
 * The view to show on first load. Precedence:
 * valid URL param → (mobile: clamp fallback to a mobile-allowed view) →
 * defaultViewMode → 'list'.
 *
 * A valid URL param always wins — even on mobile, and even for views outside
 * `mobileAllowed` — so a shared deep link opens what it names. The mobile clamp
 * only constrains the *fallback* (defaultViewMode) path.
 */
export function resolveInitialView({
  urlParam,
  isMobile,
  defaultViewMode,
  mobileAllowed = MOBILE_VIEWS,
}: ResolveInitialViewArgs): ViewMode {
  if (isValidViewMode(urlParam)) return urlParam;
  const fallback: ViewMode = isValidViewMode(defaultViewMode) ? defaultViewMode : 'list';
  if (isMobile && !mobileAllowed.includes(fallback)) return 'list';
  return fallback;
}
