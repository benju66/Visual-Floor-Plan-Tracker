import { describe, it, expect } from 'vitest';
import {
  applyPlaybook,
  narrowPlaybook,
  playbooksForProjectType,
  type ApplyPlaybookInput,
} from './playbooks';
import type {
  ActivityDictionaryEntry,
  PlaybookItem,
  PlaybookWithItems,
  ProjectType,
} from '@/types/domain';
import type { Database } from '@/types/database.types';

// --- fixture builders -------------------------------------------------------

function dictEntry(id: string, name: string, type: 'task' | 'milestone' = 'task', track: string | null = null): ActivityDictionaryEntry {
  return {
    id,
    name,
    track,
    type,
    status: 'active',
    aliases: [],
    default_project_types: [],
    cost_code_id: null,
    proposed_note: null,
    created_by: null,
    created_at: null,
    updated_at: null,
  };
}

function item(overrides: Partial<PlaybookItem> & Pick<PlaybookItem, 'id' | 'dictionary_id' | 'sequence_order'>): PlaybookItem {
  return {
    playbook_id: 'pb1',
    track: null,
    color: null,
    predecessor_item_id: null,
    lag_days: 0,
    created_at: null,
    ...overrides,
  };
}

function playbook(items: PlaybookItem[]): PlaybookWithItems {
  return {
    id: 'pb1',
    name: 'Test Playbook',
    description: null,
    default_project_types: [],
    status: 'active',
    created_by: null,
    created_at: null,
    updated_at: null,
    items,
  };
}

const COLORS = ['#aaa', '#bbb', '#ccc', '#ddd'];

function baseInput(over: Partial<ApplyPlaybookInput> = {}): ApplyPlaybookInput {
  return {
    playbook: playbook([]),
    dictionary: [],
    existing: [],
    track: 'Production',
    startSequenceOrder: 0,
    colors: COLORS,
    ...over,
  };
}

// --- narrowPlaybook ---------------------------------------------------------

describe('narrowPlaybook', () => {
  type PlaybookRow = Database['public']['Tables']['playbooks']['Row'];
  const row = (dpt: unknown): PlaybookRow => ({
    id: 'p', name: 'n', description: null,
    default_project_types: dpt as PlaybookRow['default_project_types'],
    status: 'active', created_by: null, created_at: null, updated_at: null,
  });

  it('keeps a valid ProjectType[] JSONB value', () => {
    expect(narrowPlaybook(row(['Commercial', 'Educational'])).default_project_types)
      .toEqual(['Commercial', 'Educational']);
  });

  it('degrades a malformed JSONB value to [] rather than throwing', () => {
    expect(narrowPlaybook(row(['NotAType'])).default_project_types).toEqual([]);
    expect(narrowPlaybook(row(null)).default_project_types).toEqual([]);
    expect(narrowPlaybook(row('oops')).default_project_types).toEqual([]);
  });
});

// --- playbooksForProjectType ------------------------------------------------

