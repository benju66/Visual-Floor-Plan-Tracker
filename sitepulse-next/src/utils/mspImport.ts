// Pure parser for a Microsoft Project MSPDI `.xml` export → typed schedule tasks.
//
// Mirrors `procoreDirectoryCsv.ts` (the tested pure-import-parser pattern): pass the
// file TEXT in; this module never touches the filesystem, the network, or the clock.
// The component layer (MspImportPanel) only does file reading and rendering; the
// task→activity matching + date subdivision live in `scheduleReconcile.ts`.
//
// What it handles (see the real sample docs/Schdules/real_project_schedule.xml):
//   - the MSPDI default namespace (tag names are unprefixed, so tag lookup works),
//   - `<IsNull>1</IsNull>` blank spacer tasks (dropped — MS Project exports them
//     for empty grid rows) and `<Active>0</Active>` deactivated tasks (dropped),
//   - summary vs leaf tasks (`<Summary>`) and zero-duration milestone markers
//     (`<Milestone>`),
//   - the outline hierarchy: each task carries the NAMES of its ancestor summary
//     tasks (`path`), derived from document order + `<OutlineLevel>` — the level
//     ("LEVEL 4 FINISHES …") a leaf task sits under is how the reconciler suggests
//     a target sheet,
//   - timestamps like `2025-05-01T07:00:00` → day-only 'YYYY-MM-DD' strings (the
//     same date-only convention as ganttMath / progressAnalytics).
//
// P6 `.xer` / binary `.mpp` are out of scope — MSPDI `.xml` only.

export interface MspTask {
  /** MS Project's stable task UID (unique within the file). */
  uid: string;
  name: string;
  /** 'YYYY-MM-DD' (the date part of the MSPDI timestamp) or null when absent. */
  start: string | null;
  finish: string | null;
  outlineLevel: number;
  wbs: string | null;
  /** Zero-duration milestone marker (`<Milestone>1`). */
  isMilestone: boolean;
  /** Summary (parent) task — never imported directly; leaf tasks carry the dates. */
  isSummary: boolean;
  /** Names of the ancestor summary tasks, outermost first (excludes this task). */
  path: string[];
}

export type MspParseResult =
  | { ok: true; projectName: string | null; tasks: MspTask[] }
  | { ok: false; error: string };

/** Text of a DIRECT child element (descendant search would leak into `<PredecessorLink>` etc.). */
function childText(el: Element, tag: string): string | null {
  for (let i = 0; i < el.children.length; i++) {
    const c = el.children[i];
    if (c.tagName === tag) return c.textContent;
  }
  return null;
}

/** MSPDI timestamp ('2025-05-01T07:00:00') → 'YYYY-MM-DD', or null when missing/malformed. */
function toDayOnly(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, 10) : null;
}

/**
 * Parse an MSPDI `.xml` string into ordered {@link MspTask}s (summaries included,
 * flagged; spacer/inactive tasks dropped). Returns a discriminated result rather
 * than throwing so the UI can show the message verbatim. Pure and deterministic —
 * no I/O, no `Date.now()`.
 */
export function parseMspXml(xmlText: string): MspParseResult {
  if (!xmlText || !xmlText.trim()) {
    return { ok: false, error: 'The file is empty.' };
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  } catch {
    return { ok: false, error: 'Could not read the file as XML.' };
  }
  // Browsers (and jsdom) report XML syntax errors as an embedded <parsererror>.
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return { ok: false, error: 'Not valid XML — export the schedule from Microsoft Project via Save As → XML (MSPDI).' };
  }
  const root = doc.documentElement;
  if (!root || root.tagName !== 'Project') {
    return { ok: false, error: 'Not an MS Project XML file — the root element is not <Project>.' };
  }

  const projectName = childText(root, 'Title') || childText(root, 'Name') || null;

  const tasks: MspTask[] = [];
  // Ancestor summary stack, maintained across document order via OutlineLevel.
  const stack: { name: string; level: number }[] = [];

  const taskEls = doc.getElementsByTagName('Task');
  for (let i = 0; i < taskEls.length; i++) {
    const el = taskEls[i];
    if (childText(el, 'IsNull') === '1') continue; // blank spacer row
    if (childText(el, 'Active') === '0') continue; // deactivated task
    const name = (childText(el, 'Name') || '').trim();
    if (!name) continue;

    const outlineLevel = parseInt(childText(el, 'OutlineLevel') || '0', 10) || 0;
    const isSummary = childText(el, 'Summary') === '1';

    while (stack.length > 0 && stack[stack.length - 1].level >= outlineLevel) stack.pop();
    const path = stack.map((s) => s.name);
    if (isSummary) stack.push({ name, level: outlineLevel });

    tasks.push({
      uid: (childText(el, 'UID') || '').trim(),
      name,
      start: toDayOnly(childText(el, 'Start')),
      finish: toDayOnly(childText(el, 'Finish')),
      outlineLevel,
      wbs: childText(el, 'WBS'),
      isMilestone: childText(el, 'Milestone') === '1',
      isSummary,
      path,
    });
  }

  if (tasks.length === 0) {
    return { ok: false, error: 'The file parsed but contains no tasks.' };
  }
  return { ok: true, projectName, tasks };
}

/** The importable rows: leaf tasks only (summaries are context, not work). */
export function leafTasks(tasks: MspTask[]): MspTask[] {
  return tasks.filter((t) => !t.isSummary);
}
