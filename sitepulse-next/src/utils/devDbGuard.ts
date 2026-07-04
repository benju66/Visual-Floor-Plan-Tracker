// Dev-only guard: is a local (non-production) build pointed at the production
// Supabase project? `src/supabaseClient.ts` falls back to the production URL when
// NEXT_PUBLIC_SUPABASE_URL is unset, so it's easy to develop against live data
// without noticing. `DevDbBanner` uses this to show an unmissable warning.
//
// Pure by design: pass env values IN; no global reads inside (so it's trivially
// unit-testable). See Codebase-Health-Refactor-Master-Plan.md (Slice 0 / P0.1).

/** The production Supabase project ref (from `src/supabaseClient.ts`). */
export const PROD_PROJECT_REF = 'pmccdxmuszuykawvlphj';

/**
 * True when a non-production build is pointed at the production project ref.
 * Always false in a production build (`nodeEnv === 'production'`) and when no
 * Supabase URL is resolvable.
 */
export function isLocalDevOnProdDb({
  nodeEnv,
  supabaseUrl,
  prodRef,
}: {
  nodeEnv: string | undefined;
  supabaseUrl: string | undefined;
  prodRef: string;
}): boolean {
  if (nodeEnv === 'production') return false;
  return !!supabaseUrl && supabaseUrl.includes(prodRef);
}
