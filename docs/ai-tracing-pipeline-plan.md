# AI-Assisted Location Tracing — Implementation Plan

**Goal:** Turn the manual polygon-tracing **training workbench** into a human-in-the-loop pipeline that (a) captures every trace as clean, versioned training data starting now, (b) speeds up tracing immediately with AI assist that needs **zero** training data, and (c) compounds — the model improves as more sheets are traced — without silently corrupting the dataset along the way.

**Status:** Planning. No implementation code yet. Grounded in a codebase audit (workbench UI, backend/data model, infra) + external research (HITL annotation best practices, CV building blocks, GPU hosting). Items marked *(verify)* need confirmation at implementation time.

**Build profile (drives the resolved decisions below):** solo tracer + solo dev (leveraging Claude Code / Opus 4.8), **hundreds** of sheets near-term, AI/cloud spend target **~$150/mo**, source PDFs **fully owned/cleared**, and a **custom trained model as the long-term goal**. Sequencing: **thin capture first, then the assist spike.** This profile favors the free/geometric path + on-demand managed services over standing infra, while still locking down the few things that are irreversible for a future model (provenance, leakage-safe grouping, RLE-capable export).

---

## 0. What already exists (do NOT rebuild)

The workbench is substantially built. The plan **extends** it; it does not replace it.

**Tracing & editing** — `WorkbenchTracer.tsx`, `FloorplanCanvas.tsx`, `WorkbenchLabelPopover.tsx`, `WorkbenchTracerToolbar.tsx`:
- Tools: pan (`2`), draw (`3`), select (`1`); snapping toggle. ~12 keyboard shortcuts.
- Draw polygon (click vertices, Enter to complete, Esc cancel, Ctrl+Z undo point); snapping to extracted wall vectors.
- Edit: rename, re-type, delete, vertex drag/reshape, arrow-key nudge, multi-select.
- Per-location attributes: name (`unit_number`), type (`top_level_role` + `subtype_id`), `spans_levels` + `level_note`, `has_void`, auto `computed_area`.

**Review / QA** — `WorkbenchReviewControl.tsx`, `WorkbenchReviewTable.tsx`, `workbenchNaming.ts`:
- Drawing-level review state machine: **draft → ready_for_review → reviewed**, with reviewer signature (who + when).
- Definition-of-Done gate (5 checks: has labels, all named, names trimmed, names unique, all typed).
- Editable per-drawing review table.

