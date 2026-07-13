# SitePulse — Application Math Reference

A catalog of every meaningful computation in the SitePulse frontend (`sitepulse-next`): what each formula is, where it lives, what it does, and which part of the UI/UX it drives. Grouped by domain. All of it lives in pure, unit-tested modules under `src/utils/` (the components/hooks only fetch data and render).

> **Scope:** the frontend domain math. The FastAPI backend's only math is PDF→PNG rasterization (`fitz.Matrix(4.0, 4.0)` = 288 DPI) and PyMuPDF vector extraction into percent-normalized line data; that basis is referenced below where the scale math depends on it.

---

## 0. Conventions & shared primitives

Five conventions run through everything:

- **Dates are `'YYYY-MM-DD'` strings, parsed at UTC noon.** `parseDay(d)` (`progressAnalytics.ts`) does `Date.parse(\`${d}T12:00:00Z\`)`; `dayDiff(from, to) = round((to − from) / 86_400_000)`. UTC-noon parsing makes whole-day arithmetic timezone-stable (no off-by-one at DST or across zones). `DAY_MS = 86_400_000`.
- **Determinism — no `Date.now()`, no `Math.random()`.** Every function takes `today` (and any seed) as a parameter. This is what lets the whole math layer be unit-tested and lets the dashboard show stable numbers across re-renders.
- **Honesty / suppression over fabrication.** When there isn't enough signal, functions return `null` / a typed `suppressed` reason rather than a made-up number. A suppressed point forecast never gains a confidence band; a promise line never renders without a real date.
- **Extend, never fork.** The forecast/band/rate/baseline modules all import `parseDay`/`dayDiff`/`summarizeGroup`/`projectForecastDate` rather than re-implementing them — one source of truth per calculation (AGENTS.md §3).
- **Percent space + aspect correction (canvas).** Canvas geometry is in normalized `pctX`/`pctY` ∈ [0,1]. Percent space is anisotropic (the sheet isn't square), so distance math divides Y by `aspect = drawW / drawH` to restore true proportions; area/length math converts pct → base-image pixels first.

**Applicability (N/A) is a denominator gate everywhere.** `isActivityApplicable(activity, unit, index)` decides whether a (unit × activity) slot counts at all. Every rollup, rate, forecast, and bottleneck excludes N/A slots so they never inflate a total or become a false bottleneck.

---

## A. Schedule Variance & Pace Analytics — `progressAnalytics.ts`

The single source of truth for "are we behind, and by how much." Consumed by Map **Lag Mode**, the List's variance columns, the Unit **Journey** timeline, and the dashboard's **Floor Pulse** / **Type Scorecard**.

### `parseDay` / `dayDiff` / `mondayOf`
`mondayOf(d)` returns the ISO Monday of `d`'s week (UTC, Mon-start) — the shared weekly bucket boundary for all pace math. → **UI:** underpins every weekly count / sparkline.

### `computeUnitVariance(unitLogs, trackActivities, today) → VarianceInfo`
Finds a unit's **bottleneck** (first incomplete activity in sequence order) and classifies it:
```
plannedEnd && today > plannedEnd   → { kind:'behind',  days: dayDiff(plannedEnd, today) }
plannedStart && today < plannedStart → { kind:'ahead', days: dayDiff(today, plannedStart) }
plannedStart||plannedEnd           → 'onpace'
no dates, started                  → 'noplan' (idleDays since last activity)
no dates, not started              → 'notstarted'
all complete                       → 'complete'
```
→ **UI:** the per-location "12d late / 3d early" chip in the List; Map Lag Mode polygon color; the days-behind number.

### `activitySchedule({plannedStart, plannedEnd, actualStart, actualEnd}) → metrics`
The per-activity schedule story as signed whole days, each field **null-propagating** (a missing input → `null`, never a misleading `0`):
```
plannedDuration = dayDiff(pStart, pEnd)
actualDuration  = dayDiff(aStart, aEnd)      // counts to today while ongoing
varianceStart   = dayDiff(pStart, aStart)    // + = started late
varianceCompleted = dayDiff(pEnd, aEnd)      // + = finished late
varianceDuration  = actualDuration − plannedDuration   // + = ran long
```
→ **UI:** the List's **Planned/Actual Duration** and **Start Var. / Finish Var. / Duration Var.** columns (`StatusTable`).

### `resolveActualStartIso(events, {enteredStart})` / `firstOngoingIso(rows)`
The trusted "actual start": a **typed `actual_start_date` wins**, else the first genuine `ongoing` audit event's capture timestamp, else `null` (blank — never guess the completion day). → **UI:** Actual Start column + all start-variance numbers. (This is the exact reliability seam behind the deferred "actual-start lag" radar.)

### `summarizeGroup(...) → GroupRollup`
The big per-scope rollup (per sheet / per unit-type): counts applicable/completed/ongoing slots, `completionPct`, `plannedByTodayPct`, `plannedCoverage`, mean `avgBehindDays`, stalled units, an 8-week completion series (`weekly`), `paceThisWeek`, `trailingAvg`, and the forecast. Thresholds:
```
STALL_THRESHOLD_DAYS = 14   SMALL_SAMPLE_SLOTS = 12
FORECAST_WINDOW_WEEKS = 6   PLAN_TICK_MIN_COVERAGE = 0.5
```
→ **UI:** Floor Pulse rows, Type Scorecard, the plan-tick on the completion bar.

### `projectForecastDate({remaining, totalSlots, fullWeekCounts, today})`
Median-pace finish projection with honest suppression:
```
remaining ≤ 0            → suppressed 'complete'
totalSlots < 12          → suppressed 'small-sample'
median(last 6 full weeks) ≤ 0 → suppressed 'no-pace'
else finish = today + ceil((remaining / median) * 7) days
```
→ **UI:** the "Projected finish" date on Floor Pulse and the hero card. Reused (never forked) by the confidence band and the forecast-slip trend.

### Presentation helpers
- `planVsProjected(planned, projected)` — signed days the projection lands after the plan. → hero "vs planned" line.
- `scopePlannedFinish(statuses, track)` — the latest `planned_end_date` across a scope (string max). → the plan date the hero measures against; also the baseline drift's current-finish input.
- `clampProjectForecast(heroForecast, levelForecasts)` — an all-levels forecast can never finish **before** its slowest level; only ever pushes later. → keeps the hero date honest against its levels.
- `isStalledSwarm(stalled, tracked, 0.6)` — ≥60% stalled collapses per-level chips into one "data may be stale" banner.

### Variance → color (`VARIANCE_COLORS`, `varianceFill`, `varianceCompletedColor`, `varianceLabel`)
The lag palette (never hardcode elsewhere): `ahead` blue, `onpace` slate, then a **behind severity ramp** — `1–3d` amber-400 → `4–7d` amber-500 → `8–14d` orange-600 → `15+d` red-600; `complete` emerald. `varianceCompletedColor(days)`: late rides the ramp, early = emerald, 0 = slate. → **UI:** Lag Mode legend + fills, List variance cells, the P4 "vs baseline" flag color.

---

## B. Forecast Confidence Bands & Risk — `monteCarloForecast.ts`

An **additive** uncertainty layer around the point forecast (never replaces it). This is a **bootstrap Monte Carlo**: resample the project's own recent weekly pace many times and read the spread off the results.

### `mulberry32(seed)` + `percentileOf(sorted, p)` + `weeksToDate(weeks, today)`
A tiny **seeded** PRNG (deterministic stream in [0,1)), nearest-rank percentile, and the same `today + ceil(weeks*7)` day math the point forecast uses. `FORECAST_BAND_SEED = 20260707` is the one app-wide seed so the hero and Floor Pulse never disagree.

### `simulateFinishBand({remaining, totalSlots, fullWeekCounts, today, seed}) → ForecastBand`
```
for 1000 iterations:                 // BAND_ITERATIONS
  draw weekly counts from the last 6 weeks WITH REPLACEMENT
  until `remaining` slots are done → record weeks-to-finish
p10 / p50 / p90 = 10th / 50th / 90th percentile weeks → dates
```
Suppression parity: it **delegates** the base decision to `projectForecastDate`, so it suppresses in exactly the same complete / small-sample / no-pace cases; plus, if >10% of iterations never finish (`CENSOR_SUPPRESS_FRACTION`), the pace is too erratic → suppress `'no-pace'`. → **UI:** the hero "Planned vs Projected" card's **80% range** ("likely May 14–29") and the Floor Pulse row ranges; tooltip quotes `bandMethodSentence()`.

### `bandForRollup(rollup, today, seed)` / `selectHeroBand(scopeBand, levelBands)`
`bandForRollup` adapts a `GroupRollup` into a band. `selectHeroBand` is the band twin of `clampProjectForecast`: the hero projects from the pooled scope band **clamped later** to its slowest scoped level (by P50), and a suppressed pooled band stays suppressed. → **UI:** guarantees the hero card headlines one coherent band — its P50 is the projected date, its P10–P90 the range, and the promise is measured against the same band (Forecast Coherence).

### `activityRisk({...}) → ActivityRisk[]` (the Risk Radar)
Per activity, builds its own band (history filtered to that activity's completions) and ranks by risk:
```
with plan + dated band → riskDays = dayDiff(plannedFinish, band.p90)  // + = 80% range ends past plan
no plan → riskDays = band width (p10→p90)
suppressed band → riskDays null (listed, never fake-ranked)
sort worst-first
```
→ **UI:** the dashboard **Risk Radar** module ("which activities threaten the finish"), with the thin-history ones listed as "not enough history yet."

### `bestPaceMove({levelRollups, today, seed}) → PaceMoveResult`
Searches every (recipient, donor) level pair: transplant the donor's recent weekly pace onto the recipient's backlog, re-simulate, and measure how many days the **project** P50 (= its slowest level) pulls in. `MIN_MOVE_DAYS = 2`. Returns `evaluated:false` when <2 comparable levels (stay silent) vs `move:null, evaluated:true` (compared, nothing helps → honest "no meaningful move"). → **UI:** the Risk Radar's single "if Level 3 matched Level 5's pace, finish moves up ~N days" suggestion.

### `promiseOutlook({promise, band}) → PromiseOutlook | null` (Band vs Promise)
```
null when: no promise date, band suppressed, or band undated
verdict: promise ≥ p90 → 'on-track'
         promise ≤ p10 → 'likely-miss'
         else          → 'at-risk'
medianDeltaDays = dayDiff(promise, p50)   // + = median finish past the promise (late)
```
→ **UI:** the hero card's "vs promised {date} · {verdict} · ~N days past" line.

### Forecast slip — `forecastTrend.ts`
`forecastTrend({totalSlots, completions, today})` **replays** `projectForecastDate` as-of the last 8 weekly vantage points (completed-as-of each vantage = slots whose earliest completion ≤ that date), and `forecastSlipDays(points)` = the net days the projected finish drifted between the first and last dated vantage. → **UI:** the "is our finish date sliding later?" trend line.

---

## C. Production Rates, Required Rate & Benchmarking

### `productionRates.ts`
Turns dated completions into a **rate**, measured two ways (`ProductionMeasure`): `'locations'` (count/week — needs no scale) or `'sf'` (square feet/week from `computed_area` — excludes area-less locations; "SF can't be faked").
- `completedAreaEvents(...)` — dedupes to the **earliest** completion per slot (append-only re-completions never double-count), drops N/A and (in SF mode) area-less.
- `rateForEvents(events, measure)`:
  ```
  total = Σ (measure==='sf' ? sqFt : 1)
  spanDays = dayDiff(firstDate, lastDate)
  perWeek = total / (spanDays / 7)
  suppressed 'tiny-sample' when eventCount < MIN_RATE_EVENTS(3); 'zero-span' when spanDays ≤ 0
  ```
- `productionRateBy(events, 'costCodeId'|'subId'|'activityId')` — rolled up per axis, sorted biggest-scope first.
- `openAreaSlots` / `remainingBy` — the not-yet-done backlog + its latest planned deadline per axis.
→ **UI:** the Production Rates panel ("8 apartments/week", "1,240 SF/week") per cost code / subcontractor / activity, with sparklines.

### `requiredRate.ts` — "are we on pace?"
```
requiredRate(remaining, today, targetDate) = remaining / (daysLeft / 7)   // null if no future deadline
paceGap: ratio = actual/required; extraCrews = ceil(required/actual) − 1   // models current pace as ~1 crew
assessPace(...) → status ∈ complete|no-target|no-pace|overdue|ahead|on-pace|behind, forecastDate, daysLate, extraCrews
```
→ **UI:** the "~N weeks late at this pace — needs +M crews" action line per cost code / sub.

### `benchmark.ts` — private cross-project comparison
Reuses the single-project pipeline (`completedAreaEvents` + `rateForEvents`) **per project** across only the tenant's own RLS-scoped jobs: `benchmarkRates(ds, axis, key)` = a sub/cost-code's SF-or-locations/week on each job (fastest first, suppressed rows sink); `benchmarkAverageRate` = simple mean of published rates. → **UI:** the "how did this sub perform across my projects?" benchmarking module (private by construction — never pools across customers).

---

## D. Schedule Engine — Cascade, Subdivision, Date-Ripple & Import

### Gantt geometry & row model — `ganttMath.ts`
- `ZOOM_PX_PER_DAY = {day:28, week:12, month:4}`; `dateToX`/`xToDate`/`snapToDay` map dates ↔ pixels (bars land on day boundaries); `barRect(start,end,...)` = `{x, width:(dayDiff(lo,hi)+1)*pxPerDay}` (inclusive end so a same-day bar is one day wide).
- `windowBounds(dates, today, {padDays:7, minSpanDays:28})` — the padded visible date window; `axisTicks(...)` — day/week/month gridlines & labels.
- `deriveDuration(start,end) = |dayDiff| + 1` — the **inclusive** day count shown beside date inputs (duration is never stored; end − start *is* the duration).
- `checkDependencies(bars)` — flags a later activity (by sequence) starting before an earlier one's planned end.
→ **UI:** the Schedule (Gantt) view — bar positions, axis, per-bar overdue flag, derived-duration readouts, dependency warnings.

### Level → location cascade — `ganttMath.ts`
`cascadeLevelToLocations(...)` flows a level's per-activity window down to its locations to produce `status_logs` upserts. **Non-destructive by default** (a slot with its own dates is skipped unless `overrideExisting`), N/A skipped, prior `temporal_state`/`logged_date`/`status_color` preserved (a cascade sets the *plan*, never resets progress). Two flow modes: `'envelope'` (every location gets the full window) or `'subdivide'` (staggered — delegates to `subdivideTaskWindow`). Reversed windows are normalized to `[min,max]`.
- `reflowLevelToLocations(...)` — provenance-aware re-flow: only re-writes a dated slot when its level window **changed** AND its current dates match what the saved plan would have produced (cascade-owned) — so editing a level window re-staggers its locations while genuine hand-edits survive (`preservedHandEdits` count).
- `cascadeFillCounts(...)` — per-activity "applicable vs already-dated" counts for the panel's fill preview.
→ **UI:** the Schedule view **CascadePanel** ("apply level dates to N locations"), crew-flow stagger, the count-confirm.

### Crew-flow subdivision — `scheduleReconcile.ts:subdivideTaskWindow`
Splits a task's inclusive day span into contiguous per-location sub-windows in **walk order** (`walk_sequence` then numeric unit number), with lengths **area-weighted only when every unit has a positive `computed_area`, else even**:
```
totalDays = dayDiff(lo,hi)+1
weight_i  = hasFullArea ? computed_area_i : 1
boundary_i = round((Σweights_{≤i} / Σweights) * totalDays)   // last pinned to totalDays
```
The last unit always ends on the window's last day; short windows over many units simply share days (honest, not faked precision). `weighting` reports `'area' | 'even' | 'envelope'`. → **UI:** how an imported task or a subdivided cascade spreads dates across a floor's rooms.

### Import parse & reconcile — `mspImport.ts` + `scheduleReconcile.ts`
- `parseMspXml(text)` — parses an MSPDI `.xml` export: drops `IsNull` spacers and `Active=0` tasks, flags summaries/milestones, and rebuilds the **outline hierarchy** by maintaining an ancestor stack keyed on `OutlineLevel` (each leaf carries its summary `path`). Timestamps → day-only strings.
- `matchTasksToActivities(...)` — **exact → alias (dictionary) → fuzzy-contains** matching; fuzzy requires both names ≥4 chars normalized and the longest candidate wins.
- `suggestSheetForTask(...)` — regex-extracts a level number ("LEVEL 4", "4th floor", "Floor 2") from the task name then its summary chain, and suggests a sheet only when **exactly one** matches (ambiguous → left for the human).
- `buildImportWrites(...)` — mirrors the cascade posture exactly (non-destructive, N/A-skipped, progress preserved, last-write-wins per slot); reports `affectedUnitCount / skippedExisting / skippedNotApplicable`.
→ **UI:** the **MSP Import panel** — task→activity match badges, level guesses, the "N dates across M locations" confirm.

### Finish-to-Start date ripple — `dateRipple.ts`
Forward-propagates a predecessor slip over the light FS edge graph (**push-only** — never pulls the plan earlier; coarse, not a critical-path engine):
```
requiredStart = predFinish + 1 + lag_days       // negative lag = lead/overlap
shift only already-dated successors; preserve duration (newEnd = newStart + duration)
cycle-safe recursion; only edges with ripple_dates === true propagate
```
- `rippleForward(...)` — per-location downstream deltas; `chainLevelSchedule(...)` — the same at the level layer (the schedule itself as one "location"); `buildRippleWrites(...)` — turns deltas into non-destructive `status_logs` upserts.
→ **UI:** "moving Framing's finish pushes 4 downstream activities" — the ripple preview + count-confirm in the Schedule view.

### Make-ready readiness — `activityReadiness.ts`
`readinessFor(slot)` → `ready | blocked | done | na` from the FS edges + completion set (an **N/A predecessor can never block** — it'd deadlock forever). `unitMakeReady(...)` = the make-ready state of a location's bottleneck. `MAKE_READY_COLORS`: ready green, blocked red, complete slate, none slate-200. → **UI:** Map **Make-Ready mode** fills + legend, "Ready: Drywall" / "Framing blocked on Rough-in" labels.

---

## E. Schedule Baselines — `scheduleBaseline.ts`

A frozen, read-only snapshot of the *plan* (level windows + per-slot planned dates — never progress fields).
- `buildBaselineSnapshot({sheets, statuses, track})` — captures both layers (undated slots contribute nothing; `track` filters the location layer).
- `resolveCurrentBaseline(baselines)` — **the** "which baseline?" rule in one place: newest by `created_at`; a malformed snapshot degrades to `null` (never a silent fallback).
- `baselineDelta(snapshot, sheetId, activityName, proposedStart, proposedEnd)` → `new | unchanged | moved` + signed `startShiftDays`/`endShiftDays`.
- `baselineSlotWindow(snapshot, sheetId, activityName)` — the frozen level window for one slot (null when absent → "new"). *(Band vs Promise P4.)*
- `projectDriftSinceBaseline(snapshot, currentPlannedFinish)` — `dayDiff(latest baseline level-end, current finish)`; + = the plan slipped later since baseline. *(P4.)*
- `mergeLevelWindows(entries)` — folds confirmed import rows into per-sheet level patches (one-sided → same-day; later row wins).
→ **UI:** the MSP importer's "= baseline / new / ±Nd" per-task badges; the List's **"Show baseline"** columns + per-activity flag + "plan drifted ~N days since baseline" read (`StatusTable` / `FieldStatusTable`).

---

## F. Applicability, Bottleneck, Unit Progress & Staleness

### `applicability.ts`
`buildApplicabilityIndex` → `{rules, overrides}` (plain JSON-serializable Records). `isActivityApplicable`: a per-unit override wins, else the activity's `applies_to_unit_types` rule (null/empty = all; **fail-open for untyped units** so adding a rule never silently shrinks existing totals). `applicableSlotCount` = the progress denominator; `nextApplicableIndex` / `hasSequenceGaps` drive auto-advance past N/A activities. → **UI:** every count/%/forecast; the N/A toggle; auto-advance.

### `bottleneck.ts:deriveBottleneckStatuses`
Each unit's current work = the first applicable, non-completed activity in sequence; synthesizes a `'planned'` placeholder (carrying the real `activity_id`) when unlogged, and collects **out-of-sequence** completed/ongoing work logged after the bottleneck. → **UI:** the Map marker's current activity, the List's default row activity, out-of-sequence indicators. One definition shared by Map + level List + all-levels List.

### `unitProgress.ts`
`summarizeUnit` (done/total applicable, current activity, stage), `summarizeSheetProgress` (`percentComplete = round(completed/total*100)`, stage buckets), `countUnitsByCurrentActivity` (the "Drywall 18" chip counts). → **UI:** Map side panel per-unit dots + sheet headline %, overview filter-chip counts.

### `staleness.ts`
`lastActivityIso(logs)` = max `client_timestamp` (capture time) across a unit's rows; `formatAge(lastIso, todayIso)` → `today | Nd | Nw` (floor, clean 7-day week boundary). → **UI:** the muted "3d / 2w" age chip on List rows.

---

## G. Cost Codes — `costCodes.ts`

`COST_CODE_DIVISIONS` = the MasterFormat division legend; `divisionLabel("09")` → "09 · Finishes". `normalizeCode` (trim+collapse), `deriveDivision("09-2116.001") → "09"`. `parseCostCodeCatalog(text)` — a delimiter-auto-detecting parser accepting Markdown pipe tables, CSV, or TSV; maps columns by header synonym, de-dupes by code (last wins), derives division when absent. `groupCostCodesByDivision` sorts by numeric division then `sort_order`/code. → **UI:** the cost-code catalog manager (paste/import, grouped browse) and the cost-code axis on production rates.

---

## H. Canvas Geometry & Snapping

### `geometry.ts`
- `dist2` / `distToSegmentSquared` / `distToSegment` — point-to-segment distance (squared where possible to avoid `sqrt`); `getCentroid` — vertex mean.
- `isPointInPolygon(point, polygon)` — even-odd **ray-casting** (Jordan curve) test. → picks the sheet-text words falling inside a freshly traced room (room-name auto-fill).
- `getSnappedCoordinate(...)` / `snapAmongLines(...)` — the magnetic tracing snap. **Corner gravity** (a vertex within radius beats an edge projection) then perpendicular edge projection; **aspect-corrected** (Y ÷ aspect); dynamic radius `strength / (drawW * stageScale)` (zoom-stable); optional **interior bias** (penalizes the far wall face so a thick wall snaps to the room-interior side); optional **grid-aware** two-pass (walls first, grids only as fallback). → the core wall-snap when tracing rooms on the floor plan.
- `nearestCentroidWithin(...)` — closest unit centroid within a pixel radius (squared compare). → walk-route drop targeting.
- `isFinitePolygon(points)` — persistence guard (≥3 finite, on-canvas vertices). `mixAlpha(color, alpha)` — hex/rgb/rgba → `rgba()` (the single CSS-color→rgba converter). → marker/stamp fills.

### `polygonValidity.ts` — bow-tie warning
`orient(o,a,b)` (2D cross-product turn sign) → `segmentsProperlyIntersect` (proper interior crossing only) → `isSelfIntersecting(points)` (O(n²) over non-adjacent edges of the closed ring; a triangle can't self-intersect). Used to **warn, never block** on a self-overlapping trace that would corrupt the room's square footage. → the amber "bow-tie" cue while drawing.

### `gridAwareSnap.ts`
`isVectorOnGrid(start, end, grid, aspect, tol=GRID_COLLINEAR_TOL(0.004))` — a segment is "on" a confirmed gridline when **both endpoints hug** its infinite line (perpendicular distance ≤ tol, aspect-corrected) **and** their projection **overlaps** the grid's span. `tagVectorsWithGrid(...)` flags RBush items at tree-build time so snapping de-prioritizes grids. → keeps tracing from grabbing the structural grid instead of the wall next to it.

### `stampTransform.ts`
- `flipPolygon(points, axis)` — mirror about the bounding-box center (`center − (p − center)`).
- `rotatePolygon(points, dir, aspect)` — **aspect-correct 90° rotation** about the centroid: stretch to real space (`x*aspect`), rotate (`left`: `(dy, −dx)`; `right`: `(−dy, dx)`), un-stretch — so a square stays square on a non-square sheet.
- `buildStampPolygon(source, transform, aspect, anchor)` — fixed order **flips → net rotation (mod 4) → re-anchor centroid** onto the snapped drop point, so the result depends on transform *state*, not keypress order.
→ the Stamp tool's rotate/flip/place.

---

## I. Scale, Measure & Area — `scale.ts`, `measure.ts`, `imageDimensions.ts`

Canonical stored value: **`units_per_px` = real feet per base-image pixel** (against the sheet's `base_image_url` natural size — the same basis area uses).

### `scale.ts`
```
pixelDistance(p1,p2,W,H) = √((Δpct·W)² + (Δpct·H)²)         // pct → base-image px restores isotropy
unitsPerPxFromCalibration = knownLengthFt / pixelDistance   // TRUSTED (no DPI)
presetUnitsPerPx = realFeetPerPaperInch / assumedDpi        // ESTIMATE; ESTIMATED_RENDER_DPI = 288
computeAreaFromUnitsPerPx = (shoelace pixelArea) · unitsPerPx²   // ← the fix: area SQUARES the linear factor
```
`ARCH_SCALE_PRESETS` (¼"=1' → 4 ft/paper-inch, etc.); the **shoelace formula** (`Σ xA·yB − xB·yA)/2`) gives pixel area. `parseFeetInches("12'-6\"")`/`formatFeetInches`/`formatArea` handle length I/O; `describeScale` = the plain readout ("Calibrated: 1 px = 0.0250 ft" vs "1/4"=1' (approx)").
> **The ~4× bug this replaced:** the legacy area math multiplied a *pixel area* by a *linear* factor (dimensionally wrong). Area needs the linear factor **squared** — and both calibration and area must use the **same** base-image pixel basis (`imageDimensions.loadImageDimensions`), never the pdf.js render size, or areas are wrong by that ratio squared.
→ **UI:** the Scale/Calibrate tool, corrected room square footage (feeds SF production rates).

### `measure.ts`
`lengthFt(points, W, H, unitsPerPx)` = Σ `pixelDistance × unitsPerPx` over a polyline. `roundToFraction(ft, denom∈{4,8,16})` snaps to architectural fractions; `formatFeetInchesFraction` does inch/foot **roll-up** via `totalUnits = round(ft * 12 * denom)` then carries into inches/feet, reducing the fraction by `gcd`. `verificationError(measured, actual) = (measured − actual)/actual × 100`. → the Measure tool's live `12'-6 1⁄4"` readout and the "Verify scale" ± error check.

---

## J. PDF Render, Loupe, Mini-map, Viewport & Layout

### `pdfRenderMath.ts`
`MAX_CANVAS_PIXELS = 67M` (desktop Safari ceiling), `DEEP_ZOOM_THRESHOLD = 1.2`, `OVERLAY_MAX_PIXELS = 24M`, `LOD_HIGH_SCALE = 4.0`.
```
clampScaleToPixelBudget: maxScale = √(maxPixels / (pageW·pageH))
pickLodBitmap: scale ≥ 2 → high; < 1 → low; else base/placeholder
computeViewportRenderParams: renders only the visible [0–1] region at stageScale·dpr, re-clamped by √(maxPixels/totalPixels) if over budget
```
→ the off-main-thread PDF render pipeline — LOD pyramid selection + sharp deep-zoom viewport crops without blowing the canvas pixel budget.

### `loupeMath.ts` (magnifier)
`lensCoverage` — the page pct region a lens covers (`half = (lensCss/mag)/2 / (drawW·scale)`); `rectContains(outer, inner, shrink)` — containment with a re-render margin; `expandPatchRect` — grows coverage into a cached patch; `regionToBitmapSrc` — maps a pct region to source px in a patch bitmap. → the magnifier loupe's cached, zoom-independent zoom-in while tracing.

### `minimapMath.ts`
`fitMiniSize(aspect)` — aspect-fit thumbnail box (no letterbox); `stageToVisiblePctRect` — the live viewport as a pct rect; `viewportRectToMiniBox` — clamped box inside the thumbnail; `miniClickToStagePosition` — the inverse (click → recenter the main stage). → the bottom-right mini-map + click-to-navigate.

### `viewport.ts`
`classifyWheelIntent` — mouse-wheel→zoom vs trackpad-2-finger→pan (anchored on `deltaMode===0 && deltaX!==0`, so **mouse wheel always zooms**); `clampStagePosition(...)` — keeps ≥15% of the sheet on-screen; `dampToward(current, target, dt, tau)` = `target + (current−target)·e^(−dt/tau)` — frame-rate-independent smooth-zoom glide (`tau≈0.07s`); `createViewportSync` — leading+trailing throttle syncing the live Konva transform into React state (~8/s) for culling/LOD. → all floor-plan zoom/pan feel + performance.

### `canvasLayout.ts`
`computeLayout(stageW,stageH,imgW,imgH)` — **contain-fit** (`scale = min(stageW/imgW, stageH/imgH)`), centered with letterbox offsets; `computeVisibleBox(...)` — the on-screen slice in pct space padded ±0.05; `cullVisibleUnits(...)` — keeps only markers with a vertex inside the visible box (draw mode keeps unmapped slots too). → fits the sheet to the stage and culls off-screen markers (perf).

---

## K. Color encodings (numbers → color)

Three distinct palettes, each a single source of truth (never hardcode a state color in a component):
- **`statusColors.ts`** — the temporal-state palette: none = slate, planned = **amber**, ongoing = **blue**, completed = **emerald** (as hex `STATUS_HEX`, Tailwind bundles, and inline pairs). → every chrome surface coloring a location's state (map markers, legend, chips, stage dots, look-ahead).
- **`VARIANCE_COLORS`** (§A) — the schedule-lag severity ramp. → Lag Mode + variance cells.
- **`MAKE_READY_COLORS`** (§D) — ready/blocked/complete/none. → Make-Ready mode.

These encode *different* information and are intentionally not merged.

---

## L. Corpus stats & fuzzy text matching

- **`workbenchStats.ts:summarizeCorpus`** — pure counts for the `/workbench` drawing-library health strip: `totalDrawings`/`totalLabels`, `avgLabelsPerDrawing` (0 when empty), DoD-ready count, the review funnel, per-role / per-subtype / per-project-type / vector-quality tallies, and the `untypedOrPendingCount` review-queue signal. Deliberately isolated from `progressAnalytics` (never contaminates live project dashboards). → the Workbench cockpit health strip.
- **Fuzzy name matching family** — `matchTasksToActivities` (§D, exact→alias→fuzzy-contains) plus `roomNameMatch.ts` / `roomSuggestion.ts` / `aliasSuggestions.ts` / `roomAbbreviations.ts` normalize + compare strings (normalized `contains` + abbreviation/alias expansion) to suggest room names and resolve activity/subtype aliases. → trace-naming assist, dictionary alias resolution, importer match badges. *(String-similarity heuristics rather than numeric math — listed for completeness.)*

---

## Cross-cutting: where the math is load-bearing (touch with care)

- **Suppression is a feature.** A `null` forecast/rate/promise is correct behavior, not a gap to fill. Removing a suppression case ships a fabricated number.
- **Determinism.** Never introduce `Date.now()`/`Math.random()` into these modules — pass `today`/`seed` in. It's what makes the tests real and the UI stable.
- **The pixel-basis rule.** Scale, area, and measure MUST all use the base-image natural size (`imageDimensions.ts`). Mixing in the pdf.js render size reintroduces the ~4× area error.
- **Extend, never fork.** New forecast/variance/rate surfaces import the existing helpers; the point forecast lives once in `progressAnalytics`, its band once in `monteCarloForecast`.
- **Applicability gates every denominator.** Any new rollup must pass the `ApplicabilityIndex` so N/A slots stay out of totals and bottlenecks.

*Generated from a full read of `sitepulse-next/src/utils/*` on 2026-07-09. File/function names are the ground truth — re-read the source before relying on a specific formula.*
