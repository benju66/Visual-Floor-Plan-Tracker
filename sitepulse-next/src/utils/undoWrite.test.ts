import { describe, it, expect } from 'vitest';
import {
  buildStatusResetPayload,
  buildStatusRestorePayload,
  buildBulkUndoPayloads,
  toUniformPayloads,
} from './undoWrite';

const NOW = '2026-08-27T12:00:00.000Z';

describe('buildStatusResetPayload', () => {
  it('sends every cleared field PRESENT-and-empty, plus the slot key and a fresh timestamp', () => {
    // The exact shape useClearStatus sends. status_color is the load-bearing one:
    // it is NOT NULL with no default, so the pre-Phase-1 four-column payload was
    // rejected by the database (23502) and the undo did nothing.
    expect(buildStatusResetPayload('unit-1', 'act-1', 'Production', NOW)).toEqual({
      unit_id: 'unit-1',
      activity_id: 'act-1',
      track: 'Production',
      temporal_state: 'none',
      status_color: '',
      planned_start_date: '',
      planned_end_date: '',
      logged_date: '',
      actual_start_date: '',
      client_timestamp: NOW,
    });
  });

  it('spells out all four dates AND the colour — omitting them would PRESERVE, not clear', () => {
    const payload = buildStatusResetPayload('unit-1', 'act-1', 'Production', NOW);
    // Assert on key PRESENCE, not just values: under omit-preserves/present-clears a
    // dropped key keeps the stored date. This is the assertion that catches a future
    // "tidy-up" that removes an empty-looking field.
    expect(Object.keys(payload).sort()).toEqual([
      'activity_id',
      'actual_start_date',
      'client_timestamp',
      'logged_date',
      'planned_end_date',
      'planned_start_date',
      'status_color',
      'temporal_state',
      'track',
      'unit_id',
    ]);
  });

  it('omits track when the caller has none — an omitted key preserves the stored track', () => {
    // A present-empty track would reset the column to the RPC's 'Production' default;
    // omitting it keeps whatever is stored. "We do not know" must not mean "overwrite".
    const withoutTrack = buildStatusResetPayload('unit-1', 'act-1', null, NOW);
    expect({
      hasTrackKey: Object.prototype.hasOwnProperty.call(withoutTrack, 'track'),
      undefinedTrack: Object.prototype.hasOwnProperty.call(
        buildStatusResetPayload('unit-1', 'act-1', undefined, NOW), 'track'),
      emptyTrack: Object.prototype.hasOwnProperty.call(
        buildStatusResetPayload('unit-1', 'act-1', '', NOW), 'track'),
    }).toEqual({ hasTrackKey: false, undefinedTrack: false, emptyTrack: false });
  });

  it('is deterministic — the timestamp comes only from the caller', () => {
    expect(buildStatusResetPayload('unit-1', 'act-1', 'Production', NOW))
      .toEqual(buildStatusResetPayload('unit-1', 'act-1', 'Production', NOW));
    expect(buildStatusResetPayload('unit-1', 'act-1', 'Production', '2020-01-01T00:00:00.000Z').client_timestamp)
      .toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('buildStatusRestorePayload', () => {
  const storedRow = {
    id: 'log-1',
    created_at: '2026-08-01T09:00:00.000Z',
    activityName: 'Drywall',
    milestone: 'Drywall', // legacy pre-rename key from an old offline capture
    unit_id: 'unit-1',
    activity_id: 'act-1',
    track: 'Production',
    status_color: '#3366aa',
    temporal_state: 'completed',
    planned_start_date: '2026-08-03',
    planned_end_date: '2026-08-07',
    logged_date: '2026-08-06',
    actual_start_date: '2026-08-04',
    client_timestamp: '2026-08-06T15:00:00.000Z',
  };

  it('restores the snapshot verbatim, minus the DB-owned and synthesized keys', () => {
    expect(buildStatusRestorePayload(storedRow, NOW)).toEqual({
      unit_id: 'unit-1',
      activity_id: 'act-1',
      track: 'Production',
      status_color: '#3366aa',
      temporal_state: 'completed',
      planned_start_date: '2026-08-03',
      planned_end_date: '2026-08-07',
      logged_date: '2026-08-06',
      actual_start_date: '2026-08-04',
      client_timestamp: NOW,
    });
  });

  it('stamps a FRESH client_timestamp — it never carries the captured one', () => {
    // Locked decision: an undo is a new decision made NOW and must win the RPC's
    // last-write-wins compare against the value it reverses. Restoring the old
    // timestamp is exactly what made the guard reject the undo.
    expect({
      stamped: buildStatusRestorePayload(storedRow, NOW).client_timestamp,
      original: storedRow.client_timestamp,
    }).toEqual({ stamped: NOW, original: '2026-08-06T15:00:00.000Z' });
  });

  it('stamps even when the snapshot has no timestamp of its own (unlike the fallback-stamp helper)', () => {
    expect(buildStatusRestorePayload({ unit_id: 'unit-1', activity_id: 'act-1', client_timestamp: null }, NOW))
      .toEqual({ unit_id: 'unit-1', activity_id: 'act-1', client_timestamp: NOW });
  });

  it('keeps a null field present so the restore CLEARS it rather than preserving a newer value', () => {
    // A slot that had no completion date must come back without one. Present-null is
    // the RPC's clear; dropping the key would preserve the date being undone.
    const payload = buildStatusRestorePayload({ ...storedRow, logged_date: null, actual_start_date: null }, NOW);
    expect({
      logged_date: payload.logged_date,
      actual_start_date: payload.actual_start_date,
      hasLoggedKey: Object.prototype.hasOwnProperty.call(payload, 'logged_date'),
      hasActualKey: Object.prototype.hasOwnProperty.call(payload, 'actual_start_date'),
    }).toEqual({ logged_date: null, actual_start_date: null, hasLoggedKey: true, hasActualKey: true });
  });

  it('never mutates the snapshot it was handed', () => {
    const input = { ...storedRow };
    buildStatusRestorePayload(input, NOW);
    expect(input).toEqual(storedRow);
  });
});

describe('toUniformPayloads', () => {
  it('fills every row out to the union of keys with null', () => {
    expect(toUniformPayloads([
      { unit_id: 'u1', logged_date: '2026-08-06' },
      { unit_id: 'u2', status_color: '' },
    ])).toEqual([
      { unit_id: 'u1', logged_date: '2026-08-06', status_color: null },
      { unit_id: 'u2', logged_date: null, status_color: '' },
    ]);
  });

  it('leaves an already-uniform batch untouched, and handles an empty batch', () => {
    const rows = [{ unit_id: 'u1', temporal_state: 'none' }, { unit_id: 'u2', temporal_state: 'completed' }];
    expect(toUniformPayloads(rows)).toEqual(rows);
    expect(toUniformPayloads([])).toEqual([]);
  });
});

describe('buildBulkUndoPayloads', () => {
  const prior = {
    id: 'log-u2', created_at: '2026-08-01T09:00:00.000Z', activityName: 'Drywall',
    unit_id: 'u2', activity_id: 'act-1', track: 'Production',
    status_color: '#aaaaaa', temporal_state: 'planned',
    planned_start_date: '2026-08-03', planned_end_date: '2026-08-07',
    logged_date: null, actual_start_date: null,
    client_timestamp: '2026-08-06T15:00:00.000Z',
  };
  const slots = ['u1', 'u2', 'u3'].map(u => ({ unit_id: u, activity_id: 'act-1', track: 'Production' }));

  it('writes a row for EVERY slot, not just the ones with a prior status (defect 4)', () => {
    // The whole bug in one assertion: pre-fix, only u2 (the slot with an oldLog)
    // reached the database — u1 and u3 reverted on screen and nowhere else.
    expect(buildBulkUndoPayloads(slots, [prior], 'Production', NOW)
      .map(r => `${r.unit_id}:${r.temporal_state}`))
      .toEqual(['u1:none', 'u2:planned', 'u3:none']);
  });

  it('resets an unwritten slot with NULL dates — "" would fail the date cast on the raw upsert', () => {
    const [u1] = buildBulkUndoPayloads([slots[0]], [], 'Production', NOW);
    expect(u1).toEqual({
      unit_id: 'u1',
      activity_id: 'act-1',
      track: 'Production',
      temporal_state: 'none',
      status_color: '',
      planned_start_date: null,
      planned_end_date: null,
      logged_date: null,
      actual_start_date: null,
      client_timestamp: NOW,
    });
  });

  it('restores a prior slot verbatim, minus DB-owned keys, with a fresh timestamp', () => {
    const [u2] = buildBulkUndoPayloads([slots[1]], [prior], 'Production', NOW);
    expect(u2).toEqual({
      unit_id: 'u2',
      activity_id: 'act-1',
      track: 'Production',
      status_color: '#aaaaaa',
      temporal_state: 'planned',
      planned_start_date: '2026-08-03',
      planned_end_date: '2026-08-07',
      logged_date: null,
      actual_start_date: null,
      client_timestamp: NOW,
    });
  });

  it('emits a key-uniform batch even when restores and resets are mixed', () => {
    // PostgREST builds ONE insert from a single column list; a ragged batch is
    // rejected whole, taking the valid rows with it.
    const keySets = buildBulkUndoPayloads(slots, [prior], 'Production', NOW)
      .map(r => Object.keys(r).sort().join(','));
    expect(new Set(keySets).size).toBe(1);
  });

  it('fills a key only some priors carry, rather than leaving the batch ragged', () => {
    const sparse = { unit_id: 'u2', activity_id: 'act-1', track: 'Production', legacy_extra: 'x' };
    const rows = buildBulkUndoPayloads(slots, [sparse], 'Production', NOW);
    expect({
      uniform: new Set(rows.map(r => Object.keys(r).sort().join(','))).size,
      filled: rows[0].legacy_extra,
      kept: rows[1].legacy_extra,
    }).toEqual({ uniform: 1, filled: null, kept: 'x' });
  });

  it('covers a slot the action wrote under a DIFFERENT activity (the auto-advanced one)', () => {
    const advanced = { unit_id: 'u1', activity_id: 'act-2', track: 'Production' };
    expect(buildBulkUndoPayloads([slots[0], advanced], [], 'Production', NOW)
      .map(r => `${r.unit_id}/${r.activity_id}:${r.temporal_state}`))
      .toEqual(['u1/act-1:none', 'u1/act-2:none']);
  });

  it('deduplicates repeated slots, first occurrence winning', () => {
    // The caller passes newLogs ∪ oldLogs, so a slot present on both sides appears twice.
    const rows = buildBulkUndoPayloads([slots[1], { unit_id: 'u2', activity_id: 'act-1' }], [prior], 'Production', NOW);
    expect({ count: rows.length, state: rows[0].temporal_state }).toEqual({ count: 1, state: 'planned' });
  });

  it('drops a slot it cannot address — there is no row to write', () => {
    expect(buildBulkUndoPayloads(
      [{ unit_id: 'u1' }, { activity_id: 'act-1' }, slots[0]], [], 'Production', NOW,
    ).map(r => r.unit_id)).toEqual(['u1']);
  });

  it('prefers the prior row\'s own track, then the slot\'s, then the fallback', () => {
    const other = { ...prior, track: 'Sitework' };
    expect({
      fromPrior: buildBulkUndoPayloads([slots[1]], [other], 'Production', NOW)[0].track,
      fromSlot: buildBulkUndoPayloads([slots[0]], [], null, NOW)[0].track,
      fromFallback: buildBulkUndoPayloads([{ unit_id: 'u9', activity_id: 'act-1' }], [], 'Production', NOW)[0].track,
    }).toEqual({ fromPrior: 'Sitework', fromSlot: 'Production', fromFallback: 'Production' });
  });

  it('throws rather than inventing a track it cannot resolve', () => {
    // track is NOT NULL, and guessing would file the location under the wrong scope.
    expect(() => buildBulkUndoPayloads([{ unit_id: 'u9', activity_id: 'act-1' }], [], null, NOW))
      .toThrow(/track/);
  });

  it('is deterministic and never mutates its inputs', () => {
    const priorCopy = { ...prior };
    const first = buildBulkUndoPayloads(slots, [prior], 'Production', NOW);
    expect(buildBulkUndoPayloads(slots, [prior], 'Production', NOW)).toEqual(first);
    expect(prior).toEqual(priorCopy);
  });
});