**Library & corpus** — `WorkbenchPage.tsx`, `WorkbenchHealthStrip.tsx`, `NewDrawingModal.tsx`, `ConfirmPurgeModal.tsx`:
- PDF upload (multi-page select), per-drawing metadata sidecar (`workbench_sheets`: project type, level, source sheet #, **vector quality**, partial flag).
- Library grid: group/filter by project type, level, review state, vector quality; archive/restore (soft delete); purge (hard delete, type-to-confirm).
- Corpus health strip: review funnel, taxonomy coverage, source quality.

**Data model & infra** (audited):
- `units` (polygon_coordinates JSONB `{pctX,pctY}`, unit_number, unit_type, top_level_role, subtype_id, computed_area, spans_levels, level_note, has_void, walk_sequence, icon_offset_x/y), `sheets` (base_image_url, scale_ratio, project_id, pdf_version), `workbench_sheets` (sidecar + review state), global `subtypes` dictionary, `sheet_vectors` (cache). All under a hidden **`kind='workbench'` container** (`assertWorkbenchContainer`) isolated from live projects.
- Migrations: idempotent SQL in `sitepulse-next/supabase/migrations/YYYYMMDD_*.sql`; **RLS on every table** (membership join to `project_members`; workbench writes gated to owner/admin/pm); regenerate `src/types/database.types.ts` after.
- Backend: FastAPI on **Render** (Docker), PyMuPDF, Supabase service-role, local ES256 JWT verify, ~25s request budget. Storage bucket `floorplans` (`originals/{id}.pdf`, `converted/{id}.png`), deletes via backend.
- Frontend: Next.js 16, TanStack Query, Zustand. **Not on Vercel** (likely Render).
- **No AI/ML in production today.** **No job queue** (no Celery/Redis). **No CI** (no GitHub Actions).

**Gaps the audit flagged (all approved for inclusion):** no in-workbench scale calibration (→ `computed_area` null), no bulk edit, no corpus export, no copy/paste or sheet rename.

---

## 1. Architecture overview

```
Next.js (Render)  ──►  FastAPI (Render)  ──►  Supabase Postgres + Storage
   workbench UI         broker/orchestrator        units, events, vectors, text, PDFs
        │                      │
        │                      ├──► GPU host (Replicate→RunPod/Modal): SAM encode, model inference
        │                      └──► Anthropic API (Claude vision): name/type proposal
        └──► in-browser SAM decoder (WebGPU) using cached embedding
```

**Principles that shape everything below:**
- AI output is always a **suggestion**; a human reviews every one. Never auto-confirm.
- Capture the **suggested-vs-final delta** + effort + method + rule versions per trace — not just the final geometry.
- Human and AI share one geometry convention (snap to wall vectors) so corrections are clean.
- GPU/LLM never run on the web tier; **FastAPI brokers** all model calls so hosts are swappable.

---

## Milestone 0 — Annotation spec & conventions (do first; blocks mass tracing)

The one set of decisions that's expensive to reverse.

- **M0.1 — `ANNOTATION_SPEC.md` (version-controlled living doc).** Canonical geometry = polygon **snapped to extracted wall vectors** (reproducible), not freehand inside-edge. Define: void/donut semantics, `spans_levels` rules, name normalization, within-sheet uniqueness, and the **class ontology** (define your own room-type taxonomy informed by general industry practice — do not import a non-commercial dataset's labels/taxonomy). Include correct-vs-incorrect visual examples and an escalation path for ambiguous spaces. *Acceptance:* a second tracer reproduces geometry within tolerance + identical labels.
- **M0.2 — Snapping on by default** in draw mode so geometry is consistent by construction.
- **M0.3 — Usable-area rule.** If true inside-edge area is needed, keep annotation on the wall line and derive area via inward offset of half wall-thickness (downstream transform; annotation unchanged).

---

## Milestone 1 — Track A: capture training data now (no-regret foundation)

Every sheet traced before this exists loses its correction signal permanently.

- **M1.1 — `trace_events` (append-only).** One row per create/edit/reject. Columns: `unit_id?`, `sheet_id`, `event_type` (`ai_suggested`|`accepted`|`edited`|`rejected`|`manual_created`), `polygon_before/after` (jsonb), `label_before/after` (jsonb), `created_by`, `created_at`. (Extended by M1G.3.) Wire into `useCreateWorkbenchLabel`/`useUpdateWorkbenchLabel`/delete. *Acceptance:* every workbench mutation writes exactly one event with before/after.
- **M1.2 — Provenance columns on `units`.** `source` (`human`|`ai_accepted`|`ai_edited`), `model_version`, `suggested_polygon` (jsonb), `suggested_label` (jsonb), unit-level `review_status`. Backfill existing as human/confirmed.
- **M1.3 — Leakage-safe `group_key`.** Persist a stable group id (sheet → drawing → project/building) on each unit/export row. **Train/val/test must split by this group, never by room** — naive splits inflate metrics ~10–28% (DocLayNet, remote-sensing studies). Freeze a **temporal** test set (sheets after a cutoff date). *Acceptance:* export tooling refuses to place one group across splits.
- **M1.4 — COCO export job (RLE, not bare polygons).** Backend job: rasterize each sheet PDF at **fixed DPI**, percent→pixel, emit COCO **segmentation as RLE** so **`has_void` donut rooms export as mask holes** (shapely `Polygon(shell,[holes])` → RLE) and multi-part regions use multi-polygon `segmentation`. Categories = role/subtype. *Acceptance:* re-overlaying export on rasters matches workbench; voids preserved as holes.
- **M1.5 — Dataset snapshots & lineage.** Version each export (DVC content-hash, or a `dataset_snapshots` table referencing storage); record the snapshot hash so every future model ties back to exact data. *Acceptance:* any export is reproducible from its hash.

---

## Milestone 1G — Data governance & rule versioning (cross-cutting with M1)

Rules evolve; unversioned rules turn the corpus into silently contradictory data ("label drift").

- **M1G.1 — `rule_versions` registry.** `ruleset` (`annotation_spec`|`taxonomy`|`definition_of_done`), monotonic `version`, `effective_at`, `notes`, `changed_by`. App reads current versions and bumps are deliberate/logged.
- **M1G.2 — `taxonomy_events` audit log (urgent — taxonomy already mutates via pending-subtype flow).** Append-only `subtype_id`, `event_type` (`created`|`renamed`|`merged`|`approved`|`retired`), `before/after`, `taxonomy_version`, `changed_by`. So a subtype whose meaning shifts is traceable.
- **M1G.3 — Enriched `trace_events`** (extends M1.1): add `method` (`manual_draw`|`vector_proposal`|`sam`|`model_pretrace`), `spec_version`, `taxonomy_version`, `dod_version`, `model_version`, `app_version`, `confidence`, `duration_ms`, `edit_magnitude` (vertices moved / labels changed). *Acceptance:* one row answers "what, by whom, by which method, under which rules, at what confidence, costing how much effort."
- **M1G.4 — Anti-rubber-stamp instrumentation** (extends `WorkbenchHealthStrip`). Track AI **accept-rate + edit-distance** (a *low* edit rate is a red flag, not success), time-per-sheet/trace (north-star), and inter-annotator agreement where two people trace the same sheet. Maintain a **human-only gold set** + periodic **blind** (no-prelabel) tracing as the true quality anchor, since shared anchoring to one model inflates IAA.

---

## Milestone I — Infra prerequisites (gates batch AI & training)

- **MI.1 — Async job queue + worker.** No queue exists and Render caps requests ~25–30s, so **batch pre-labeling and training will time out**. Add Celery + Redis (Upstash) with a Render worker, **or** offload batch/training to Modal/RunPod. Add `inference_jobs` table (status, sheet_id, method, result ref) + frontend polling hook. *Acceptance:* a long batch runs without blocking a request.
- **MI.2 — GPU broker endpoints in FastAPI.** `/segment` (SAM) and `/precompute-embeddings` (batch); FastAPI holds the GPU-host token server-side; frontend never calls the GPU host directly. Host is swappable (Replicate→RunPod/Modal).
- **MI.3 — CI.** Add GitHub Actions: `npm run typecheck` + Vitest (frontend), pytest (backend), and a migration smoke-check. We're adding many tables/types; CI prevents drift. *Acceptance:* PRs run checks.
- **MI.4 — New-table recipe** (apply to every table above): idempotent migration in `supabase/migrations/`, **RLS scoped to workbench-container membership** (writes owner/admin/pm), regenerate `database.types.ts`, derive domain types, add TanStack hooks.

---

## Milestone 2 — Track B: cold-start assist (zero training data, biggest speedup)

Available day one; reuses existing backend. Build in order.

- **M2.1 — PDF text-layer extraction *(confirmed feasible)*.** Most PDFs are searchable; PyMuPDF is already a dep. New endpoint runs `page.get_text("words")`, maps each word bbox through the **existing `map_point()`** (`main.py:499`) into the same `{pctX,pctY}` space as polygons/vectors; cache to `sheet_text` (mirror `sheet_vectors`). Empty result → flag for OCR later (off critical path). *Acceptance:* words overlay correctly on the plan.
- **M2.2 — Wall-vector room proposal (highest leverage; pure geometry, no ML, permissive).** Vector PDF input is the *best case* for a geometric partition and sidesteps the ML licensing minefield (see Cross-cutting). Primary path (all BSD/Apache): from `sheet_vectors` → collapse double-line walls to centerlines (or polygonize then drop sliver faces) → snap-round endpoints with `shapely.set_precision` (more robust than heuristic pairwise `shapely.snap`) → **close doorway gaps** (the #1 failure mode: extend/snap wall stubs or insert door-closing segments) → `shapely.polygonize(unary_union(segments))` → simplify/regularize → snap → percent polygons + confidence. Use `polygonize_full` so **dangles = unclosed door stubs surface as built-in QA diagnostics**. Raster fallback for messy plans: rasterize → morphological **close** → flood-fill / connected components (OpenCV Apache-2.0 / SciPy BSD). Pre-populates a **whole sheet at once**. *Acceptance:* covers majority of rooms on a clean vector sheet; dangles reported for the rest.
- **M2.3 — Label pre-fill.** Attach interior `sheet_text` words to each candidate polygon → propose `unit_number` (near-free, exact). For scans / label-less plans / type inference, send polygon crop + name + taxonomy to **Claude vision** (Opus-class for dense plans — higher input resolution preserves thin walls/small labels) using **Structured Outputs / strict tool use** (JSON Schema `{rooms:[{name,type,confidence}]}`). VLMs are strong at *naming/classifying* but weak at *counting/precise geometry* — use for labels only, never polygons, and keep the human in the loop. Cost ≈ $0.004–0.024/sheet (Batch API halves it). *Acceptance:* majority arrive with plausible name + type.
- **M2.4 — "Auto-trace sheet" in the workbench.** Toolbar action → M2.2/M2.3 → render candidates as visually-distinct **suggested** overlays; human accept/edit/reject each, emitting `trace_events` with `method` + `confidence`. Never auto-confirm. *Acceptance:* a user auto-populates a sheet and resolves each suggestion; provenance recorded.
- **M2.5 — SAM click-to-segment (irregular rooms).** Use **SAM 2.1 (Apache 2.0** — commercial-safe; Tiny/Base+ tiers). **Avoid FastSAM (AGPL-3.0), EdgeSAM (non-standard license), and YOLO-seg weights (AGPL)** — they taint a commercial product. Efficiency upgrades stay Apache (MobileSAM, EfficientViT-SAM, both keep SAM's decoder so the click UX is identical). Day-1: FastAPI → Replicate `meta/sam-2`. Latency upgrade: **split encoder/decoder** — run the heavy **image-encoder once** on the GPU host, cache the embedding in Supabase Storage keyed by sheet, run the lightweight **decoder in-browser (onnxruntime-web/WebGPU)** so every click after the first needs no server round-trip; move the encoder to RunPod (FlashBoot) or Modal (keep-warm) when interactive volume grows. Mask → polygon (same post-proc as M2.2) → snap → existing popover flow. *Acceptance:* click-inside produces a snapped polygon for spaces flood-fill misses.

---

## Milestone 3 — Track C: the flywheel (after Track A has data)

- **M3.1 — Train a segmentation model (own data only).** Architecture: **Detectron2 Mask R-CNN (Apache-2.0)** primary, **Mask2Former (MIT)** for max accuracy on cluttered plans. Init from an **ImageNet/Apache backbone** and train **solely on your own human-corrected traces** — do **not** ship weights derived from CubiCasa5K (CC BY-NC), GPL repos, or academic-only datasets (RPLAN/Structured3D/ZInD/LIFULL); those are research-validation warm-starts only, never production. Transfer learning makes a few **hundred** reviewed sheets enough for a useful first auto-tracer; **low thousands** for robustness across drawing styles. Handle **class imbalance train-only** (focal + Tversky/Dice, class-balanced-by-effective-number loss, copy-paste aug for rare room types) — never resample val/test. (To fine-tune SAM for your style, train only the lightweight decoder + prompt encoder; freeze the heavy image encoder.)
- **M3.2 — Inference/pre-trace endpoint** returning polygons + confidence, same suggested-overlay UX as M2.4 (`method='model_pretrace'`), routed through MI.2.
- **M3.3 — Active learning** (only after a solid baseline, and **benchmarked against random+strong-aug**, which it often fails to beat). Region/superpixel-level uncertainty (pixel entropy baseline) with **batch diversity** (CoreSet/BADGE); confidence queue routes low-confidence sheets/regions to humans first.
- **M3.4 — Eval harness.** Score with **mask AP @ IoU 0.5:0.95 + AP50 + AP75 + per-class AP/IoU + Boundary IoU** (and Panoptic Quality if framed as wall-to-wall partition). **Never** vertex-match. Always report per-class (means hide rare-type regressions). Evaluate on the frozen temporal/group test set.
- **M3.5 — Model registry + collapse control.** MLflow registry (Staging→Prod) + W&B artifacts; log per-class metrics, dataset snapshot hash (M1.5), git SHA, seeds, prediction overlays. Keep a **constant fraction of human-only labels each retrain round** and monitor **tail/edge-case** metrics to catch feedback-loop degradation. Stamp `model_version` on every suggestion/event.

---

## Milestone W — Workbench completeness (non-AI gaps, approved)

- **MW.1 — Scale calibration in workbench** (two-point known-distance → `scale_ratio`) so `computed_area` is populated; area is a real training/feature signal.
- **MW.2 — Bulk edit in review table** (multi-select rename/retype) — correction throughput at scale.
- **MW.3 — Corpus CSV/Parquet export** (human-readable, separate from the COCO training export).
- **MW.4 — Copy/paste location + in-app sheet rename** — ergonomics for repetitive layouts.

---

## Cross-cutting governance (apply throughout)

- **Commercial licensing constraint (hard rule).** Ship only **Apache/MIT/BSD** models + **your own cleared data**. The floor-plan ML ecosystem is a minefield: CubiCasa5K (CC BY-NC), DeepFloorplan/PolyDiffuse (GPL), FastSAM/YOLO-seg (AGPL), and RPLAN/Structured3D/ZInD/LIFULL (academic-only, no redistribution) are all unusable in a shipped product. Day-one auto-detection is therefore **geometric, not ML** (M2.2). Vet every model/dataset/weight before it touches the product.
- **Datasheet for the dataset** + **Model Cards** (performance disaggregated per room type / drawing style).
- **Source-PDF licensing & PII** review before plans are baked into a model — largely irreversible legal risk; record provenance/license per source drawing.
- Every new table: RLS + types + hooks (MI.4). Every model call: brokered + `model_version` stamped.

---

## Sequencing (tuned to the build profile)

1. **Thin capture (first, ~1 day):** minimal `trace_events` (before/after geometry+label, `method`, `source`, `model_version`, `spec_version`, `duration_ms`, `created_by`) + `units` provenance columns (M1.2) + `group_key`/source-building tag (M1.3) + a short `ANNOTATION_SPEC.md` v1 (M0.1) and snapping-on default (M0.2). Skip the heavier governance tables until they earn their place. Nothing traced is wasted from here on.
2. **Assist spike:** **M2.1** text-layer extraction → **M2.2** geometric room proposal (no GPU) → **M2.3** label pre-fill → **M2.4** suggested-overlay accept/edit/reject UI → **M2.5** SAM (Replicate on-demand) for irregular rooms.
3. **Light governance as it earns it:** `rule_versions` (M1G.1) + `taxonomy_events` (M1G.2) when the taxonomy starts churning; accept-rate/edit-distance + time-per-sheet on the existing health strip (M1G.4). **MI.1 queue stays deferred.**
4. **MW.1 scale calibration** early (improves data completeness); MW.2–MW.4 opportunistic.
5. **Model phase (M3)** once a few hundred reviewed sheets exist: COCO/RLE export (M1.4) + DB snapshot (M1.5) → one-off training offload → eval (mask AP + per-class + Boundary IoU) → suggested-overlay pre-trace → active learning only if it beats random+aug.

**MI.3 (CI)** and **MI.4 (new-table recipe)** apply throughout — every table added in step 1 uses the RLS + types + hooks recipe.

## Resolved decisions (this build)
- **GPU host:** Replicate `meta/sam-2` **on-demand, no warm pool**; embeddings cached in Supabase, decoder in-browser. Revisit RunPod/Modal only if interactive latency becomes painful (unlikely for a solo tracer). Lead with the **geometric path (M2.2), which needs no GPU** — SAM is only for irregular rooms.
- **Job queue:** **Deferred.** Geometric proposal runs inline in FastAPI (< 25s, CPU); pre-label a sheet on open, not in batch. **MI.1 is out of near-term scope.** Training is a one-off manual offload (Modal/RunPod/Colab) when data exists.
- **Dataset versioning:** **DB-native now** (`trace_events` + `dataset_snapshots` → COCO in storage). Add **DVC at training time** for git-coupled experiment lineage. No DVC ops today.
- **Vision-LLM:** **On-demand, text-layer-first.** PyMuPDF names for free; Claude vision (Sonnet default, Opus for dense plans) fills gaps + infers type. ~few dollars total at this volume.
- **Third-party licensing:** No CC-BY-NC/GPL/AGPL model or dataset in the shipped product. Day-one detection is geometric; the trained model (M3.1) uses an Apache/MIT architecture on **owned data only**. *Your* source PDFs are cleared.
- **Leakage grouping:** capture an optional **source building/project tag** in the New Drawing modal so multi-sheet buildings group into the same train/test fold (added to the thin-capture step).
