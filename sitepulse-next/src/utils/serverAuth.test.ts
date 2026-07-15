import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Supabase client so token verification can be asserted without a
// network or a real Auth server. `createClient` returns a single object whose
// `auth.getUser` we drive per test.
const getUser = vi.fn();
const createClient = vi.fn((..._args: unknown[]) => ({ auth: { getUser } }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

import { getUserFromRequest } from './serverAuth';

function requestWith(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/test', { method: 'POST', headers });
}

beforeEach(() => {
  getUser.mockReset();
  createClient.mockClear();
});

describe('getUserFromRequest', () => {
  it('returns a 401 and never touches Supabase when the Authorization header is missing', async () => {
    const result = await getUserFromRequest(requestWith({}));

    expect(result.user).toBeNull();
    expect(result.error).toEqual({ status: 401, message: 'Not authenticated' });
    // No client is even constructed — the token check short-circuits.
    expect(createClient).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('returns a 401 for a non-Bearer Authorization header', async () => {
    const result = await getUserFromRequest(requestWith({ Authorization: 'Basic abc123' }));

    expect(result.user).toBeNull();
    expect(result.error?.status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('verifies the bearer token and returns the Supabase user', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    const result = await getUserFromRequest(requestWith({ Authorization: 'Bearer real-token' }));

    // The exact token (trimmed) is handed to Supabase for verification.
    expect(getUser).toHaveBeenCalledWith('real-token');
    expect(result.user).toEqual({ id: 'user-1' });
    expect(result.error).toBeNull();
  });

  it('returns a 401 when Supabase rejects the token', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid jwt' } });

    const result = await getUserFromRequest(requestWith({ Authorization: 'Bearer forged' }));

    expect(result.user).toBeNull();
    expect(result.error?.status).toBe(401);
  });

  it('returns a 401 (never throws) when verification fails at the transport level', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getUser.mockRejectedValue(new Error('network down'));

    const result = await getUserFromRequest(requestWith({ Authorization: 'Bearer whatever' }));

    expect(result.user).toBeNull();
    expect(result.error?.status).toBe(401);
    errSpy.mockRestore();
  });
});
