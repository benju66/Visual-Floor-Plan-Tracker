"use client";
/**
 * useCanvasViewport — the floor-plan canvas's camera engine
 * (FloorplanCanvas Decomposition — Phase 2). Extracted verbatim from
 * FloorplanCanvas.tsx: the `stageScale`/`stagePosition` state + `liveViewportRef`
 * live mirror, the wheel path (instant + smooth-glide), the programmatic camera
 * moves (animate / zoom buttons / reset / fit-to-unit / zoom-level picker), and
 * the mini-map navigation callbacks. Behavior-preserving — the pure math still
 * lives in `src/utils/viewport.ts` (classifyWheelIntent, clampStagePosition,
 * createViewportSync, dampToward); this hook owns the Konva-facing state and
 * gesture wiring around it.
 *
 * The ref-sync pattern is load-bearing (AGENTS §3): `liveViewportRef` is the
 * single freshest source of truth for the Stage transform, written synchronously
 * at every mutation site BEFORE the throttled React-state commit, so a re-render
 * mid-gesture reconciles the Stage to the value it already has (the wheel-zoom
 * "snap-back" fix). Do not migrate it into state.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { RefObject } from 'react';
import type Konva from 'konva';
import { classifyWheelIntent, clampStagePosition, createViewportSync, dampToward } from '@/utils/viewport';
import type { CanvasLayout } from '@/utils/canvasLayout';
import { useSettingsStore } from '@/store/useSettingsStore';
import type { PercentPoint } from '@/types/domain';

// Wheel-zoom scale bounds (shared by instant + smooth paths) and the glide time
// constant for smooth-wheel-zoom. ~70ms reads as a glide without feeling laggy.
const MIN_SCALE = 0.1;
const MAX_SCALE = 15;
const WHEEL_SMOOTH_TAU = 0.07;

/** The unit fields zoomToFit reads — structural, so tests don't need full DB rows. */
interface FitTarget {
  id: string;
  polygon_coordinates: PercentPoint[] | null;
}

interface UseCanvasViewportArgs {
  /** The Konva Stage — mutated directly at 60fps by the wheel/animation paths. */
  stageRef: RefObject<Konva.Stage | null>;
  /** Current fit-and-center layout (stage pixels at scale 1). */
  layout: CanvasLayout;
  /** Live mirror of `layout` for the synchronous rAF paths (owned by the component). */
  layoutRef: RefObject<CanvasLayout>;
  /** Measured container box (stage width/height in CSS pixels). */
  dimensions: { width: number; height: number };
  /** Sheet units — zoomToFit targets a unit's polygon bounding box. */
  units: FitTarget[];
  /** In-flight animations are cancelled when the active sheet changes. */
  activeSheetId: string | null;
  /** mapSettings.smoothWheelZoom !== false — mouse-wheel notches glide when on. */
  smoothWheelZoom: boolean;
}

