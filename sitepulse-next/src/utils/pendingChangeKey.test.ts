import { describe, it, expect } from 'vitest';
import { pendingChangeKey } from './pendingChangeKey';
import type { PendingChange, StatusLog, Unit, Activity } from '@/types/domain';

// Only unit.id / log.activityName / extraProps.activityObj.name are read — cast partials.
const unit = (id: string) => ({ id } as Unit);
const log = (activityName: string | null) => ({ activityName } as StatusLog);
const activityObj = (name: string) => ({ name } as Pick<Activity, 'id' | 'name' | 'color' | 'track'>);

const change = (over: Partial<PendingChange>): PendingChange =>
  ({ unit: unit('u1'), log: null, extraProps: {}, ...over } as PendingChange);

describe('pendingChangeKey', () => {
  it('keys a timeline change by its staged activity object name', () => {
    // The staged activityObj is the slot identity used by the offline replay path.
    expect(pendingChangeKey(change({ extraProps: { activityObj: activityObj('Framing') } }))).toBe('u1_Framing');
  });

  it('falls back to the base log activityName when no activityObj is staged', () => {
    expect(pendingChangeKey(change({ log: log('Drywall') }))).toBe('u1_Drywall');
  });

  it('prefers the staged activityObj name over the base log name', () => {
    expect(
      pendingChangeKey(change({ log: log('Drywall'), extraProps: { activityObj: activityObj('Paint') } })),
    ).toBe('u1_Paint');
  });

  it("uses the 'Primary' sentinel for a location-level change with no activity", () => {
    expect(pendingChangeKey(change({ log: null, extraProps: {} }))).toBe('u1_Primary');
  });

  it("treats a null log activityName as no activity (falls back to 'Primary')", () => {
    expect(pendingChangeKey(change({ log: log(null) }))).toBe('u1_Primary');
  });

  it('accepts the partial an edit handler holds ({ unit, log, extraProps })', () => {
    const key = pendingChangeKey({ unit: unit('abc'), log: log('MEP'), extraProps: {} });
    expect(key).toBe('abc_MEP');
  });

  it('produces a key whose unit id is recoverable by slicing at the first underscore', () => {
    // Unit ids are UUIDs (no underscore), so slice(0, indexOf('_')) recovers the unit.
    const key = pendingChangeKey(change({ unit: unit('7a3f-uuid'), extraProps: { activityObj: activityObj('Framing') } }));
    expect(key.slice(0, key.indexOf('_'))).toBe('7a3f-uuid');
  });
});
