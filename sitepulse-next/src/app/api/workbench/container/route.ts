import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserFromRequest } from '@/utils/serverAuth';

// Bootstrap (find-or-create) the SINGLE hidden Location Labeling Workbench
// container — a `projects` row flagged `kind='workbench'`. Mirrors
// `src/app/api/projects/route.js`: it requires the caller's VERIFIED login token
// (never a body-supplied user_id — an unauthenticated caller can no longer create
// the container or grant themselves membership), runs with the service-role key
// SERVER-SIDE ONLY (so we never widen client RLS), and assigns the creating user
// the `'admin'` role (a plain `.insert`, NOT the `create_new_project` RPC — same
// as api/projects). That admin membership satisfies the privileged-write RLS on
// workbench_sheets / sheets / units the later phases rely on. Client-facing
// errors are generic; the real detail goes to `console.error` only.
//
// Lazy-create on first privileged visit (the plan's default): if a workbench
// container already exists we return it untouched and add no membership — v1
// keeps one shared container with manual membership (plan § Out of scope).

const WORKBENCH_CONTAINER_NAME = 'Drawing Library';

export async function POST(request: Request) {
  // Require a real login token and derive the user from it.
  const { user, error: authError } = await getUserFromRequest(request);
  if (authError) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: authError.status });
  }

  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    );

    // 1. Look for the existing container. Ordered + limited so that, even if a
    //    race ever produced two, we deterministically return the earliest one.
    const { data: existing, error: findError } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('kind', 'workbench')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      return NextResponse.json(existing);
    }

    // 2. None exists — create it.
    const { data: container, error: createError } = await supabaseAdmin
      .from('projects')
      .insert([{ name: WORKBENCH_CONTAINER_NAME, kind: 'workbench' }])
      .select()
      .single();

    if (createError) throw createError;

    // 3. Make the VERIFIED user an admin (mirrors api/projects).
    const { error: memberError } = await supabaseAdmin
      .from('project_members')
      .insert([{ project_id: container.id, user_id: user.id, role: 'admin' }]);

    if (memberError) {
      // The membership row failed on a container we just created, so it would be
      // an orphan. Best-effort delete it before failing (mirrors api/projects).
      const { error: cleanupError } = await supabaseAdmin
        .from('projects')
        .delete()
        .eq('id', container.id);
      if (cleanupError) {
        console.error('Workbench container cleanup after member-insert failure also failed:', cleanupError);
      }
      throw memberError;
    }

    return NextResponse.json(container);
  } catch (error) {
    console.error('Workbench Container Bootstrap Error:', error);
    return NextResponse.json({ error: 'Could not resolve the workbench container.' }, { status: 500 });
  }
}
