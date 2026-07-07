"use client";
/**
 * useCanvasKeyboard — the floor-plan canvas's window-level keyboard shortcuts
 * + container sizing (FloorplanCanvas Decomposition — Phase 8). Extracted
 * verbatim from FloorplanCanvas.tsx: the capture-phase keydown/keyup + blur
 * listeners (the Escape backout ladder, Shift tracking, arrow-nudge, both
 * Ctrl/Cmd+Z branches, draw-Enter, space-pan, tool number keys 1/2/3, stamp
 * R/H/V, magnifier M + [ ], +/- zoom, 0/Home reset, F-fit-selection), the
 * `checkSize` + window-`resize` re-measure with its 100/500/1000ms settle
 * timeouts, and the container `ResizeObserver` effect (the same sizing
 * concern — e.g. dragging the side panel; the HiDPI pixel-ratio effect stays
 * in the component). Behavior-preserving — the effect's dep array is
 * byte-identical (`[imageUrl, toolMode, onPolygonComplete, onToolModeChange]`)
 * and the handler bodies moved unchanged.
 *
 * Seams: the handler is created once per dep-change and reads everything live
 * through refs — the component keeps OWNING + syncing every ref passed in
 * (magnifier/boxOrigin/isEditingPending/selectedUnitIds/layout mirrors and
 * the handleZoom/resetView/zoomToFit/nudgeSelected/undoRedoPendingEdit
 * callback refs, synced per-render next to computedCursor). Do NOT "clean up"
 * refs into deps — that re-registers the listeners and changes Esc/space
 * semantics mid-gesture. The listeners stay on `window` with capture=true;
 * the ladder's `stopImmediatePropagation` calls depend on it. `isShiftDown` /
 * `dimensions` / `boxOrigin` / `isLegendSelected` STATE stays in the
 * component (JSX + layout + the capture/box tools consume them) — the hook
 * takes their setters. Only `spaceWasPanRef` (read nowhere else) moved in.
 * The draft/stamp/calibrate/measure bodies live in their Phase 5-7 hooks;
 * this hook consumes those returns. The M / [ ] branches write
 * `useSettingsStore` directly, exactly as before.
 */
import { useEffect, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useSettingsStore } from '@/store/useSettingsStore';
import type { CanvasLayout } from '@/utils/canvasLayout';
import type { ToolMode } from '@/store/useMapStore';
import type { PercentPoint as Point, OpeningEdge } from '@/types/domain';

interface UseCanvasKeyboardArgs {
  // ── The effect's deps — byte-identical to the pre-extraction array ────────
  /** Dep only (historical) — a sheet swap re-registers the listeners. */
  imageUrl: string;
  /** Active tool — the handler closes over it; a tool change re-registers. */
  toolMode: ToolMode;
  /** Dep only (historical — the Enter body moved into useTraceTool, Phase 5). */
  onPolygonComplete: (points: Point[], openingEdges?: OpeningEdge[]) => void;
  /** setToolMode — Esc backout, space-pan arm/release, the 1/2/3 keys. */
  onToolModeChange: (mode: ToolMode) => void;

  // ── Component-owned state setters ──────────────────────────────────────────
  /** Shift tracking — the STATE stays in the component (JSX/cursor consume it). */
  setIsShiftDown: Dispatch<SetStateAction<boolean>>;
  /** Esc always drops a selected legend — state stays in the component. */
  setIsLegendSelected: Dispatch<SetStateAction<boolean>>;
  /** Esc cancels a half-placed capture_line origin — state stays in the component. */
  setBoxOrigin: Dispatch<SetStateAction<Point | null>>;
  /** Container re-measure target — the STATE stays in the component (layout reads it). */
  setDimensions: Dispatch<SetStateAction<{ width: number; height: number }>>;
  /** The canvas container div — checkSize + the ResizeObserver measure it. */
  containerRef: RefObject<HTMLDivElement | null>;

