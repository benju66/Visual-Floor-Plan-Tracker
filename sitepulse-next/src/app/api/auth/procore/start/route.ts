import { NextResponse, type NextRequest } from 'next/server';
import { encodeState, isSafeReturnPath, PROCORE_NONCE_COOKIE } from '@/utils/procoreState';

// Begin the Procore SSO login (Security Hardening Phase 3). This route exists so
// the CSRF nonce can live in an httpOnly cookie — client JS can't set one, which
// is why the login page navigates here instead of hand-building the OAuth URL.
//
// It (a) sets a short-lived httpOnly nonce cookie, (b) builds the Procore authorize
// URL with `state = { nonce, returnTo }`, and (c) redirects to Procore. The callback
// then requires the state's nonce to match the cookie before trusting the round-trip.

export function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawReturnTo = searchParams.get('returnTo');
  // Only ever carry a safe in-app path forward; anything else falls back to /dashboard.
  const returnTo = isSafeReturnPath(rawReturnTo) ? (rawReturnTo as string) : '/dashboard';

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const baseUrl = `${proto}://${host}`;

  const clientId = process.env.NEXT_PUBLIC_PROCORE_CLIENT_ID;
  if (!clientId) {
    console.error('Procore start: NEXT_PUBLIC_PROCORE_CLIENT_ID is not configured.');
    return NextResponse.redirect(`${baseUrl}/login?error=ProcoreNotConfigured`);
  }

  const nonce = crypto.randomUUID();
  const state = encodeState({ nonce, returnTo });

  const authorizeUrl = new URL('https://login.procore.com/oauth/authorize');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', `${baseUrl}/api/auth/procore/callback`);
  authorizeUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authorizeUrl.toString());
  response.cookies.set(PROCORE_NONCE_COOKIE, nonce, {
    httpOnly: true,
    // SameSite=Lax so the cookie rides the top-level GET redirect back from Procore
    // (Strict would drop it on that cross-site navigation and break the flow).
    sameSite: 'lax',
    secure: proto === 'https',
    path: '/',
    maxAge: 600, // 10 minutes — the login round-trip is short-lived.
  });
  return response;
}
