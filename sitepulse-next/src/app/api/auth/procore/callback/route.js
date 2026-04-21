import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  
  // NEW: Grab the state parameter (where they wanted to go)
  const state = searchParams.get('state');
  const redirectPath = state ? decodeURIComponent(state) : '/dashboard';

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const baseUrl = `${proto}://${host}`;

  if (!code) {
    return NextResponse.redirect(`${baseUrl}/login?error=NoCode`);
  }

  try {
    // 1. MOVED TO PRODUCTION: login.procore.com
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

    // 2. MOVED TO PRODUCTION: api.procore.com
    const userRes = await fetch('https://api.procore.com/rest/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const procoreUser = await userRes.json();
    const email = procoreUser.login;

    // 3. THE SECURITY BOUNCER: RESTRICT TO COMPANY DOMAIN
    // *** CHANGE THIS STRING TO YOUR ACTUAL COMPANY DOMAIN ***
    const allowedDomain = '@fpcinc.com';

    if (!email.toLowerCase().endsWith(allowedDomain)) {
      console.error(`Blocked unauthorized login attempt from: ${email}`);
      return NextResponse.redirect(`${baseUrl}/login?error=UnauthorizedDomain`);
    }

    // 4. Provision Supabase User
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    let { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
    let sitepulseUser = users.find(u => u.email === email);

    if (!sitepulseUser) {
      const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        email_confirm: true,
        user_metadata: {
          display_name: procoreUser.name,
          procore_id: procoreUser.id
        }
      });
      if (error) throw error;
      sitepulseUser = newUser.user;
    }

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: {
        redirectTo: `${baseUrl}${redirectPath}` // <-- Now dynamically redirects to the correct project or linking page!
      }
    });

    if (linkError) throw linkError;

    return NextResponse.redirect(linkData.properties.action_link);

  } catch (error) {
    console.error('Procore Auth Error:', error);
    return NextResponse.redirect(`${baseUrl}/login?error=ProcoreAuthFailed`);
  }
}