  // ── Component-owned live-read refs (synced by the component) ──────────────
  /** Live magnifier on/off — Esc rung 1 + the [ ] gate. */
  magnifierActiveRef: RefObject<boolean>;
  /** Live magnifier zoom — the [ ] step base. */
  magnifierZoomRef: RefObject<number>;
  /** Fresh boxOrigin — the capture_line Esc rung (not a dep of the effect). */
  boxOriginRef: RefObject<Point | null>;
  /** Fresh pending-polygon gate — the Esc no-op rung + the pending-undo branch. */
  isEditingPendingRef: RefObject<boolean>;
  /** Fresh selection — arrow-nudge + F-fit gates. */
  selectedUnitIdsRef: RefObject<string[]>;
  /** Fresh layout — arrow-nudge's px→pct conversion. */
  layoutRef: RefObject<CanvasLayout>;
  /** Callback refs, synced per-render in the component (freshest identities). */
  handleZoomRef: RefObject<(direction: number) => void>;
  resetViewRef: RefObject<() => void>;
  zoomToFitRef: RefObject<(unitId: string) => void>;
  nudgeSelectedRef: RefObject<(dx: number, dy: number) => void>;
  undoRedoPendingEditRef: RefObject<(isRedo: boolean) => void>;

  // ── Tool-hook returns (Phases 5-7) the branches consume ───────────────────
  /** Live draft vertices (useTraceTool) — the draw Esc/undo/Enter gates. */
  draftPointsRef: RefObject<Point[]>;
  /** Draw Esc body (useTraceTool). */
  clearDraft: () => void;
  /** Draft-vertex Ctrl/Cmd+Z body (useTraceTool). */
  undoLastDraftVertex: () => void;
  /** Draw-Enter body incl. the :draw-enter guard (useTraceTool). */
  finishDrawingViaEnter: () => void;
  /** Stamp R / Shift+R body (useStampTool). */
  rotateStamp: (dir: 'left' | 'right') => void;
  /** Stamp H / V body (useStampTool). */
  flipStamp: (axis: 'horizontal' | 'vertical') => void;
  /** Live calibrate line (useMeasureTools) — the calibrate Esc gate. */
  calibratePointsRef: RefObject<Point[]>;
  /** Live length prompt (useMeasureTools) — the calibrate Esc gate. */
  calibratePromptRef: RefObject<{ p1: Point; p2: Point } | null>;
  /** Calibrate Esc body (useMeasureTools). */
  cancelCalibrate: () => void;
  /** Live measure run (useMeasureTools) — the measure Esc gate. */
  measurePointsRef: RefObject<Point[]>;
  /** Measure Esc body (useMeasureTools). */
  clearMeasureRun: () => void;
}

