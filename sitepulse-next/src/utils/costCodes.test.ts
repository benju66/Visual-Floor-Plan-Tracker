import { describe, it, expect } from 'vitest';
import {
  normalizeCode,
  deriveDivision,
  divisionLabel,
  parseCostCodeCatalog,
  filterCostCodesForAdmin,
  groupCostCodesByDivision,
} from './costCodes';
import type { CostCode } from '@/types/domain';

const mkCode = (over: Partial<CostCode> & Pick<CostCode, 'code'>): CostCode => ({
  id: `id_${over.code}`,
  code: over.code,
  description: over.description ?? null,
  division: over.division ?? null,
  code_type: over.code_type ?? null,
  unit_of_measure: over.unit_of_measure ?? 'SF',
  status: over.status ?? 'active',
  sort_order: over.sort_order ?? 0,
  created_by: null,
  created_at: null,
  updated_at: null,
});

describe('normalizeCode', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeCode('  09-2116.001 ')).toBe('09-2116.001');
    expect(normalizeCode('09-2116.001')).toBe('09-2116.001');
    expect(normalizeCode('09  2116')).toBe('09 2116');
  });
});

describe('deriveDivision', () => {
  it('takes the token before the first dash', () => {
    expect(deriveDivision('09-2116.001')).toBe('09');
    expect(deriveDivision('80-8001.001')).toBe('80');
    expect(deriveDivision(' 03-0000.012 ')).toBe('03');
  });
  it('falls back to leading digits when there is no dash', () => {
    expect(deriveDivision('09')).toBe('09');
    expect(deriveDivision('0921160')).toBe('0921160');
  });
  it('returns the whole (normalized) string for non-numeric input', () => {
    expect(deriveDivision('ABC')).toBe('ABC');
  });
});

describe('divisionLabel', () => {
  it('labels known divisions and passes through unknowns', () => {
    expect(divisionLabel('09')).toBe('09 · Finishes');
    expect(divisionLabel('99')).toBe('99');
    expect(divisionLabel('')).toBe('Uncategorized');
    expect(divisionLabel(null)).toBe('Uncategorized');
  });
});

describe('parseCostCodeCatalog', () => {
  it('parses a Markdown pipe table and drops the separator row', () => {
    const text = [
      '| Cost Code | Description | Type | Div |',
      '|---|---|---|---|',
      '| 09-2116.001 | Gypsum Board Assemblies | Subcontract | 09 |',
      '| 23-0000.001 | HVAC | Subcontract | 23 |',
    ].join('\n');
    const drafts = parseCostCodeCatalog(text);
    expect(drafts).toEqual([
      { code: '09-2116.001', description: 'Gypsum Board Assemblies', code_type: 'Subcontract', division: '09' },
      { code: '23-0000.001', description: 'HVAC', code_type: 'Subcontract', division: '23' },
    ]);
  });

  it('parses CSV, maps columns by name regardless of order, honors quotes', () => {
    const text = [
      'Description,Cost Code,Div,Type',
      '"Doors, Frames and Hardware",08-1000.001,08,Material',
    ].join('\n');
    const drafts = parseCostCodeCatalog(text);
    expect(drafts).toEqual([
      { code: '08-1000.001', description: 'Doors, Frames and Hardware', code_type: 'Material', division: '08' },
    ]);
  });

  it('parses TSV', () => {
    const text = 'Cost Code\tDescription\tType\tDiv\n26-0000.001\tElectrical\tSubcontract\t26';
    expect(parseCostCodeCatalog(text)).toEqual([
      { code: '26-0000.001', description: 'Electrical', code_type: 'Subcontract', division: '26' },
    ]);
  });

  it('derives the division from the code when no Div column is present', () => {
    const text = 'Code,Description\n09-6500.001,Resilient Flooring';
    expect(parseCostCodeCatalog(text)).toEqual([
      { code: '09-6500.001', description: 'Resilient Flooring', code_type: null, division: '09' },
    ]);
  });

  it('skips rows without a code and blank-collapses fields to null', () => {
    const text = [
      'Cost Code,Description,Type,Div',
      ',No Code Here,Subcontract,09',
      '22-0000.001,,,22',
    ].join('\n');
    expect(parseCostCodeCatalog(text)).toEqual([
      { code: '22-0000.001', description: null, code_type: null, division: '22' },
    ]);
  });

  it('is idempotent-friendly: de-dupes repeated codes (last wins)', () => {
    const text = [
      'Cost Code,Description,Type,Div',
      '09-2116.001,Old Name,Subcontract,09',
      ' 09-2116.001 ,Gypsum Board Assemblies,Subcontract,09',
    ].join('\n');
    const drafts = parseCostCodeCatalog(text);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].description).toBe('Gypsum Board Assemblies');
    expect(drafts[0].code).toBe('09-2116.001');
  });

  it('returns [] for empty input or a header with no code column', () => {
    expect(parseCostCodeCatalog('')).toEqual([]);
    expect(parseCostCodeCatalog('   ')).toEqual([]);
    expect(parseCostCodeCatalog('Description,Type,Div\nFoo,Subcontract,09')).toEqual([]);
  });
});

describe('filterCostCodesForAdmin', () => {
  const codes = [
    mkCode({ code: '09-2116.001', description: 'Gypsum Board Assemblies', status: 'active' }),
    mkCode({ code: '23-0000.001', description: 'HVAC', status: 'active' }),
    mkCode({ code: '80-8001.001', description: 'TBD', status: 'deprecated' }),
  ];

  it('filters by status', () => {
    expect(filterCostCodesForAdmin(codes, 'active', '')).toHaveLength(2);
    expect(filterCostCodesForAdmin(codes, 'deprecated', '')).toHaveLength(1);
    expect(filterCostCodesForAdmin(codes, 'all', '')).toHaveLength(3);
  });

  it('searches code and description case-insensitively', () => {
    expect(filterCostCodesForAdmin(codes, 'all', 'gypsum')).toHaveLength(1);
    expect(filterCostCodesForAdmin(codes, 'all', '23-0000')).toHaveLength(1);
    expect(filterCostCodesForAdmin(codes, 'all', 'zzz')).toHaveLength(0);
  });
});

describe('groupCostCodesByDivision', () => {
  it('groups by division, orders divisions numerically, and sorts within by sort_order then code', () => {
    const codes = [
      mkCode({ code: '23-0000.001', division: '23', sort_order: 30 }),
      mkCode({ code: '09-6500.001', division: '09', sort_order: 20 }),
      mkCode({ code: '09-2116.001', division: '09', sort_order: 10 }),
    ];
    const grouped = groupCostCodesByDivision(codes);
    expect(grouped.map(g => g.division)).toEqual(['09', '23']);
    expect(grouped[0].label).toBe('09 · Finishes');
    expect(grouped[0].codes.map(c => c.code)).toEqual(['09-2116.001', '09-6500.001']);
  });

  it('sorts unknown/empty divisions last', () => {
    const codes = [
      mkCode({ code: 'X', division: null }),
      mkCode({ code: '01-0000.001', division: '01' }),
    ];
    const grouped = groupCostCodesByDivision(codes);
    expect(grouped[0].division).toBe('01');
    expect(grouped[grouped.length - 1].division).toBe('—');
  });
});
