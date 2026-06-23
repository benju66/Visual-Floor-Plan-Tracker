// Pure parser for a Procore "Project Directory" CSV export → Project Contacts.
//
// All Phase-2 import correctness lives here (and is unit-tested in
// procoreDirectoryCsv.test.ts). The component layer only does file reading and
// rendering — pass the file text IN; this module never touches the filesystem
// or the network.
//
// What it handles (see the sample export docs/procore_project_directory_export.csv):
//   - a UTF-8 BOM on the first header cell (stripped before matching),
//   - RFC-4180-ish quoting: fields wrapped in `"`, embedded commas, `""` escapes,
//     and embedded newlines inside a quoted field,
//   - columns mapped by HEADER NAME (not position) — Procore reorders columns,
//   - blank → null + trim, so import stores the SAME shape as manual entry
//     (mirrors cleanContactFields in SettingsMenu.tsx; blank emails stay NULL so
//     they don't collide under the table's UNIQUE(project_id, email)),
//   - skipping rows with no Company (the column is NOT NULL in the table),
//   - ignoring every column we don't map — notably `Trade(s)`, which Procore
//     exports but leaves empty.

import type { ProjectContactFields } from '@/hooks/useProjectQueries';

/**
 * Tokenize CSV text into rows of raw string cells (RFC-4180-ish).
 *
 * Handles quoted fields, embedded commas, `""` → `"` escapes, embedded
 * newlines inside quotes, and either `\n` or `\r\n` row terminators. A trailing
 * newline does not produce a spurious empty row.
 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // an escaped quote
          i += 2;
        } else {
          inQuotes = false; // closing quote
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      if (text[i] === '\n') i += 1; // swallow the LF of a CRLF pair
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }

  // Flush the final field/row unless the text ended exactly on a terminator.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function blankToNull(value: string | undefined): string | null {
  const s = (value ?? '').trim();
  return s === '' ? null : s;
}

// The six columns Phase 2 reads, keyed by their exact Procore header name.
// `procore_id` is deliberately NOT populated here — the plan reserves it for the
// Phase 4 live sync. Everything else in the export (Address, Trade(s), cost
// codes, …) is ignored.
const HEADERS = {
  company: 'Company',
  firstName: 'First Name',
  lastName: 'Last Name',
  jobTitle: 'Job Title',
  mobilePhone: 'Mobile Phone',
  email: 'Email',
} as const;

/**
 * Parse a Procore project-directory CSV export into Project Contact drafts.
 *
 * Returns one entry per data row that has a non-blank Company, with each mapped
 * field trimmed and blank-collapsed to null. The header row is dropped; columns
 * are resolved by name so a reordered export still maps correctly. If the file
 * has no recognizable header or no `Company` column, returns an empty array.
 */
export function parseProcoreDirectoryCsv(text: string): ProjectContactFields[] {
  if (!text) return [];

  // Strip a leading UTF-8 BOM so the first header cell matches `Person/Vendor`.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows = parseCsvRows(clean);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const colIndex = (name: string): number => header.indexOf(name);

  const companyIdx = colIndex(HEADERS.company);
  // Company is NOT NULL in the table; without that column we can produce nothing.
  if (companyIdx === -1) return [];

  const firstIdx = colIndex(HEADERS.firstName);
  const lastIdx = colIndex(HEADERS.lastName);
  const titleIdx = colIndex(HEADERS.jobTitle);
  const mobileIdx = colIndex(HEADERS.mobilePhone);
  const emailIdx = colIndex(HEADERS.email);

  const cellAt = (cells: string[], idx: number): string | undefined =>
    idx >= 0 && idx < cells.length ? cells[idx] : undefined;

  const contacts: ProjectContactFields[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const company = (cellAt(cells, companyIdx) ?? '').trim();
    if (company === '') continue; // skip rows with no Company

    contacts.push({
      company,
      first_name: blankToNull(cellAt(cells, firstIdx)),
      last_name: blankToNull(cellAt(cells, lastIdx)),
      job_title: blankToNull(cellAt(cells, titleIdx)),
      mobile_phone: blankToNull(cellAt(cells, mobileIdx)),
      email: blankToNull(cellAt(cells, emailIdx)),
    });
  }

  return contacts;
}
