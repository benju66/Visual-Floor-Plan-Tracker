import { describe, it, expect, vi, afterEach } from 'vitest';
import { warnIfUnwired } from './wiringGuard';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('warnIfUnwired', () => {
  it('returns true and does not warn when the callback is wired (dev)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(warnIfUnwired(() => {}, 'onSave:node-move')).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns false and logs one [wiring] error naming the action when null (dev)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(warnIfUnwired(null, 'onSave:node-move')).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    const message = String(spy.mock.calls[0][0]);
    expect(message).toContain('[wiring]');
    expect(message).toContain('onSave:node-move');
  });

  it('treats undefined the same as null (dev)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(warnIfUnwired(undefined, 'onStamp')).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('is a silent no-op returning true in production, even when unwired', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(warnIfUnwired(null, 'onSave:node-move')).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
