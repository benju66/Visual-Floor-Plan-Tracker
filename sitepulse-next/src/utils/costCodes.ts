// Pure logic for the global cost-code catalog (Scheduling Analytics Slice B, Phase 5).
//
// Framework-free + deterministic — all import/normalize/group correctness lives here
// and is unit-tested in costCodes.test.ts. The component + hook layers only read files
// and call Supabase; they pass text/rows IN. Never touch the filesystem or network here,
// and never call Date.now().
//
// Mirrors the pattern of src/utils/subtypes.ts (admin filter/group helpers) and the
// CSV tokenizer shape from src/utils/procoreDirectoryCsv.ts.

import type { CostCode, CostCodeStatus } from '@/types/domain';

/** A parsed catalog row before it becomes a `cost_codes` insert (id/status/UoM defaulted by the DB). */
export interface CostCodeDraft {
  code: string;
  description: string | null;
  code_type: string | null;
  division: string | null;
}

/** The MasterFormat division-number → label legend (docs/estimate-cost-codes-catalog.md). */
export const COST_CODE_DIVISIONS: Record<string, string> = {
  '01': 'General Requirements',
  '02': 'Existing Conditions',
  '03': 'Concrete',
  '04': 'Masonry',
  '05': 'Metals',
  '06': 'Wood/Plastics/Composites',
  '07': 'Thermal & Moisture',
  '08': 'Openings',
  '09': 'Finishes',
  '10': 'Specialties',
  '11': 'Equipment',
  '12': 'Furnishings',
  '13': 'Special Construction',
  '14': 'Conveying',
  '21': 'Fire Suppression',
  '22': 'Plumbing',
  '23': 'HVAC',
  '26': 'Electrical',
  '27': 'Communications',
  '28': 'Electronic Safety/Security',
  '31': 'Earthwork',
  '32': 'Exterior Improvements',
  '33': 'Utilities',
  '50': 'Winter Conditions',
  '80': 'TBD',
};

/** A human label for a division number ("09" → "09 · Finishes"); unknowns fall back to the raw number. */
export function divisionLabel(division: string | null | undefined): string {
  const d = (division ?? '').trim();
  if (!d) return 'Uncategorized';
  const name = COST_CODE_DIVISIONS[d];
  return name ? `${d} · ${name}` : d;
}

/**
 * Canonicalize a code string for storage + de-dupe: trim and collapse internal
 * whitespace. Codes are numeric/punctuation (e.g. "09-2116.001") so there is no case
 * to fold, but this guarantees the plain UNIQUE(code) constraint + onConflict upsert
 * never splits "  09-2116.001 " from "09-2116.001".
 */
export function normalizeCode(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Derive the 2-digit MasterFormat division from a code ("09-2116.001" → "09"). */
export function deriveDivision(code: string): string {
  const c = normalizeCode(code);
  const dash = c.indexOf('-');
  if (dash > 0) return c.slice(0, dash).trim();
  // No dash: fall back to the leading run of digits (e.g. "09..." → "09").
  const digits = c.match(/^\d+/);
  return digits ? digits[0] : c;
}

function blankToNull(value: string | undefined | null): string | null {
  const s = (value ?? '').trim();
  return s === '' ? null : s;
}

/**
 * Tokenize a delimited row line, honoring RFC-4180-ish double-quote quoting for the
 * given single-char delimiter. Used per-line (embedded newlines inside quotes are not
 * supported — the catalog has none, and paste flows are line-oriented).
 */
function splitDelimited(line: string, delim: string): string[] {
  const cells: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      cells.push(field); field = '';
    } else field += ch;
  }
  cells.push(field);
  return cells;
}

// Column header synonyms → the draft field they map to (matched case-insensitively).
const HEADER_ALIASES: Record<string, keyof CostCodeDraft> = {
  'cost code': 'code',
  'code': 'code',
  'description': 'description',
  'desc': 'description',
  'type': 'code_type',
  'code type': 'code_type',
  'div': 'division',
  'division': 'division',
};

