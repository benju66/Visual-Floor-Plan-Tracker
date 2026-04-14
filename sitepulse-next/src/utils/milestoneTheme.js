import { MILESTONES } from './constants';

/** Resolved fill for Konva / Supabase (reads CSS variable from :root). */
export function resolveMilestoneColorById(id) {
  if (typeof document === 'undefined') return 'rgba(128, 128, 128, 0.35)';
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--milestone-${id}`)
    .trim();
  return raw || 'rgba(128, 128, 128, 0.35)';
}

export function resolveMilestoneColorByName(name) {
  const m = MILESTONES.find((x) => x.name === name);
  return m ? resolveMilestoneColorById(m.id) : 'rgba(0, 0, 0, 0.2)';
}

/** For UI swatches using CSS variables directly */
export function milestoneCssVar(id) {
  return `var(--milestone-${id})`;
}
