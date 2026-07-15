import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decodeState, isSafeReturnPath, PROCORE_NONCE_COOKIE } from '@/utils/procoreState';

// Procore SSO callback (Security Hardening Phase 3). Hardened over the original:
//   1. CSRF: the `state` nonce must match the httpOnly cookie the `/start` route
//      set — a forged callback with no matching cookie is rejected.
//   2. Open-redirect: we only send the user to an in-app path (isSafeReturnPath),
//      never to an attacker-chosen `returnTo`.
//   3. No `listUsers()` scan (broke past ~50 users): attempt `createUser` first and
//      treat "email already exists" as the returning-user case — race-safe, O(1).
//   4. Domain allow-list comes from `PROCORE_ALLOWED_EMAIL_DOMAINS` (env), fail-closed
//      when unset, instead of a hardcoded domain.
// The service-role key stays server-side only; client-facing failures are generic
// `?error=` codes, with the real detail in `console.error`.

/** Parsed, lowercased allow-list from env (`fpcinc.com,other.com`). Empty = deny all. */
function getAllowedDomains(): string[] {
  return (process.env.PROCORE_ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

/** True when a `createUser` error means the email is already registered. */
function isEmailExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string };
  if (e.code === 'email_exists') return true;
  const msg = (e.message ?? '').toLowerCase();
  return msg.includes('already been registered') || msg.includes('already registered') || msg.includes('already exists');
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const rawState = searchParams.get('state');

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const baseUrl = `${proto}://${host}`;

  // The nonce cookie is single-use: clear it on every response out of this route.
  const clearNonce = (res: NextResponse): NextResponse => {
    res.cookies.set(PROCORE_NONCE_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
    return res;
  };
  const fail = (reason: string): NextResponse =>
    clearNonce(NextResponse.redirect(`${baseUrl}/login?error=${reason}`));

  if (!code) return fail('NoCode');

  // 1. CSRF check: state nonce must match the httpOnly cookie set by /start.
  const state = decodeState(rawState);
  const cookieNonce = request.cookies.get(PROCORE_NONCE_COOKIE)?.value;
  if (!state || !cookieNonce || state.nonce !== cookieNonce) {
    console.error('Procore callback: missing or mismatched CSRF state nonce.');
    return fail('InvalidState');
  }
  const redirectPath = isSafeReturnPath(state.returnTo) ? state.returnTo : '/dashboard';

  try {
    // 2. Exchange the code for a Procore access token.
    const tokenRes = await fetch('https://login.procore.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: process.env.NEXT_PUBLIC_PROCORE_CLIENT_ID,
        client_secret: process.env.PROCORE_CLIENT_SECRET,
        code,
        redirect_uri: `${baseUrl}/api/auth/procore/callback`,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Failed to get Procore token');

    // 3. Look up the Procore user.
    const userRes = await fetch('https://api.procore.com/rest/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const procoreUser = await userRes.json();
    const email = typeof procoreUser?.login === 'string' ? procoreUser.login : '';
    if (!email) throw new Error('Procore profile missing an email');

    // 4. Domain allow-list (env, fail-closed).
    const allowedDomains = getAllowedDomains();
    if (allowedDomains.length === 0) {
      console.error('Procore callback: PROCORE_ALLOWED_EMAIL_DOMAINS is empty — denying all logins (fail closed).');
      return fail('UnauthorizedDomain');
    }
    const emailDomain = email.toLowerCase().split('@')[1] ?? '';
    if (!allowedDomains.includes(emailDomain)) {
      console.error(`Blocked unauthorized Procore login attempt from: ${email}`);
      return fail('UnauthorizedDomain');
    }

    // 5. Provision the Supabase user. createUser-first: attempt to create, and treat
    //    an "email already exists" error as the returning-user case (no listUsers
    //    scan, race-safe). generateLink works by email either way.
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    );

    const { error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        display_name: procoreUser.name,
        procore_id: procoreUser.id,
      },
    });
    if (createError && !isEmailExistsError(createError)) {
      throw createError;
    }

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${baseUrl}${redirectPath}` },
    });
    if (linkError) throw linkError;

    const actionLink = linkData?.properties?.action_link;
    if (!actionLink) throw new Error('Failed to generate a login link');

    return clearNonce(NextResponse.redirect(actionLink));
  } catch (error) {
    console.error('Procore Auth Error:', error);
    return fail('ProcoreAuthFailed');
  }
}
