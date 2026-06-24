// Pure helper: derive the Look-Ahead "Sub" cell autocomplete palette from a
// project's contact directory (Project Contacts, Phase 3).
//
// All palette-shaping correctness lives here (and is unit-tested in
// contactsToPalette.test.ts). The component layer only renders the result into
// the existing `<datalist id="la-subs">`; this module never touches Supabase, so
// it imports the ProjectContact TYPE only and keeps the vendored Look-Ahead
// module portable (the fetch happens in LookaheadWorkspace, outside src/lookahead).
//
// The cell stays a free-text input that stores a plain string — this only feeds
// the autocomplete suggestions, so free-typing any name (in or out of the list)
// is unaffected.

import type { ProjectContact } from '@/types/domain';

/**
 * Granularity of the derived palette.
 *  - 'company'         → one entry per distinct company. This matches the cell's
 *                        historical "sub code" / company semantics and is the
 *                        shipped default for Phase 3.
 *  - 'company-contact' → one entry per contact, "Company — First Last", falling
 *                        back to the bare company when the contact has no name.
 *                        Built + tested but not wired in; flip the mode at the
 *                        single call site (LookaheadWorkspace) to adopt it.
 */
export type PaletteMode = 'company' | 'company-contact';

export interface ContactsToPaletteOptions {
  mode?: PaletteMode;
}

/**
 * Derive the datalist entries for the Look-Ahead sub cell: trimmed, non-empty,
 * de-duped, and alphabetically sorted (locale-aware). Company is the spine of
 * every entry, so a contact with a blank/whitespace company is skipped.
 */
export function contactsToPalette(
  contacts: ProjectContact[],
  options: ContactsToPaletteOptions = {},
): string[] {
  const mode = options.mode ?? 'company';
  const entries = new Set<string>();

  for (const c of contacts) {
    const company = (c.company ?? '').trim();
    if (!company) continue; // company is required for an entry — skip blanks

    if (mode === 'company') {
      entries.add(company);
      continue;
    }

    // 'company-contact': label per person, falling back to company-only when the
    // contact carries no name (so two name-less rows at one company collapse).
    const name = [c.first_name, c.last_name]
      .map((part) => (part ?? '').trim())
      .filter(Boolean)
      .join(' ');
    entries.add(name ? `${company} — ${name}` : company);
  }

  return Array.from(entries).sort((a, b) => a.localeCompare(b));
}
