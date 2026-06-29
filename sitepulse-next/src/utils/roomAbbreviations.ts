/**
 * Architectural-abbreviation expansion for room-name auto-fill (Trace Naming & Type
 * Assist — "smarter naming" follow-up, Item 1). Construction drawings label rooms in
 * terse ALL-CAPS shorthand ("STOR", "CONF", "MECH"); this turns that into a clean,
 * readable name AND a better type signal, because the expanded word ("Storage",
 * "Conference", "Mechanical") matches the live dictionary far more reliably than the
 * abbreviation does.
 *
 * Pure + deterministic (no DB, no React) — the load-bearing behaviour is unit-tested
 * in isolation (AGENTS.md §9). The maps are intentionally CONSERVATIVE (only
 * unambiguous, high-frequency abbreviations) and easily extended.
 */
import { normalizeLocationName, toTitleCaseName } from './workbenchNaming';

/**
 * Normalized abbreviation → its Title-Case expansion. Keys are lower-cased with
 * surrounding punctuation stripped (so "STOR", "Stor." and "stor" all hit "stor").
 * Kept deliberately small + unambiguous: a wrong expansion is worse than none, and
 * the user can still edit. Add entries here as new shorthand shows up on real sheets.
 */
export const ROOM_ABBREVIATIONS: Readonly<Record<string, string>> = Object.freeze({
  stor: 'Storage',
  strg: 'Storage',
  conf: 'Conference',
  mech: 'Mechanical',
  elec: 'Electrical',
  jan: 'Janitor',
  vest: 'Vestibule',
  corr: 'Corridor',
  elev: 'Elevator',
  recep: 'Reception',
  recept: 'Reception',
  restrm: 'Restroom',
  toil: 'Toilet',
  lav: 'Lavatory',
  lndry: 'Laundry',
  util: 'Utility',
  maint: 'Maintenance',
  mtg: 'Meeting',
  kit: 'Kitchen',
  kitch: 'Kitchen',
  gar: 'Garage',
  equip: 'Equipment',
  clos: 'Closet',
  ofc: 'Office',
  offc: 'Office',
  bdrm: 'Bedroom',
  mech_rm: 'Mechanical',
  recv: 'Receiving',
});

/**
 * Normalized tokens that must stay UPPERCASE rather than be Title-Cased — true
 * initialisms that read wrong as words ("MDF" → "Mdf"). Also conservative; extend as
 * needed. Note: these are KEPT, not expanded — "IT" stays "IT", not "Information Tech".
 */
export const ACRONYM_KEEP: ReadonlySet<string> = new Set([
  'mdf',
  'idf',
  'av',
  'it',
  'mep',
  'hvac',
  'ups',
]);

/** Normalize one word to its lookup key (lower-case, strip surrounding punctuation). */
function tokenKey(word: string): string {
  return word.toLowerCase().replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '');
}

/** Expand a single word if it's a known abbreviation; designators are left verbatim. */
function expandWord(word: string): string {
  if (/\d/.test(word)) return word; // a room number / unit designator — never expand
  return ROOM_ABBREVIATIONS[tokenKey(word)] ?? word;
}

/**
 * Turn a raw room label into a clean, human-readable name: expand standard
 * architectural abbreviations ("STOR 101" → "Storage 101"), Title-Case the result,
 * keep room numbers / unit designators verbatim, and keep true acronyms uppercase
 * ("MDF" stays "MDF"). Whitespace is normalized first. Pure + deterministic.
 */
export function expandRoomName(raw: string): string {
  const expanded = normalizeLocationName(raw).split(' ').map(expandWord).join(' ');
  return toTitleCaseName(expanded, ACRONYM_KEEP);
}
