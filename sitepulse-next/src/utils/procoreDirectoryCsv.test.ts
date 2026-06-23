import { describe, it, expect } from 'vitest';
import { parseProcoreDirectoryCsv } from './procoreDirectoryCsv';

// The exact Procore export header (22 columns). `Trade(s)` is present but empty
// in real exports; the parser must not rely on it.
const HEADER =
  'Person/Vendor,Id,First Name,Last Name,Company,Job Title,Country,Address,City,State,Zip,Business Phone,Mobile Phone,Fax Number,Email,Tags/Keywords,Project Roles,Trade(s),Permission Template,Standard Cost Code List,Old Sage 100 Contractor Standard Cost Codes,Sage 100 Contractor Standard Cost Codes';

// Build a full 22-column data row from a sparse override map, so tests only
// specify the columns they care about.
function row(overrides: Partial<Record<string, string>>): string {
  const cols = [
    'Person', // Person/Vendor
    '12345', // Id
    overrides.firstName ?? '',
    overrides.lastName ?? '',
    overrides.company ?? '',
    overrides.jobTitle ?? '',
    'United States', // Country
    overrides.address ?? '',
    'Minneapolis', // City
    'Minnesota', // State
    '55416', // Zip
    overrides.businessPhone ?? '', // Business Phone
    overrides.mobilePhone ?? '', // Mobile Phone
    '', // Fax Number
    overrides.email ?? '',
    '', // Tags/Keywords
    '', // Project Roles
    overrides.trade ?? '', // Trade(s)
    '', // Permission Template
    '', // Standard Cost Code List
    '', // Old Sage 100 ...
    '', // Sage 100 ...
  ];
  // Quote any cell containing a comma or quote, per RFC-4180.
  return cols
    .map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
    .join(',');
}

function csv(...dataRows: string[]): string {
  return [HEADER, ...dataRows].join('\n');
}

describe('parseProcoreDirectoryCsv', () => {
  it('maps the six fields and drops the header row', () => {
    const text = csv(
      row({
        firstName: 'Dani',
        lastName: 'Ajer',
        company: 'County Materials',
        jobTitle: 'Deliveries',
        mobilePhone: '(715) 660-8503',
        email: 'dani.ajer@countymaterials.com',
      })
    );
    const contacts = parseProcoreDirectoryCsv(text);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toEqual({
      company: 'County Materials',
      first_name: 'Dani',
      last_name: 'Ajer',
      job_title: 'Deliveries',
      mobile_phone: '(715) 660-8503',
      email: 'dani.ajer@countymaterials.com',
    });
  });

  it('handles a quoted company name containing a comma', () => {
    const text = csv(
      row({ firstName: 'Stacy', lastName: 'Alama', company: 'Acme Drywall, Inc.', email: 's@acme.com' })
    );
    const contacts = parseProcoreDirectoryCsv(text);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].company).toBe('Acme Drywall, Inc.');
    expect(contacts[0].email).toBe('s@acme.com');
  });

  it('unescapes a "" escaped quote inside a quoted field', () => {
    const text = csv(row({ company: '7" Studios, LLC', email: 'hi@7studios.com' }));
    const contacts = parseProcoreDirectoryCsv(text);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].company).toBe('7" Studios, LLC');
  });

  it('strips a UTF-8 BOM on the header so columns still resolve', () => {
    const text = '﻿' + csv(row({ company: 'BOM Co', email: 'a@bom.co' }));
    const contacts = parseProcoreDirectoryCsv(text);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].company).toBe('BOM Co');
    expect(contacts[0].email).toBe('a@bom.co');
  });

  it('maps a missing email to null (so blank emails stay NULL, not "")', () => {
    const text = csv(row({ company: 'No Email Co', firstName: 'Pat', email: '' }));
    const contacts = parseProcoreDirectoryCsv(text);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].email).toBeNull();
    expect(contacts[0].first_name).toBe('Pat');
  });

  it('collapses every blank optional field to null and trims values', () => {
    const text = csv(row({ company: '  Trim Co  ', firstName: '  Jo  ', lastName: '', jobTitle: '   ' }));
    const contacts = parseProcoreDirectoryCsv(text);
    expect(contacts[0]).toEqual({
      company: 'Trim Co',
      first_name: 'Jo',
      last_name: null,
      job_title: null,
      mobile_phone: null,
      email: null,
    });
  });

  it('ignores the Trade(s) column entirely', () => {
    const text = csv(row({ company: 'Trade Co', trade: 'Electrical', email: 't@trade.co' }));
    const contacts = parseProcoreDirectoryCsv(text);
    expect(contacts).toHaveLength(1);
    // The trade value must not leak into any mapped field.
    expect(JSON.stringify(contacts[0])).not.toContain('Electrical');
  });

  it('skips rows with no Company (the column is NOT NULL)', () => {
    const text = csv(
      row({ company: 'Has Co', email: 'a@a.com' }),
      row({ company: '', firstName: 'Orphan', email: 'b@b.com' }),
      row({ company: '   ', firstName: 'Whitespace', email: 'c@c.com' })
    );
    const contacts = parseProcoreDirectoryCsv(text);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].company).toBe('Has Co');
  });

  it('resolves columns by header name even when the export reorders them', () => {
    // Email before Company, Company before First Name — positions all moved.
    const reordered = 'Email,Company,First Name,Last Name,Job Title,Mobile Phone';
    const text = [reordered, 'x@y.com,Reorder Co,Sam,Lee,PM,(555) 111-2222'].join('\n');
    const contacts = parseProcoreDirectoryCsv(text);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toEqual({
      company: 'Reorder Co',
      first_name: 'Sam',
      last_name: 'Lee',
      job_title: 'PM',
      mobile_phone: '(555) 111-2222',
      email: 'x@y.com',
    });
  });

  it('handles CRLF line endings and a trailing newline without a spurious row', () => {
    const text = [HEADER, row({ company: 'CRLF Co', email: 'a@a.com' }), ''].join('\r\n');
    const contacts = parseProcoreDirectoryCsv(text);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].company).toBe('CRLF Co');
  });

  it('returns [] for empty input or a file with no Company column', () => {
    expect(parseProcoreDirectoryCsv('')).toEqual([]);
    expect(parseProcoreDirectoryCsv('First Name,Last Name,Email\na,b,c@d.com')).toEqual([]);
  });
});
