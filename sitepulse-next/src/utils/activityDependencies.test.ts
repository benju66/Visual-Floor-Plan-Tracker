import { describe, it, expect } from 'vitest';
import {
  predecessorEdgeFor,
  wouldCreateCycle,
  dependencyLabel,
} from './activityDependencies';
import type { ActivityDependency } from '@/types/domain';

function edge(pred: string, succ: string, lag = 0): ActivityDependency {
  return {
    id: `${pred}->${succ}`,
    predecessor_activity_id: pred,
    successor_activity_id: succ,
    type: 'FS',
    lag_days: lag,
    ripple_dates: false,
    created_by: null,
    created_at: null,
  };
}

describe('predecessorEdgeFor', () => {
  it('finds the edge whose successor matches', () => {
    const deps = [edge('a', 'b'), edge('b', 'c')];
    expect(predecessorEdgeFor(deps, 'c')?.predecessor_activity_id).toBe('b');
  });

  it('returns null when the activity has no predecessor', () => {
    expect(predecessorEdgeFor([edge('a', 'b')], 'a')).toBeNull();
    expect(predecessorEdgeFor([], 'x')).toBeNull();
  });
});

describe('wouldCreateCycle', () => {
  it('rejects a self-link', () => {
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true);
  });

  it('rejects a direct back-link (a→b then b→a)', () => {
    expect(wouldCreateCycle([edge('a', 'b')], 'b', 'a')).toBe(true);
  });

  it('rejects a transitive loop (a→b→c then c→a)', () => {
    const deps = [edge('a', 'b'), edge('b', 'c')];
    expect(wouldCreateCycle(deps, 'c', 'a')).toBe(true);
  });

  it('allows a normal forward link', () => {
    const deps = [edge('a', 'b')];
    expect(wouldCreateCycle(deps, 'b', 'c')).toBe(false);
    expect(wouldCreateCycle(deps, 'a', 'c')).toBe(false);
  });

  it('terminates on pre-existing circular data instead of hanging', () => {
    // Bad data: a→b and b→a already stored. Linking d as predecessor of c never
    // touches the loop; walking from the loop must still terminate.
    const deps = [edge('a', 'b'), edge('b', 'a')];
    expect(wouldCreateCycle(deps, 'a', 'c')).toBe(false);
  });
});

describe('dependencyLabel', () => {
  const names = new Map([
    ['a', 'Framing'],
    ['b', 'Drywall'],
  ]);

  it('omits a zero lag', () => {
    expect(dependencyLabel(edge('a', 'b', 0), names)).toBe('after Framing');
  });

  it('formats positive and negative lags', () => {
    expect(dependencyLabel(edge('a', 'b', 3), names)).toBe('after Framing +3d');
    expect(dependencyLabel(edge('a', 'b', -2), names)).toBe('after Framing −2d');
  });

  it('degrades to "?" for an unknown predecessor', () => {
    expect(dependencyLabel(edge('gone', 'b', 0), names)).toBe('after ?');
  });
});