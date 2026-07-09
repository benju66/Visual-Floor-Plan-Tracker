# Forecast Coherence — the hero card tells ONE story from ONE band

> A small, display-only tune-up of the Schedule-That-Thinks forecast display,
> surfaced during Band vs Promise P2 review (owner: "the ~wk of Dec 8 headline
> causes distrust — we're likely to finish much sooner"). One focused phase, no
> migration, no math change. Read `AGENTS.md` §3 (extend-never-fork the
> `monteCarloForecast` / `progressAnalytics` layers) before editing.

## The problem (from real data)
The hero card mixed TWO forecast methods that could disagree by months:
- **Headline** = the *median-pace point forecast* (`projectForecastDate`): remaining ÷ median weekly pace.
- **Range + promise** = the *simulation band* (`bandForRollup` → P10/P50/P90).

On bursty / heavily-backfilled pace (Orchard Path: batches of hundreds entered on
one day, many zero-weeks between), the median is a poor summary — the point
forecast flew far past its own confidence range (headline "Dec 8" while the band
said "Jul 30–Sep 24"). Verified against prod: a low median + big burst weeks made
the old headline read **June 2028** where the band midpoint was **mid-Aug**.

## The fix (decisions locked with the owner)
- **A.** Headline the **midpoint (P50)** of the honest range, not the separate median-pace number.
- **B.** **One basis for the whole card** — headline = band P50, "likely …" = band P10–P90, "vs planned · N days late" measured against P50, promise measured against the same band. The headline can never contradict its own range (P10 ≤ P50 ≤ P90 by construction).
- **C.** Scope = **hero card + the per-level Floor Pulse rows** (each row headlines its own band's P50; the "building →" figure uses the same one-basis rule).
- **D.** When recent pace is too thin/erratic to bound, show an honest **"—" + reason** instead of a shaky date (the band's suppression, incl. the erratic-pace censor, now drives the headline).
- **E.** Framing: this makes the card **coherent + trustworthy**, not artificially early. The estimate is still remaining ÷ recorded pace and sharpens as day-to-day logging replaces backfill batches.

## What changed (display-only; no migration, no approval gate)
- **`monteCarloForecast.ts`** — new pure `selectHeroBand(scopeBand, levelBands)` (+ tests): the band twin of `clampProjectForecast`. Mirrors its two rules exactly — (1) a suppressed pooled scope band stays suppressed (never manufacture a finish from one level); (2) only ever clamp LATER to the slowest scoped level's band (by P50). Point-forecast math in `progressAnalytics` untouched; `VARIANCE_COLORS` untouched.
- **`ProjectDashboard.tsx`** — `projectedDate = heroBand.p50` (was the clamped point forecast); `heroBand` = `selectHeroBand(scopeBand, scopedLevelBands)`; `planDelta`, the suppressed captions, and the "pinned to a level's pace" note all key off the one band; tooltip copy reuses `bandMethodSentence()`. Dropped the `clampProjectForecast`/`clampedForecast` usage here (function stays for its own tests).
- **`FloorPulse.tsx`** — `ForecastChip` headlines `band.p50` with the range beneath (honest "—" when suppressed); the "building →" header uses `selectHeroBand` over the pooled building band + level bands.

## Not in scope
- No change to the point-forecast math or any other consumer of it.
- No re-basing of the promise line (already band-based from P2).

## Verification (exit gate)
- `typecheck` + `test` (incl. new `selectHeroBand` tests) + `build` green.
- Render-harness (scratch, deleted): on bursty pace the old headline = June 2028, the new = "~wk of Aug 13 · likely Jul 23–Sep 17" (inside its range); Floor Pulse rows + header headline the midpoint. Confirm live on dev:3010 on Orchard Path.
- Close with **verify-feature** → STOP. Commit after owner review; do not push until "Approved".
