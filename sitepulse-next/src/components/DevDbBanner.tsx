import { isLocalDevOnProdDb, PROD_PROJECT_REF } from '@/utils/devDbGuard';

// Dev-only banner: warns when a local (non-production) build is pointed at the
// PRODUCTION Supabase database, so no one edits real data while developing.
//
// Server component with a deterministic render (no hooks, no Date) → no
// hydration mismatch. It is statically dead in a production build because
// `isLocalDevOnProdDb` returns false when NODE_ENV === 'production'.
//
// The URL is resolved the SAME way as `src/supabaseClient.ts` — including the
// hardcoded production fallback — so an unset NEXT_PUBLIC_SUPABASE_URL (which
// silently defaults the app to production) correctly trips the banner.
export default function DevDbBanner() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || `https://${PROD_PROJECT_REF}.supabase.co`;

  const onProdDb = isLocalDevOnProdDb({
    nodeEnv: process.env.NODE_ENV,
    supabaseUrl,
    prodRef: PROD_PROJECT_REF,
  });

  if (!onProdDb) return null;

  return (
    <div
      role="alert"
      // Non-interactive fixed strip so it never blocks clicks or shifts layout.
      className="fixed inset-x-0 top-0 z-[9999] pointer-events-none flex justify-center px-3 py-1 text-center text-xs font-semibold tracking-wide text-amber-950 bg-amber-400 border-b border-amber-600 shadow-sm"
    >
      ⚠ DEV build connected to the PRODUCTION database ({PROD_PROJECT_REF}) — edits affect live data
    </div>
  );
}
