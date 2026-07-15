import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drive the auth decision directly (serverAuth has its own unit test) and mock
// the service-role Supabase client so we can assert the DB calls without a real
// database. See AGENTS.md §9 for the chainable-stub recipe.
const getUserFromRequest = vi.fn();
vi.mock('@/utils/serverAuth', () => ({
  getUserFromRequest: (request: Request) => getUserFromRequest(request),
}));

const projectsSingle = vi.fn();
const projectsInsert = vi.fn(() => ({ select: () => ({ single: projectsSingle }) }));
const projectsDeleteEq = vi.fn();
const projectsDelete = vi.fn(() => ({ eq: projectsDeleteEq }));
const membersInsert = vi.fn();

const from = vi.fn((table: string) => {
  if (table === 'projects') return { insert: projectsInsert, delete: projectsDelete };
  if (table === 'project_members') return { insert: membersInsert };
  throw new Error(`unexpected table ${table}`);
});
const createClient = vi.fn((..._args: unknown[]) => ({ from }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

import { POST } from './route';

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getUserFromRequest.mockReset();
  createClient.mockClear();
  from.mockClear();
  projectsInsert.mockClear();
  projectsSingle.mockReset().mockResolvedValue({ data: { id: 'proj-1' }, error: null });
  projectsDelete.mockClear();
  projectsDeleteEq.mockReset().mockResolvedValue({ error: null });
  membersInsert.mockReset().mockResolvedValue({ error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/projects', () => {
  it('rejects an unauthenticated request with 401 and never touches the database', async () => {
    getUserFromRequest.mockResolvedValue({
      user: null,
      error: { status: 401, message: 'Not authenticated' },
    });

    const res = await POST(postRequest({ name: 'X', user_id: 'attacker' }));

    expect(res.status).toBe(401);
    // No service-role client is ever constructed → no DB write.
    expect(createClient).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('assigns membership to the verified token user and ignores a body-supplied user_id', async () => {
    getUserFromRequest.mockResolvedValue({ user: { id: 'token-user' }, error: null });

    const res = await POST(postRequest({ name: 'My Project', user_id: 'attacker-id' }));

    expect(res.status).toBe(200);
    // The membership row is keyed to the verified user, never the body value.
    expect(membersInsert).toHaveBeenCalledWith([
      { project_id: 'proj-1', user_id: 'token-user', role: 'admin' },
    ]);
    // Happy path leaves no orphan cleanup.
    expect(projectsDelete).not.toHaveBeenCalled();
  });

  it('returns 400 without a project name, before any DB call', async () => {
    getUserFromRequest.mockResolvedValue({ user: { id: 'token-user' }, error: null });

    const res = await POST(postRequest({ user_id: 'token-user' }));

    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('cleans up the orphan project and returns a generic 500 when membership insert fails', async () => {
    getUserFromRequest.mockResolvedValue({ user: { id: 'token-user' }, error: null });
    projectsSingle.mockResolvedValue({ data: { id: 'proj-2' }, error: null });
    membersInsert.mockResolvedValue({ error: { message: 'FK violation' } });

    const res = await POST(postRequest({ name: 'Doomed' }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Could not create the project.');
    // The just-created project row is best-effort deleted so it isn't orphaned.
    expect(projectsDelete).toHaveBeenCalled();
    expect(projectsDeleteEq).toHaveBeenCalledWith('id', 'proj-2');
  });
});
