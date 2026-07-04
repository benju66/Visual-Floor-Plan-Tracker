// Dev-only "wiring" guard for interactive write callbacks.
//
// Some interactive actions (tracing/moving/naming a shape on the canvas) fire a
// callback prop that is supposed to persist the change. If that prop is left
// unwired (null/undefined), the action *looks* like it worked but silently does
// nothing — the exact failure behind the 2026-06-29 polygon bugs. This guard
// makes such a fired-but-unwired action shout in development, while staying a
// zero-cost no-op in production.
//
// Usage — wrap the existing call, keep the optional chaining so production stays
// sound (this returns a plain boolean, NOT a type predicate):
//
//   if (warnIfUnwired(onSave, 'onSave:node-move')) onSave?.(unitId, points);
//
// See AGENTS.md §9 and Codebase-Health-Refactor-Master-Plan.md (Slice 0 / P0.1).

/**
 * Returns whether `cb` is wired (non-null). In development, logs a loud
 * `[wiring]` console error and returns `false` when `cb == null`. In production
 * it is a silent no-op that always returns `true` (env is read at call time so
 * `vi.stubEnv('NODE_ENV', …)` works in tests).
 */
export function warnIfUnwired<T>(cb: T | null | undefined, actionName: string): boolean {
  // Silent no-op in production — the guard is a development safety net only.
  if (process.env.NODE_ENV === 'production') return true;

  if (cb == null) {
    console.error(
      `[wiring] "${actionName}" fired but no handler is wired — this interaction will not save. ` +
        'A write callback prop is null/undefined at this call site.',
    );
    return false;
  }
  return true;
}