/**
 * Parse a pasted/uploaded cost-code catalog into drafts. Accepts three shapes so a
 * user can paste the catalog doc verbatim OR a spreadsheet export:
 *   - a Markdown pipe table (`| Cost Code | Description | Type | Div |`), separator
 *     rows (`|---|`) dropped;
 *   - CSV (comma) or TSV (tab), quotes honored.
 * The delimiter is auto-detected from the header line; columns map BY NAME (reordering
 * is fine). Rows with no code are skipped; each field is trimmed + blank→null; codes are
 * normalized and de-duped (last occurrence wins). If a `Div` column is absent, the
 * division is derived from the code. Returns [] when there is no recognizable header.
 */
export function parseCostCodeCatalog(text: string): CostCodeDraft[] {
  if (!text || !text.trim()) return [];
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rawLines = clean.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (rawLines.length === 0) return [];

  const isPipe = rawLines[0].includes('|');
  const delim = isPipe ? '|' : rawLines[0].includes('\t') ? '\t' : ',';

  const rowToCells = (line: string): string[] => {
    if (isPipe) {
      // Drop the leading/trailing pipe framing before splitting.
      let l = line;
      if (l.startsWith('|')) l = l.slice(1);
      if (l.endsWith('|')) l = l.slice(0, -1);
      return l.split('|').map(c => c.trim());
    }
    return splitDelimited(line, delim).map(c => c.trim());
  };

  // A Markdown separator row (---|:--:|---) carries no data.
  const isSeparatorRow = (cells: string[]): boolean =>
    cells.length > 0 && cells.every(c => /^:?-{2,}:?$/.test(c) || c === '');

  const header = rowToCells(rawLines[0]).map(h => h.toLowerCase());
  const colOf = (field: keyof CostCodeDraft): number =>
    header.findIndex(h => HEADER_ALIASES[h] === field);

  const codeIdx = colOf('code');
  if (codeIdx === -1) return []; // no code column → nothing we can trust

  const descIdx = colOf('description');
  const typeIdx = colOf('code_type');
  const divIdx = colOf('division');

  const at = (cells: string[], idx: number): string | undefined =>
    idx >= 0 && idx < cells.length ? cells[idx] : undefined;

  const byCode = new Map<string, CostCodeDraft>();
  for (let r = 1; r < rawLines.length; r++) {
    const cells = rowToCells(rawLines[r]);
    if (isSeparatorRow(cells)) continue;
    const code = normalizeCode(at(cells, codeIdx) ?? '');
    if (!code) continue;
    const division = blankToNull(at(cells, divIdx)) ?? deriveDivision(code);
    byCode.set(code.toLowerCase(), {
      code,
      description: blankToNull(at(cells, descIdx)),
      code_type: blankToNull(at(cells, typeIdx)),
      division,
    });
  }
  return [...byCode.values()];
}

// ── Admin filter / group helpers (mirror subtypes.ts) ────────────────────────────

export type CostCodeStatusFilter = 'all' | CostCodeStatus;

/** Filter the catalog for the manager UI by status + a case-insensitive code/description search. */
export function filterCostCodesForAdmin(
  codes: CostCode[],
  statusFilter: CostCodeStatusFilter,
  search: string,
): CostCode[] {
  const q = search.trim().toLowerCase();
  return codes.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (!q) return true;
    return (
      c.code.toLowerCase().includes(q) ||
      (c.description ?? '').toLowerCase().includes(q)
    );
  });
}

/**
 * Group codes by division into an ordered list (division number ascending, then by
 * sort_order/code within). Divisions in the known legend sort by their numeric key;
 * anything else sorts last, alphabetically.
 */
export function groupCostCodesByDivision(
  codes: CostCode[],
): { division: string; label: string; codes: CostCode[] }[] {
  const groups = new Map<string, CostCode[]>();
  for (const c of codes) {
    const key = (c.division ?? '').trim() || '—';
    const list = groups.get(key);
    if (list) list.push(c); else groups.set(key, [c]);
  }
  const divisionRank = (d: string): number => {
    const n = Number(d);
    return Number.isFinite(n) && d !== '—' ? n : Number.MAX_SAFE_INTEGER;
  };
  return [...groups.entries()]
    .sort((a, b) => {
      const ra = divisionRank(a[0]);
      const rb = divisionRank(b[0]);
      return ra !== rb ? ra - rb : a[0].localeCompare(b[0]);
    })
    .map(([division, list]) => ({
      division,
      label: divisionLabel(division),
      codes: list.sort((x, y) => (x.sort_order - y.sort_order) || x.code.localeCompare(y.code)),
    }));
}