describe('playbooksForProjectType', () => {
  const a = { id: 'a', default_project_types: ['Commercial'] as ProjectType[] };
  const b = { id: 'b', default_project_types: [] as ProjectType[] };
  const c = { id: 'c', default_project_types: ['Educational', 'Commercial'] as ProjectType[] };

  it('orders defaults for the project type first, stable within groups', () => {
    const out = playbooksForProjectType('Commercial', [a, b, c]);
    expect(out.map((p) => p.id)).toEqual(['a', 'c', 'b']);
  });

  it('keeps natural order when the project type is null', () => {
    expect(playbooksForProjectType(null, [a, b, c]).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('never drops a playbook (scoping is ordering only, not a filter)', () => {
    expect(playbooksForProjectType('Educational', [a, b, c])).toHaveLength(3);
  });
});

// --- applyPlaybook: ordering + derivation -----------------------------------

describe('applyPlaybook — ordering & derivation', () => {
  it('seeds items in sequence_order with contiguous fresh order from startSequenceOrder', () => {
    const dict = [dictEntry('d1', 'Framing'), dictEntry('d2', 'Drywall'), dictEntry('d3', 'Paint')];
    // Deliberately out of array order; sequence_order defines the intent.
    const pb = playbook([
      item({ id: 'i2', dictionary_id: 'd2', sequence_order: 1 }),
      item({ id: 'i1', dictionary_id: 'd1', sequence_order: 0 }),
      item({ id: 'i3', dictionary_id: 'd3', sequence_order: 2 }),
    ]);
    const { activities } = applyPlaybook(baseInput({ playbook: pb, dictionary: dict, startSequenceOrder: 5 }));
    expect(activities.map((a) => a.name)).toEqual(['Framing', 'Drywall', 'Paint']);
    expect(activities.map((a) => a.sequence_order)).toEqual([5, 6, 7]);
  });

  it('derives name + type from the dictionary and applies the batch track/colors', () => {
    const dict = [dictEntry('d1', 'Framing', 'task'), dictEntry('d2', 'Final Inspection', 'milestone')];
    const pb = playbook([
      item({ id: 'i1', dictionary_id: 'd1', sequence_order: 0 }),
      item({ id: 'i2', dictionary_id: 'd2', sequence_order: 1 }),
    ]);
    const { activities } = applyPlaybook(baseInput({ playbook: pb, dictionary: dict, track: 'Interiors' }));
    expect(activities[0]).toMatchObject({ name: 'Framing', type: 'task', track: 'Interiors', color: '#aaa', dictionary_id: 'd1' });
    expect(activities[1]).toMatchObject({ name: 'Final Inspection', type: 'milestone', track: 'Interiors', color: '#bbb', dictionary_id: 'd2' });
  });

  it('honours per-item track and color overrides, falling back otherwise', () => {
    const dict = [dictEntry('d1', 'Framing'), dictEntry('d2', 'Drywall')];
    const pb = playbook([
      item({ id: 'i1', dictionary_id: 'd1', sequence_order: 0, track: 'Structure', color: '#123456' }),
      item({ id: 'i2', dictionary_id: 'd2', sequence_order: 1 }),
    ]);
    const { activities } = applyPlaybook(baseInput({ playbook: pb, dictionary: dict, track: 'Production' }));
    expect(activities[0]).toMatchObject({ track: 'Structure', color: '#123456' });
    // Fallback color is position-keyed (emitted index 1 → palette[1]), matching the wizard.
    expect(activities[1]).toMatchObject({ track: 'Production', color: '#bbb' });
  });

  it('skips an item whose dictionary entry cannot be resolved', () => {
    const dict = [dictEntry('d1', 'Framing')];
    const pb = playbook([
      item({ id: 'i1', dictionary_id: 'd1', sequence_order: 0 }),
      item({ id: 'iX', dictionary_id: 'missing', sequence_order: 1 }),
    ]);
    const { activities } = applyPlaybook(baseInput({ playbook: pb, dictionary: dict }));
    expect(activities.map((a) => a.name)).toEqual(['Framing']);
  });
});

// --- applyPlaybook: edge index mapping --------------------------------------

describe('applyPlaybook — FS edge mapping', () => {
  it('maps predecessor_item_id to activity indices, preserving lag', () => {
    const dict = [dictEntry('d1', 'Framing'), dictEntry('d2', 'Drywall'), dictEntry('d3', 'Paint')];
    const pb = playbook([
      item({ id: 'i1', dictionary_id: 'd1', sequence_order: 0 }),
      item({ id: 'i2', dictionary_id: 'd2', sequence_order: 1, predecessor_item_id: 'i1', lag_days: 2 }),
      item({ id: 'i3', dictionary_id: 'd3', sequence_order: 2, predecessor_item_id: 'i2', lag_days: -1 }),
    ]);
    const { edges } = applyPlaybook(baseInput({ playbook: pb, dictionary: dict }));
    expect(edges).toEqual([
      { predecessorIndex: 0, successorIndex: 1, lagDays: 2 },
      { predecessorIndex: 1, successorIndex: 2, lagDays: -1 },
    ]);
  });

  it('drops an edge whose predecessor was skipped as a duplicate', () => {
    const dict = [dictEntry('d1', 'Framing'), dictEntry('d2', 'Drywall')];
    const pb = playbook([
      item({ id: 'i1', dictionary_id: 'd1', sequence_order: 0 }),
      item({ id: 'i2', dictionary_id: 'd2', sequence_order: 1, predecessor_item_id: 'i1', lag_days: 3 }),
    ]);
    // Project already has Framing (same track) → i1 skipped → the edge has no predecessor.
    const { activities, edges, skipped } = applyPlaybook(baseInput({
      playbook: pb,
      dictionary: dict,
      existing: [{ dictionary_id: 'd1', name: 'Framing', track: 'Production' }],
    }));
    expect(activities.map((a) => a.name)).toEqual(['Drywall']);
    expect(skipped).toEqual(['Framing']);
    expect(edges).toEqual([]);
  });

  it('drops a cyclic edge defensively (never emits a loop)', () => {
    const dict = [dictEntry('d1', 'A'), dictEntry('d2', 'B')];
    // i1's predecessor is i2 and i2's predecessor is i1 → a 2-cycle.
    const pb = playbook([
      item({ id: 'i1', dictionary_id: 'd1', sequence_order: 0, predecessor_item_id: 'i2' }),
      item({ id: 'i2', dictionary_id: 'd2', sequence_order: 1, predecessor_item_id: 'i1' }),
    ]);
    const { edges } = applyPlaybook(baseInput({ playbook: pb, dictionary: dict }));
    // First edge accepted (i2→i1), second (i1→i2) would close the loop → dropped.
    expect(edges).toHaveLength(1);
  });
});

// --- applyPlaybook: never-duplicate skip rule -------------------------------

describe('applyPlaybook — never-duplicate skip rule', () => {
  it('skips by dictionary_id when the project already has it in the same track', () => {
    const dict = [dictEntry('d1', 'Framing'), dictEntry('d2', 'Drywall')];
    const pb = playbook([
      item({ id: 'i1', dictionary_id: 'd1', sequence_order: 0 }),
      item({ id: 'i2', dictionary_id: 'd2', sequence_order: 1 }),
    ]);
    const { activities, skipped } = applyPlaybook(baseInput({
      playbook: pb,
      dictionary: dict,
      track: 'Production',
      existing: [{ dictionary_id: 'd1', name: 'Framing', track: 'Production' }],
    }));
    expect(activities.map((a) => a.name)).toEqual(['Drywall']);
    expect(skipped).toEqual(['Framing']);
  });

  it('skips an unlinked existing activity by name (dictionary_id null)', () => {
    const dict = [dictEntry('d1', 'Framing')];
    const pb = playbook([item({ id: 'i1', dictionary_id: 'd1', sequence_order: 0 })]);
    const { activities, skipped } = applyPlaybook(baseInput({
      playbook: pb,
      dictionary: dict,
      track: 'Production',
      existing: [{ dictionary_id: null, name: 'framing', track: 'Production' }], // different case, unlinked
    }));
    expect(activities).toHaveLength(0);
    expect(skipped).toEqual(['Framing']);
  });

  it('allows the same canonical activity in a DIFFERENT track (not a duplicate)', () => {
    const dict = [dictEntry('d1', 'Framing')];
    const pb = playbook([item({ id: 'i1', dictionary_id: 'd1', sequence_order: 0, track: 'Interiors' })]);
    const { activities, skipped } = applyPlaybook(baseInput({
      playbook: pb,
      dictionary: dict,
      existing: [{ dictionary_id: 'd1', name: 'Framing', track: 'Production' }],
    }));
    expect(activities.map((a) => a.track)).toEqual(['Interiors']);
    expect(skipped).toEqual([]);
  });

  it('does not duplicate within the playbook itself (same activity+track twice)', () => {
    const dict = [dictEntry('d1', 'Framing')];
    const pb = playbook([
      item({ id: 'i1', dictionary_id: 'd1', sequence_order: 0 }),
      item({ id: 'i2', dictionary_id: 'd1', sequence_order: 1 }),
    ]);
    const { activities } = applyPlaybook(baseInput({ playbook: pb, dictionary: dict, track: 'Production' }));
    expect(activities).toHaveLength(1);
  });
});
