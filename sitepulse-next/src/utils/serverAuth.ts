import { createClient, type User } from '@supabase/supabase-js';

// Server-side login-token verification for Next.js API route handlers.
//
// The two service-role routes (`api/projects`, `api/workbench/container`) create
// database rows with the all-powerful service-role key. Before this helper they
// trusted whatever `user_id` the request body carried, so anyone who could reach
// the deployed site — with no login — could create projects and make any user an
// admin. `getUserFromRequest` closes that: it reads the caller's real login token
// (the `Authorization: Bearer <jwt>` header the browser already sends to the
// FastAPI backend — see `src/services/api.ts`) and verifies it against Supabase
// Auth, so the route can take the user identity from the verified token instead
// of the body.
//
// This helper uses the PUBLIC anon key (never the service-role key — that stays
// in the `app/api/**` route files per AGENTS.md §2): `auth.getUser(token)` only
// needs the anon key plus the token to ask the Auth server to verify it.

/** A 401-shaped failure the caller turns into a `NextResponse`. */
export interface AuthError {
  status: 401;
  message: string;
}

export type GetUserResult =
  | { user: User; error: null }
  | { user: null; error: AuthError };

const UNAUTHENTICATED: AuthError = { status: 401, message: 'Not authenticated' };

/**
 * Verify the caller's `Authorization: Bearer <jwt>` header and return the
 * Supabase user it proves, or a 401-shaped error. Never throws — a missing
 * header, a malformed token, or a rejected token all resolve to the same
 * generic 401 (details, if any, go to `console.error` only).
 */
export async function getUserFromRequest(request: Request): Promise<GetUserResult> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!token) {
    return { user: null, error: UNAUTHENTICATED };
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return { user: null, error: UNAUTHENTICATED };
    }
    return { user: data.user, error: null };
  } catch (err) {
    // A transport-level failure verifying the token is still an auth failure to
    // the caller; log the detail, return the generic 401.
    console.error('serverAuth.getUserFromRequest error:', err);
    return { user: null, error: UNAUTHENTICATED };
  }
}
