import { describe, it, expect, afterEach } from 'vitest';
import { screen, waitFor, cleanup } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { renderWithQuery } from './renderWithQuery';

afterEach(cleanup);

// A trivial probe: it only resolves a value if a working QueryClientProvider is
// present. No Supabase needed — this proves the harness wires the provider.
function Probe() {
  const { data } = useQuery({
    queryKey: ['renderWithQuery-smoke'],
    queryFn: async () => 'wired',
  });
  return <div>status: {data ?? 'pending'}</div>;
}

describe('renderWithQuery', () => {
  it('provides a working QueryClient so useQuery resolves', async () => {
    renderWithQuery(<Probe />);
    expect(screen.getByText('status: pending')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('status: wired')).toBeTruthy());
  });

  it('returns the client alongside the RTL result', () => {
    const { client } = renderWithQuery(<Probe />);
    expect(client.getDefaultOptions().queries?.retry).toBe(false);
  });
});
