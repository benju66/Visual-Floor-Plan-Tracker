import { describe, it, expect } from 'vitest';
import { contactsToPalette } from './contactsToPalette';
import type { ProjectContact } from '@/types/domain';

// Build a full ProjectContact Row (keeps test files type-clean per AGENTS §9),
// overriding only the fields each case cares about.
function mk(overrides: Partial<ProjectContact>): ProjectContact {
  return {
    id: 'c1',
    project_id: 'p1',
    company: '',
    first_name: null,
    last_name: null,
    job_title: null,
    mobile_phone: null,
    email: null,
    procore_id: null,
    created_by: null,
    created_at: '2026-06-23T00:00:00.000Z',
    updated_at: '2026-06-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('contactsToPalette', () => {
  it('collapses distinct companies to one entry each (company mode, default)', () => {
    const result = contactsToPalette([
      mk({ company: 'Acme Drywall, Inc.', first_name: 'Bob' }),
      mk({ company: 'Acme Drywall, Inc.', first_name: 'Sue' }),
      mk({ company: 'Beta Electric' }),
    ]);
    expect(result).toEqual(['Acme Drywall, Inc.', 'Beta Electric']);
  });

  it('excludes blank / whitespace-only companies and trims the rest', () => {
    const result = contactsToPalette([
      mk({ company: '   ' }),
      mk({ company: '' }),
      mk({ company: '  Padded Co  ' }),
    ]);
    expect(result).toEqual(['Padded Co']);
  });

  it('returns a de-duped, locale-sorted list', () => {
    const result = contactsToPalette([
      mk({ company: 'Zeta' }),
      mk({ company: 'alpha' }),
      mk({ company: 'Zeta' }),
      mk({ company: 'Mid Co' }),
    ]);
    expect(result).toEqual(['alpha', 'Mid Co', 'Zeta']);
  });

  it('returns an empty list for no contacts', () => {
    expect(contactsToPalette([])).toEqual([]);
  });

  it('in company-contact mode, labels as "Company — First Last"', () => {
    const result = contactsToPalette(
      [mk({ company: 'Acme', first_name: 'Bob', last_name: 'Vance' })],
      { mode: 'company-contact' },
    );
    expect(result).toEqual(['Acme — Bob Vance']);
  });

  it('in company-contact mode, a contact with no name falls back to company-only', () => {
    const result = contactsToPalette(
      [
        mk({ company: 'Acme', first_name: null, last_name: '   ' }),
        mk({ company: 'Acme', first_name: 'Bob', last_name: null }),
      ],
      { mode: 'company-contact' },
    );
    expect(result).toEqual(['Acme', 'Acme — Bob']);
  });
});