export function useCanvasKeyboard({
  imageUrl,
  toolMode,
  onPolygonComplete,
  onToolModeChange,
  setIsShiftDown,
  setIsLegendSelected,
  setBoxOrigin,
  setDimensions,
  containerRef,
  magnifierActiveRef,
  magnifierZoomRef,
  boxOriginRef,
  isEditingPendingRef,
  selectedUnitIdsRef,
  layoutRef,
  handleZoomRef,
  resetViewRef,
  zoomToFitRef,
  nudgeSelectedRef,
  undoRedoPendingEditRef,
  draftPointsRef,
  clearDraft,
  undoLastDraftVertex,
  finishDrawingViaEnter,
  rotateStamp,
  flipStamp,
  calibratePointsRef,
  calibratePromptRef,
  cancelCalibrate,
  measurePointsRef,
  clearMeasureRun,
}: UseCanvasKeyboardArgs) {
  // The tool space-pan restores on release/blur — read only by this hook.
  const spaceWasPanRef = useRef<ToolMode | null>(null);

  // Re-measure when the CONTAINER resizes (e.g. dragging the side panel), not just
  // on window resize. Without this the Stage/layout stay stale after a container
  // resize, so the floor plan and its markups don't refit until a refresh.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const width = el.offsetWidth;
        const height = el.offsetHeight;
        setDimensions(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputActive = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';

      if (e.key === 'Shift') setIsShiftDown(true);

      if (e.key === 'Escape') {
        setIsLegendSelected(false);
        if (!isInputActive) {
          if (magnifierActiveRef.current) {
            // Escape dismisses the magnifier first — one transient layer at a
            // time, like the draft/tool backout below. A second Escape then
            // clears the draft, a third returns to pan. Mirrors the M toggle.
            e.stopImmediatePropagation();
            useSettingsStore.getState().setMapSettings({ showMagnifier: false });
          } else if (toolMode === 'draw' && draftPointsRef.current.length > 0) {
            e.stopImmediatePropagation();
            clearDraft();
          } else if (toolMode === 'capture_line' && boxOriginRef.current) {
            // Cancel a half-placed grid axis (start node dropped, no end yet) but stay
            // in capture mode so the next click can re-place it.
            e.stopImmediatePropagation();
            setBoxOrigin(null);
          } else if (toolMode === 'calibrate' && (calibratePointsRef.current.length > 0 || calibratePromptRef.current)) {
            // Back out a half-placed / awaiting-length calibration line but stay in
            // calibrate mode so the next click starts a fresh line. The reset body
            // lives in useMeasureTools.cancelCalibrate.
            e.stopImmediatePropagation();
            cancelCalibrate();
          } else if (toolMode === 'measure' && measurePointsRef.current.length > 0) {
            // Clear the current measurement run but stay in measure mode; a second Esc
            // (no points left) falls through to return to pan. The reset body lives in
            // useMeasureTools.clearMeasureRun.
            e.stopImmediatePropagation();
            clearMeasureRun();
          } else if (isEditingPendingRef.current) {
            // Drawing Tool Excellence — Phase 1. A freshly-traced polygon is open for
            // naming. Esc must NOT fall through to the tool backout below: switching to
            // 'pan' here would strand the pending polygon + naming popover in a half-live
            // state. When the naming input has focus (the default on open) the popover's
            // own Esc handler already cancels; this branch just makes Esc a safe no-op
            // when focus is elsewhere instead of a confusing tool switch.
          } else if (toolMode !== 'pan') {
            onToolModeChange('pan');
          }
        }
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedUnitIdsRef.current && selectedUnitIdsRef.current.length > 0 && !isInputActive) {
        e.preventDefault();
        const currentLayout = layoutRef.current;

        if (currentLayout && currentLayout.drawW && currentLayout.drawH) {
          const nudgePx = 1;
          const dx = e.key === 'ArrowLeft' ? -nudgePx / currentLayout.drawW : e.key === 'ArrowRight' ? nudgePx / currentLayout.drawW : 0;
          const dy = e.key === 'ArrowUp' ? -nudgePx / currentLayout.drawH : e.key === 'ArrowDown' ? nudgePx / currentLayout.drawH : 0;

          // The per-unit map + persist live in useGeometryGestures.nudgeSelected.
          nudgeSelectedRef.current(dx, dy);
        }
      }

      // Drawing Tool Excellence — Phase 3. While a freshly-traced polygon is open for
      // naming, Ctrl/Cmd+Z steps back through this session's local edit history and
      // Ctrl/Cmd+Shift+Z re-applies — entirely separate from the DB-backed saved-unit
      // undo. Gated on `isEditingPendingRef` so it takes priority over the draft-vertex
      // undo below; `stopImmediatePropagation` keeps it from also tripping that or the
      // parent's saved-unit `useUndoRedo`. Skipped while a text input is focused so
      // Ctrl+Z inside the name field still does native text undo (not geometry undo).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && isEditingPendingRef.current && !isInputActive) {
        e.preventDefault();
        e.stopImmediatePropagation();
        // History step + replay live in useGeometryGestures.undoRedoPendingEdit.
        undoRedoPendingEditRef.current(e.shiftKey);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (toolMode === 'draw' && draftPointsRef.current.length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          // Vertex pop + stale opening-tag prune live in useTraceTool.undoLastDraftVertex.
          undoLastDraftVertex();
        }
      }

      if (toolMode === 'draw' && e.key === 'Enter') {
        if (!isInputActive && draftPointsRef.current.length > 2) {
          e.stopImmediatePropagation();
          // The :draw-enter guard + completion + draft clear live in
          // useTraceTool.finishDrawingViaEnter.
          finishDrawingViaEnter();
        }
      }

      // --- Phase 2 Keyboard Shortcuts ---
      if (!isInputActive && !(e.metaKey || e.ctrlKey)) {
        // Space held = temporary pan (like Figma/Photoshop)
        if (e.key === ' ' && !spaceWasPanRef.current) {
          e.preventDefault();
          spaceWasPanRef.current = toolMode as ToolMode;
          onToolModeChange('pan');
        }

        // Number keys for quick tool access
        if (e.key === '1') onToolModeChange('select');
        if (e.key === '2') onToolModeChange('pan');
        if (e.key === '3') onToolModeChange('draw');

        // Stamp & Fast Markup — Phase 1: rotate/flip the ghost before dropping. Gated to
        // stamp mode so these stay free elsewhere (R = rotate CW, Shift+R = rotate CCW,
        // H = flip horizontal, V = flip vertical; NOT F, which is "fit selection").
        if (toolMode === 'stamp') {
          const k = e.key.toLowerCase();
          if (k === 'r') { e.preventDefault(); rotateStamp(e.shiftKey ? 'left' : 'right'); }
          else if (k === 'h') { e.preventDefault(); flipStamp('horizontal'); }
          else if (k === 'v') { e.preventDefault(); flipStamp('vertical'); }
        }

        // M = toggle the magnifier loupe on/off (unified with the toolbar button).
        // The `e.repeat` guard means holding the key flips it once, not every frame.
        if (e.key.toLowerCase() === 'm' && !e.repeat) {
          const cur = useSettingsStore.getState().mapSettings.showMagnifier;
          useSettingsStore.getState().setMapSettings({ showMagnifier: !cur });
        }

        // While the loupe is up, [ and ] adjust its magnification (2×–8×),
        // Photoshop-style. The live "N×" readout in the lens gives feedback.
        if (magnifierActiveRef.current && (e.key === '[' || e.key === ']')) {
          e.preventDefault();
          const next = Math.min(8, Math.max(2, (magnifierZoomRef.current || 3) + (e.key === ']' ? 1 : -1)));
          useSettingsStore.getState().setMapSettings({ magnifierZoom: next });
        }

        // +/- for zoom (via ref to avoid block-scoped variable error)
        if (e.key === '=' || e.key === '+') handleZoomRef.current(1);
        if (e.key === '-' || e.key === '_') handleZoomRef.current(-1);

        // 0 or Home = fit to view
        if (e.key === '0' || e.key === 'Home') resetViewRef.current();

        // F = fit selection to screen
        if (e.key === 'f' && selectedUnitIdsRef.current?.length > 0) {
          zoomToFitRef.current(selectedUnitIdsRef.current[0]);
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftDown(false);
      // Release space = return to previous tool
      if (e.key === ' ' && spaceWasPanRef.current) {
        onToolModeChange(spaceWasPanRef.current);
        spaceWasPanRef.current = null;
      }
    };

    // Safety: if user holds Space and switches windows, keyup never fires.
    // Reset the temporary pan state on window blur.
    const handleBlur = () => {
      if (spaceWasPanRef.current) {
        onToolModeChange(spaceWasPanRef.current);
        spaceWasPanRef.current = null;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', handleBlur);

    const checkSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };

    checkSize();
    const timeouts = [100, 500, 1000].map((t) => setTimeout(checkSize, t));

    window.addEventListener('resize', checkSize);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('resize', checkSize);
      timeouts.forEach(clearTimeout);
    };
  }, [imageUrl, toolMode, onPolygonComplete, onToolModeChange]);
}
