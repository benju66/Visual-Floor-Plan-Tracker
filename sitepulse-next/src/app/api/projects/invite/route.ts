import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateInvitePayload, parseBearerToken, INVITER_ROLES } from '@/utils/invite';

// POST /api/projects/invite
// Invite someone to a project by email. Runs with the service-role key
// SERVER-SIDE ONLY (mirrors src/app/api/projects/route.js) because both the
// admin auth API (inviteUserByEmail) and the membership insert must bypass
// client RLS. The caller is authenticated from their bearer token and must be
// a privileged member (owner/admin/pm) of the target project.
//
// Two outcomes:
//   - Invitee already has an account  -> link them directly (no email).
//   - Invitee is new                  -> insert a pending membership row
//     (user_id NULL), then send a Supabase invite email. The handle_new_user
//     trigger stamps the real user_id onto the row once their account exists.
export async function POST(request: Request) {
  try {
    // 1. Validate + normalize the payload.
    const body = await request.json().catch(() => ({}));
    const parsed = validateInvitePayload(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { project_id, email, role } = parsed.value;

    // 2. Identify the caller from their bearer token.
    const token = parseBearerToken(request.headers.get('authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    );

    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
    const caller = callerData?.user;
    if (callerError || !caller) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    // 3. Authorize: caller must be a privileged member of THIS project.
    const { data: callerMembership, error: roleError } = await supabaseAdmin
      .from('project_members')
      .select('role')
      .eq('project_id', project_id)
      .eq('user_id', caller.id)
      .maybeSingle();
    if (roleError) throw roleError;
    if (!callerMembership || !(INVITER_ROLES as readonly string[]).includes(callerMembership.role)) {
      return NextResponse.json(
        { error: 'You do not have permission to invite members to this project.' },
        { status: 403 },
      );
    }

    // 4. Does the invitee already have an account? (profiles.email is populated
    //    for every user by the handle_new_user trigger.)
    const { data: existingProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (profileError) throw profileError;

    // 5. Reject duplicates: already a member, or a pending invite already out.
    const { data: existingRows, error: dupeError } = await supabaseAdmin
      .from('project_members')
      .select('user_id, user_email')
      .eq('project_id', project_id);
    if (dupeError) throw dupeError;
    const alreadyMember = (existingRows ?? []).some((m) =>
      (existingProfile != null && m.user_id === existingProfile.id) ||
      (typeof m.user_email === 'string' && m.user_email.toLowerCase() === email),
    );
    if (alreadyMember) {
      return NextResponse.json(
        { error: 'That person is already a member of this project (or has a pending invite).' },
        { status: 409 },
      );
    }

    // 6. Create the membership row. Existing user -> link immediately; new user
    //    -> leave user_id NULL for the trigger to claim on accept.
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('project_members')
      .insert([{ project_id, user_email: email, role, user_id: existingProfile?.id ?? null }])
      .select('id')
      .single();
    if (insertError) throw insertError;

    // 7a. Existing user: already linked, no invite email required.
    if (existingProfile) {
      return NextResponse.json({
        status: 'linked_existing',
        message: 'That person already has an account and was added to the project.',
      });
    }

    // 7b. New user: send the Supabase invite email. The redirect lands them on
    //     the set-password page; the trigger auto-links their fresh account.
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ||
      request.headers.get('origin') ||
      new URL(request.url).origin;
    const redirectTo = `${origin}/auth/set-password`;

    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
    });
    if (inviteError) {
      // Roll back the pending row so the dup guard does not block a retry.
      await supabaseAdmin.from('project_members').delete().eq('id', inserted.id);
      throw inviteError;
    }

    return NextResponse.json({ status: 'invited', message: 'Invitation email sent.' });
  } catch (error) {
    console.error('Member Invite Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
