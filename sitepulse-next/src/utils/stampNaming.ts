// Stamp & Fast Markup — Phase 3. Pure naming helpers shared by BOTH stamp paths:
// the instant drop AND the opt-in "name each stamp" flow. Extracting the index math
// here guarantees an Enter-through in the naming popover pre-fills the SAME
// "{base} (Stamp N)" name the instant drop would have produced. Framework-free +
// deterministic (no `Date`, no I/O) so it's unit-tested in isolation (AGENTS §9).

/**
 * Strip a trailing " (Stamp N)" suffix off a location name, returning the base.
 * `"Office (Stamp 3)"` → `"Office"`; `"Office"` → `"Office"`. Same regex the
 * instant-stamp path used, so re-stamping an already-stamped room re-derives its
 * base rather than compounding the suffix.
 */
export function stampBaseName(name: string): string {
  const match = name.match(/^(.*?)(?:\s*\(Stamp\s*(\d+)\))?$/);
  return match ? match[1].trim() : name;
}

/**
 * The next `"{base} (Stamp N)"` name given the names already on the sheet: N is one
 * past the highest existing `(Stamp N)` index for this exact base (1 when there are
 * none). Identical index math to the instant path so both routes agree.
 */
export function nextStampName(baseName: string, existingNames: readonly string[]): string {
  let nextIndex = 1;
  for (const name of existingNames) {
    if (name.startsWith(`${baseName} (Stamp`)) {
      const match = name.match(/\(Stamp\s*(\d+)\)$/);
      if (match) {
        const idx = parseInt(match[1]);
        if (idx >= nextIndex) nextIndex = idx + 1;
      }
    }
  }
  return `${baseName} (Stamp ${nextIndex})`;
}