export function useCanvasViewport({
  stageRef,
  layout,
  layoutRef,
  dimensions,
  units,
  activeSheetId,
  smoothWheelZoom,
}: UseCanvasViewportArgs) {
  const animationFrameRef = useRef<number | null>(null);

  // Smooth-wheel-zoom glide state (default-on; mapSettings.smoothWheelZoom !== false). Each
  // wheel notch updates a target scale + cursor anchor; a single rAF loop eases the
  // live transform toward it via dampToward(). Refs (not state) so the loop never
  // triggers a React render — same direct-Konva-mutation pattern as handleWheel.
  const wheelTargetScaleRef = useRef<number | null>(null);
  const wheelAnchorRef = useRef<{ screenX: number; screenY: number; contentX: number; contentY: number } | null>(null);
  const wheelRafRef = useRef<number | null>(null);
  const wheelLastFrameRef = useRef(0);

  const [stageScale, setStageScale] = useState(1);
  const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 });

  // Live viewport transform — the single freshest source of truth for the Stage's own
  // x/y/scale, updated synchronously at every mutation site (wheel, animation, drag). The
  // Stage props read from this ref instead of the debounced React state, so a re-render that
  // lands during the 100ms zoom-sync window never reconciles the stage back to a stale value
  // (fixes the wheel-zoom "snap-back"). React state (above) stays the source for derived math.
  const liveViewportRef = useRef({ scale: 1, x: 0, y: 0 });

  // Leading+trailing throttle pacing the React-state commits of the live transform.
  // Leading commit = instant LOD/culling response at gesture start; one commit per
  // ~120ms mid-gesture keeps them fresh; the flush/trailing commit lands the final
  // value. Every mutation site writes liveViewportRef BEFORE pushing, so a re-render
  // triggered by any commit reconciles the Stage to the value it already has
  // (preserving the snap-back fix).
  const viewportSync = useMemo(() => createViewportSync(({ scale, x, y }) => {
    setStageScale(scale);
    setStagePosition({ x, y });
  }), []);
  useEffect(() => () => viewportSync.cancel(), [viewportSync]);

  // Cleanup animation on unmount or sheet change
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (wheelRafRef.current != null) {
        cancelAnimationFrame(wheelRafRef.current);
        wheelRafRef.current = null;
      }
    };
  }, [activeSheetId]);

  // Animate the viewport from current state to a target scale/position over durationMs.
  // Uses requestAnimationFrame with ease-out interpolation. Syncs OSD on every frame.
  // Cancellable via animationFrameRef — any new viewport mutation cancels the running animation.
  // Stop any in-flight smooth-wheel glide and clear its target/anchor.
  const cancelSmoothWheel = useCallback(() => {
    if (wheelRafRef.current != null) {
      cancelAnimationFrame(wheelRafRef.current);
      wheelRafRef.current = null;
    }
    wheelTargetScaleRef.current = null;
    wheelAnchorRef.current = null;
  }, []);

  // One rAF loop that eases the live stage transform toward wheelTargetScaleRef,
  // re-anchored at the cursor every frame so the point under the pointer stays put.
  const stepSmoothWheel = useCallback(() => {
    const stage = stageRef.current;
    const anchor = wheelAnchorRef.current;
    const target = wheelTargetScaleRef.current;
    if (!stage || !anchor || target == null) {
      wheelRafRef.current = null;
      return;
    }

    const now = performance.now();
    const dt = (now - wheelLastFrameRef.current) / 1000;
    wheelLastFrameRef.current = now;

    const current = stage.scaleX();
    let next = dampToward(current, target, dt, WHEEL_SMOOTH_TAU);
    // Snap home once within 0.1% so the loop terminates instead of crawling.
    const done = Math.abs(next - target) / target < 0.001;
    if (done) next = target;

    const pos = clampStagePosition(
      { x: anchor.screenX - anchor.contentX * next, y: anchor.screenY - anchor.contentY * next },
      next,
      layoutRef.current,
      layoutRef.current.stageW,
      layoutRef.current.stageH,
    );

    stage.scale({ x: next, y: next });
    stage.position(pos);
    stage.batchDraw();
    liveViewportRef.current = { scale: next, x: pos.x, y: pos.y };
    viewportSync.push(liveViewportRef.current);

    if (done) {
      wheelRafRef.current = null;
      wheelTargetScaleRef.current = null;
      wheelAnchorRef.current = null;
      viewportSync.flush();
    } else {
      wheelRafRef.current = requestAnimationFrame(stepSmoothWheel);
    }
  }, [viewportSync]);

  const animateViewport = useCallback((targetScale: number, targetPosition: { x: number; y: number }, durationMs: number) => {
    // Cancel any running animation (rAF tween and/or smooth-wheel glide)
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    cancelSmoothWheel();

    const stage = stageRef.current;
    if (!stage) {
      liveViewportRef.current = { scale: targetScale, x: targetPosition.x, y: targetPosition.y };
      setStageScale(targetScale);
      setStagePosition(targetPosition);
      return;
    }

    const startScale = stage.scaleX();
    const startPos = { x: stage.x(), y: stage.y() };
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      // Ease-out cubic: 1 - (1 - t)^3
      const eased = 1 - Math.pow(1 - progress, 3);

      const currentScale = startScale + (targetScale - startScale) * eased;
      const currentPos = {
        x: startPos.x + (targetPosition.x - startPos.x) * eased,
        y: startPos.y + (targetPosition.y - startPos.y) * eased,
      };

      // Direct Konva mutation for 60fps
      stage.scale({ x: currentScale, y: currentScale });
      stage.position(currentPos);
      stage.batchDraw();
      liveViewportRef.current = { scale: currentScale, x: currentPos.x, y: currentPos.y };
      viewportSync.push(liveViewportRef.current);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(step);
      } else {
        // Animation complete — commit the final transform immediately
        animationFrameRef.current = null;
        liveViewportRef.current = { scale: targetScale, x: targetPosition.x, y: targetPosition.y };
        viewportSync.push(liveViewportRef.current);
        viewportSync.flush();
      }
    };

    animationFrameRef.current = requestAnimationFrame(step);
  }, [viewportSync]);

  // ── Mini-map navigation (Phase 5) ────────────────────────────────────────
  // The bottom-right MiniMapOverlay hands back already-projected (unclamped)
  // stage positions; the canvas owns the Konva stage, so clamping + applying
  // live the move here keeps all stage knowledge in one place. Reuse the same
  // primitives as wheel/zoom: clampStagePosition, animateViewport, viewportSync.
  const miniMapRecenter = useCallback((target: { x: number; y: number }) => {
    const scale = liveViewportRef.current.scale;
    const lay = layoutRef.current;
    const clamped = clampStagePosition(target, scale, lay, lay.stageW, lay.stageH);
    animateViewport(scale, clamped, 250);
  }, [animateViewport]);

  const miniMapPanTo = useCallback((target: { x: number; y: number }) => {
    const stage = stageRef.current;
    if (!stage) return;
    const scale = stage.scaleX();
    const lay = layoutRef.current;
    const clamped = clampStagePosition(target, scale, lay, lay.stageW, lay.stageH);
    stage.position(clamped);
    stage.batchDraw();
    liveViewportRef.current = { scale, x: clamped.x, y: clamped.y };
    viewportSync.push(liveViewportRef.current);
  }, [viewportSync]);

  const miniMapPanEnd = useCallback(() => {
    viewportSync.flush();
  }, [viewportSync]);

  const miniMapResize = useCallback((scale: number) => {
    useSettingsStore.getState().setMapSettings({ miniMapScale: scale });
  }, []);

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;

    // Cancel any running viewport animation (e.g., reset view)
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const oldScale = stage.scaleX();
    const intent = classifyWheelIntent(e.evt);

    // Hybrid scroll model: trackpad two-finger scroll pans; mouse wheel and pinch zoom.
    if (intent === 'pan') {
      cancelSmoothWheel();
      const panPos = clampStagePosition(
        { x: stage.x() - e.evt.deltaX, y: stage.y() - e.evt.deltaY },
        oldScale,
        layoutRef.current,
        dimensions.width,
        dimensions.height,
      );
      stage.position(panPos);
      stage.batchDraw();
      liveViewportRef.current = { scale: oldScale, x: panPos.x, y: panPos.y };
      viewportSync.push(liveViewportRef.current);
      return;
    }

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    // Smooth glide path — opt-in, MOUSE WHEEL ONLY. Each notch nudges a target
    // scale (compounding off the live target, not the mid-glide scale) and re-anchors
    // at the cursor; stepSmoothWheel eases toward it. Trackpad pinch stays on the
    // instant path below — its deltas are already small and continuous.
    if (intent === 'zoom-wheel' && smoothWheelZoom) {
      const base = wheelTargetScaleRef.current ?? oldScale;
      const delta = Math.min(Math.abs(e.evt.deltaY), 50);
      const stretch = Math.pow(1.05, delta / 25);
      let target = e.evt.deltaY > 0 ? base / stretch : base * stretch;
      target = Math.max(MIN_SCALE, Math.min(target, MAX_SCALE));
      wheelTargetScaleRef.current = target;
      wheelAnchorRef.current = {
        screenX: pointer.x,
        screenY: pointer.y,
        contentX: (pointer.x - stage.x()) / oldScale,
        contentY: (pointer.y - stage.y()) / oldScale,
      };
      if (wheelRafRef.current == null) {
        wheelLastFrameRef.current = performance.now();
        wheelRafRef.current = requestAnimationFrame(stepSmoothWheel);
      }
      return;
    }

    // Instant path (trackpad pinch, or mouse wheel with smoothing off).
    cancelSmoothWheel();
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    let newScale;
    if (intent === 'zoom-pinch') {
      // True trackpad sensitivity
      newScale = oldScale * Math.exp(-e.evt.deltaY / 100);
    } else {
      // Mouse wheel: smoother inertial friction, capping the max delta
      const delta = Math.min(Math.abs(e.evt.deltaY), 50);
      const stretch = Math.pow(1.05, delta / 25);
      newScale = e.evt.deltaY > 0 ? oldScale / stretch : oldScale * stretch;
    }

    // Scale Clamping
    newScale = Math.max(MIN_SCALE, Math.min(newScale, MAX_SCALE));

    const newPos = clampStagePosition(
      {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      },
      newScale,
      layoutRef.current,
      dimensions.width,
      dimensions.height,
    );

    // Direct Konva Mutation (bypasses React loop for 60fps)
    stage.scale({ x: newScale, y: newScale });
    stage.position(newPos);
    stage.batchDraw();
    liveViewportRef.current = { scale: newScale, x: newPos.x, y: newPos.y };

    // Throttled sync into React state (leading + trailing) so LOD selection and
    // visible-unit culling stay fresh during a sustained gesture.
    viewportSync.push(liveViewportRef.current);
  };

  const handleZoom = (direction: number) => {
    if (!stageRef.current) return;
    const stage = stageRef.current;
    const oldScale = stage.scaleX();
    const scaleBy = 1.2;
    const newScale = Math.max(0.1, Math.min(direction === 1 ? oldScale * scaleBy : oldScale / scaleBy, 15));

    const centerPoint = {
      x: dimensions.width / 2,
      y: dimensions.height / 2
    };

    const mousePointTo = {
      x: (centerPoint.x - stage.x()) / oldScale,
      y: (centerPoint.y - stage.y()) / oldScale,
    };

    const newPos = {
      x: centerPoint.x - mousePointTo.x * newScale,
      y: centerPoint.y - mousePointTo.y * newScale,
    };

    animateViewport(newScale, newPos, 200);
  };

  const resetView = () => {
    animateViewport(1, { x: 0, y: 0 }, 300);
  };

  // Zoom the viewport to fit a specific unit's bounding box at ~70% viewport fill
  const zoomToFit = useCallback((unitId: string) => {
    const unit = units.find(u => u.id === unitId);
    if (!unit?.polygon_coordinates?.length || !layout.drawW || !layout.drawH) return;

    const coords = unit.polygon_coordinates;
    let minPctX = Infinity, maxPctX = -Infinity, minPctY = Infinity, maxPctY = -Infinity;
    coords.forEach(p => {
      if (p.pctX < minPctX) minPctX = p.pctX;
      if (p.pctX > maxPctX) maxPctX = p.pctX;
      if (p.pctY < minPctY) minPctY = p.pctY;
      if (p.pctY > maxPctY) maxPctY = p.pctY;
    });

    // Convert to logical pixel coordinates
    const bboxLeft = layout.offsetX + minPctX * layout.drawW;
    const bboxTop = layout.offsetY + minPctY * layout.drawH;
    const bboxW = (maxPctX - minPctX) * layout.drawW;
    const bboxH = (maxPctY - minPctY) * layout.drawH;

    // Calculate scale to fill 70% of viewport
    const viewW = dimensions.width;
    const viewH = dimensions.height;
    const fitScale = Math.min(viewW / bboxW, viewH / bboxH) * 0.7;
    const clampedScale = Math.max(0.1, Math.min(fitScale, 15));

    // Center the bounding box in the viewport
    const centerX = bboxLeft + bboxW / 2;
    const centerY = bboxTop + bboxH / 2;
    const targetPos = {
      x: viewW / 2 - centerX * clampedScale,
      y: viewH / 2 - centerY * clampedScale,
    };

    animateViewport(clampedScale, targetPos, 350);
  }, [units, layout, dimensions, animateViewport]);

  // Zoom to a specific absolute scale level, centered on the current viewport center
  const zoomToLevel = useCallback((targetScale: number) => {
    if (!stageRef.current) return;
    const stage = stageRef.current;
    const oldScale = stage.scaleX();
    const centerPoint = { x: dimensions.width / 2, y: dimensions.height / 2 };
    const mousePointTo = {
      x: (centerPoint.x - stage.x()) / oldScale,
      y: (centerPoint.y - stage.y()) / oldScale,
    };
    const newPos = {
      x: centerPoint.x - mousePointTo.x * targetScale,
      y: centerPoint.y - mousePointTo.y * targetScale,
    };
    animateViewport(targetScale, newPos, 250);
  }, [dimensions, animateViewport]);

  return {
    /** Throttle-committed React state — drives derived math (culling, LOD, snap strength). */
    stageScale,
    stagePosition,
    /** Freshest Stage transform, written synchronously at every mutation site. */
    liveViewportRef,
    /** Commit pacer — the Stage's own drag handlers push/flush through this too. */
    viewportSync,
    handleWheel,
    animateViewport,
    handleZoom,
    resetView,
    zoomToFit,
    zoomToLevel,
    miniMapRecenter,
    miniMapPanTo,
    miniMapPanEnd,
    miniMapResize,
  };
}
