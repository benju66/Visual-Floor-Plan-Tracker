"use client";

// Phase 0b — the thin SitePulse mount for the absorbed Look-Ahead view.
// REPLACES the standalone app's `components/App.tsx`: there is no Login /
// Dashboard / project-list here — SitePulse owns auth + project picking, and
// this view is reached via TopHeader's 5th view toggle (`viewMode === 'lookahead'`).
//
// Responsibilities (everything cloud-y lives in the Phase-0a seam/adapter):
//   1. On mount, load this project's saved plan — or a blank one — into the
//      Look-Ahead document store via `useSession.openPlan(projectId)`.
//   2. Debounce-save (~800ms) to the project's `lookahead_plans` row whenever the
//      plan's persisted document slice GENUINELY changes — mirroring `App.tsx`'s
//      change detection (`project` / `areas` / `areaOrder` / `currentAreaId`).
//   3. Flush a *pending* edit on unmount and when the tab is hidden / about to close.
//
// Lazy-create (locked decision): a row is written only on the first real edit —
// never on mere view-open or open-then-leave. Two guards keep this honest against
// React StrictMode's dev double-mount (which runs `openPlan` twice, so a duplicate
// hydration can land after the session is already pointed at the project):
//   • a CONTENT-snapshot baseline (`lastSavedRef`) — a re-hydration of identical
//     data serializes equal to the baseline and is ignored, regardless of timing;
//   • the flush is gated on an actually-pending save timer.
//
// Isolation (AGENTS.md guardrails): touches ONLY `lookahead_plans` (via the
// adapter) — never the offline `pendingChanges` queue or any existing table.

import { useEffect, useRef, useState } from "react";
import { useStore, projectBlob } from "@/lookahead/store/useStore";
import { useSession } from "@/lookahead/store/useSession";
import LookAhead from "./components/LookAhead";

const SAVE_DEBOUNCE_MS = 800;

export default function LookaheadWorkspace({ projectId }: { projectId: string }) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Serialized snapshot of the last loaded/saved document. `null` = not loaded
  // yet, which suppresses every save while the store is being hydrated.
  const lastSavedRef = useRef<string | null>(null);
  // Render gate: until THIS project's plan has actually loaded, show a neutral
  // placeholder rather than the store's in-memory seed (the vendored demo plan),
  // which otherwise flashes on every refresh before async hydration completes.
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    setStatus("loading");

    // Load the saved plan (or a blank one), then arm autosave by recording the
    // loaded content as the baseline. Until this resolves, `lastSavedRef` is null
    // and the subscription ignores the hydrating `set()`.
    void useSession
      .getState()
      .openPlan(projectId)
      .then(() => {
        if (!active) return;
        if (useSession.getState().currentProjectId !== projectId) return;
        lastSavedRef.current = JSON.stringify(projectBlob(useStore.getState()));
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });

    // Debounce-save on document changes. Mirrors `App.tsx`: persist only when one
    // of the four serialized slices changes AND the new content actually differs
    // from the last loaded/saved snapshot; transient UI state (selection, menus,
    // undo stacks, scroll flags) is intentionally ignored.
    const unsub = useStore.subscribe((state, prev) => {
      if (lastSavedRef.current === null) return; // still loading — ignore hydration
      if (useSession.getState().currentProjectId !== projectId) return;
      const changed =
        state.project !== prev.project ||
        state.areas !== prev.areas ||
        state.areaOrder !== prev.areaOrder ||
        state.currentAreaId !== prev.currentAreaId;
      if (!changed) return;
      const serialized = JSON.stringify(projectBlob(state));
      if (serialized === lastSavedRef.current) return; // structurally identical — no real edit
      lastSavedRef.current = serialized;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void useSession.getState().saveCurrent();
      }, SAVE_DEBOUNCE_MS);
    });

    // Flush a pending edit immediately when the tab is hidden or about to close,
    // so an edit made in the last <800ms isn't lost. Gated on a pending timer so
    // merely opening the view (no edit) never triggers a write.
    const flush = () => {
      if (!saveTimer.current) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      void useSession.getState().saveCurrent();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      unsub();
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      // Persist a pending edit before leaving, then detach the session from this
      // project so a later remount (re-open) reloads fresh from the row.
      flush();
      useSession.getState().setProject(null);
    };
  }, [projectId]);

  // Hold back the table until the plan is hydrated, so the seed never paints.
  if (status !== "ready") {
    return (
      <div style={{ minHeight: "100vh", background: "#fafafa", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {status === "error" && (
          <div style={{ color: "#6b7280", fontSize: 14, fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
            Couldn&apos;t load this plan. Refresh to try again.
          </div>
        )}
      </div>
    );
  }

  return <LookAhead />;
}
