"use client";

// SitePulse session seam for the absorbed Look-Ahead module (Phase 0a).
// REPLACES the standalone app's `store/useSession.ts` (Lookahead's own auth +
// project list + Supabase project picker — all dropped; SitePulse owns those).
//
// The vendored Look-Ahead components — only `Header.tsx` — read a small slice of
// this store (`cloud`, `currentProjectId`, `saving`, `backToDashboard`). Keeping
// the same store name + shape lets the gotcha-#2 import rewrite
// (`@/store/useSession` → `@/lookahead/store/useSession`) resolve with NO logic
// edit to the copied component.
//
// The actual load/save lives in the adapter (`@/lookahead/persistence`); this
// store is the thin session/UI layer over it. The visible autosave mount + the
// exact Header navigation behaviour are wired in Phase 0b.

import { create } from "zustand";
import { loadPlan, savePlan } from "@/lookahead/persistence";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface LookaheadSessionState {
  /** SitePulse is always cloud-backed (there is no local-only mode here). */
  cloud: boolean;
  /** The active SitePulse project whose plan is open; null until a workspace mounts (0b). */
  currentProjectId: string | null;
  saving: SaveStatus;
  /** Point the session at a SitePulse project (set by LookaheadWorkspace in 0b). */
  setProject: (id: string | null) => void;
  /** Load `projectId`'s saved plan (or a blank one) into the document store. */
  openPlan: (projectId: string) => Promise<void>;
  /** Persist the current document-store state to the active project's plan row. */
  saveCurrent: () => Promise<void>;
  /**
   * Standalone Lookahead's Header used this to return to its own project list.
   * SitePulse owns navigation (TopHeader), so here it only flushes a save; the
   * Phase-0b wiring decides whether the Header's "Projects" button shows at all.
   */
  backToDashboard: () => Promise<void>;
}

export const useSession = create<LookaheadSessionState>((set, get) => ({
  cloud: true,
  currentProjectId: null,
  saving: "idle",

  setProject: (id) => set({ currentProjectId: id, saving: "idle" }),

  openPlan: async (projectId) => {
    await loadPlan(projectId);
    set({ currentProjectId: projectId, saving: "idle" });
  },

  saveCurrent: async () => {
    const id = get().currentProjectId;
    if (!id) return;
    set({ saving: "saving" });
    try {
      await savePlan(id);
      set({ saving: "saved" });
    } catch {
      set({ saving: "error" });
    }
  },

  backToDashboard: async () => {
    await get().saveCurrent().catch(() => {});
  },
}));
