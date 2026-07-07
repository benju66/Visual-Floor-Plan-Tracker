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

// ── Per-view control matrix (Navigation & Per-View Header plan, Phase 3) ──

/** Which TopHeader controls the current view actually uses (true = show). */
export interface ControlVisibility {
  /** Level selector (`activeSheetId` dropdown). */
  level: boolean;
  /** Scope/Track tabs. */
  scope: boolean;
  /** Activities filter button (the plan's pre-rename "Milestones" button). */
  activities: boolean;
  /** Export PDF button. Map-only here; TopHeader ALSO keeps its existing
   *  `activeSheet?.base_image_url` gate on top of this flag. */
  export: boolean;
  /** Add / Manage Levels buttons. */
  levelAdmin: boolean;
}

/**
 * The owner-confirmed matrix (all cells locked 2026-07-06): Dashboard hides the
 * Level selector + Activities button; Schedule hides the Activities button +
 * Export; Look-Ahead hides the Level selector + Scope tabs. The Dashboard's
 * Scope tabs stay but are re-sourced from project-level tracks (see TopHeader).
 */
const CONTROL_MATRIX: Record<ViewMode, ControlVisibility> = {
  dashboard: { level: false, scope: true, activities: false, export: false, levelAdmin: true },
  list: { level: true, scope: true, activities: true, export: false, levelAdmin: true },
  schedule: { level: true, scope: true, activities: false, export: false, levelAdmin: true },
  map: { level: true, scope: true, activities: true, export: true, levelAdmin: true },
  lookahead: { level: false, scope: false, activities: false, export: false, levelAdmin: true },
};

/** Everything shown — the safe fallback for an unknown/invalid mode (matches the
 *  pre-Phase-3 unconditional header rather than hiding controls on bad input). */
const ALL_CONTROLS_VISIBLE: ControlVisibility = {
  level: true, scope: true, activities: true, export: true, levelAdmin: true,
};

export function controlVisibility(viewMode: string | null | undefined): ControlVisibility {
  return isValidViewMode(viewMode) ? CONTROL_MATRIX[viewMode] : ALL_CONTROLS_VISIBLE;
}
