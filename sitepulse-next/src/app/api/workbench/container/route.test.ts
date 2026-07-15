import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drive the auth decision directly (serverAuth has its own unit test) and mock
// the service-role Supabase client. Mirrors api/projects/route.test.ts.
const getUserFromRequest = vi.fn();
vi.mock('@/utils/serverAuth', () => ({
  getUserFromRequest: (request: Request) => getUserFromRequest(request),
}));

// find chain: from('projects').select('*').eq().order().limit().maybeSingle()
const findMaybeSingle = vi.fn();
const findLimit = vi.fn(() => ({ maybeSingle: findMaybeSingle }));
const findOrder = vi.fn(() => ({ limit: findLimit }));
const findEq = vi.fn(() => ({ order: findOrder }));
const projectsSelect = vi.fn(() => ({ eq: findEq }));
// create chain: from('projects').insert([...]).select().single()
const createSingle = vi.fn();
const projectsInsert = vi.fn(() => ({ select: () => ({ single: createSingle }) }));
// cleanup: from('projects').delete().eq('id', id)
const projectsDeleteEq = vi.fn();
const projectsDelete = vi.fn(() => ({ eq: projectsDeleteEq }));
// membership insert
const membersInsert = vi.fn();

const from = vi.fn((table: string) => {
  if (table === 'projects') return { select: projectsSelect, insert: projectsInsert, delete: projectsDelete };
  if (table === 'project_members') return { insert: membersInsert };
  throw new Error(`unexpected table ${table}`);
});
const createClient = vi.fn((..._args: unknown[]) => ({ from }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

import { POST } from './route';

function postRequest(body: unknown = { user_id: 'attacker-id' }, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/workbench/container', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getUserFromRequest.mockReset();
  createClient.mockClear();
  from.mockClear();
  findMaybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
  projectsInsert.mockClear();
  createSingle.mockReset().mockResolvedValue({ data: { id: 'container-1', kind: 'workbench' }, error: null });
  projectsDelete.mockClear();
  projectsDeleteEq.mockReset().mockResolvedValue({ error: null });
  membersInsert.mockReset().mockResolvedValue({ error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/workbench/container', () => {
  it('rejects an unauthenticated request with 401 and never touches the database', async () => {
    getUserFromRequest.mockResolvedValue({
      user: null,
      error: { status: 401, message: 'Not authenticated' },
    });

    const res = await POST(postRequest());

    expect(res.status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('returns the existing container untouched, adding no membership', async () => {
    getUserFromRequest.mockResolvedValue({ user: { id: 'token-user' }, error: null });
    findMaybeSingle.mockResolvedValue({ data: { id: 'existing', kind: 'workbench' }, error: null });

    const res = await POST(postRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe('existing');
    expect(projectsInsert).not.toHaveBeenCalled();
    expect(membersInsert).not.toHaveBeenCalled();
  });

  it('creates the container and grants admin to the verified token user, not the body user_id', async () => {
    getUserFromRequest.mockResolvedValue({ user: { id: 'token-user' }, error: null });
    findMaybeSingle.mockResolvedValue({ data: null, error: null });
    createSingle.mockResolvedValue({ data: { id: 'container-2', kind: 'workbench' }, error: null });

    const res = await POST(postRequest({ user_id: 'attacker-id' }));

    expect(res.status).toBe(200);
    expect(membersInsert).toHaveBeenCalledWith([
      { project_id: 'container-2', user_id: 'token-user', role: 'admin' },
    ]);
    expect(projectsDelete).not.toHaveBeenCalled();
  });

  it('cleans up the orphan container and returns a generic 500 when membership insert fails', async () => {
    getUserFromRequest.mockResolvedValue({ user: { id: 'token-user' }, error: null });
    findMaybeSingle.mockResolvedValue({ data: null, error: null });
    createSingle.mockResolvedValue({ data: { id: 'container-3', kind: 'workbench' }, error: null });
    membersInsert.mockResolvedValue({ error: { message: 'FK violation' } });

    const res = await POST(postRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Could not resolve the workbench container.');
    expect(projectsDelete).toHaveBeenCalled();
    expect(projectsDeleteEq).toHaveBeenCalledWith('id', 'container-3');
  });
});
