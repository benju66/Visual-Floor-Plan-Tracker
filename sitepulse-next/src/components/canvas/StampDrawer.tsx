import React, { useMemo, useState } from 'react';
import { Stamp, ChevronDown, X, Check, Pencil, Bookmark } from 'lucide-react';
import { useMapStore } from '@/store/useMapStore';
import { useSettingsStore, useHydratedStore } from '@/store/useSettingsStore';
import { normalizeToCentroid } from '@/utils/stampTransform';
import { EMPTY_STAMP_LIBRARY, type StampDef } from '@/utils/stampLibrary';
import type { Unit, PercentPoint } from '@/types/domain';

// Stamp & Fast Markup — Phase 2. The stamp drawer: a bottom strip of your recently-used
// shapes plus the ones you've pinned. Click a thumbnail to ARM it, then drop copies on
// the plan with NO room selected. Persisted in this browser (localStorage via
// `useSettingsStore`); the placement math + armed-stamp wiring live in FloorplanCanvas.
// This component only reads the library, arms a stamp, and manages save/rename/remove.

export interface StampDrawerProps {
  /** The active sheet's units — used to build a stamp from the selected room. */
  units: Unit[];
}

/** A tiny SVG thumbnail of a (centroid-normalized) shape, fit into a 100×100 box. */
function StampThumbnail({ points, size = 40 }: { points: PercentPoint[]; size?: number }) {
  const path = useMemo(() => {
    if (!points || points.length < 2) return null;
    const xs = points.map((p) => p.pctX);
    const ys = points.map((p) => p.pctY);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = Math.max(maxX - minX, 1e-6);
    const h = Math.max(maxY - minY, 1e-6);
    const pad = 0.14;
    // Preserve aspect: one scale for both axes (uses the larger extent), then center.
    const scale = (1 - pad * 2) / Math.max(w, h);
    const offX = (1 - w * scale) / 2;
    const offY = (1 - h * scale) / 2;
    return points
      .map((p) => `${((p.pctX - minX) * scale + offX) * 100},${((p.pctY - minY) * scale + offY) * 100}`)
      .join(' ');
  }, [points]);

  if (!path) return null;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <polygon points={path} fill="rgba(139,92,246,0.22)" stroke="#8b5cf6" strokeWidth={4} strokeLinejoin="round" />
    </svg>
  );
}

export default function StampDrawer({ units }: StampDrawerProps) {
  const stampLibrary = useHydratedStore((s) => s.stampLibrary, EMPTY_STAMP_LIBRARY);
  const saveStampToLibrary = useSettingsStore((s) => s.saveStampToLibrary);
  const removeSavedStamp = useSettingsStore((s) => s.removeSavedStamp);
  const renameSavedStamp = useSettingsStore((s) => s.renameSavedStamp);

  // Stamp & Fast Markup — Phase 3: "Name each stamp" — when ON, each drop opens the
  // name + type box (pre-filled) instead of dropping instantly, then re-arms. Persisted
  // in mapSettings; read via useHydratedStore to avoid an SSR hydration mismatch.
  const setMapSettings = useSettingsStore((s) => s.setMapSettings);
  const nameEachStamp = useHydratedStore((s) => s.mapSettings.nameEachStamp ?? false, false);

  const armedStamp = useMapStore((s) => s.armedStamp);
  const armStamp = useMapStore((s) => s.armStamp);
  const clearArmedStamp = useMapStore((s) => s.clearArmedStamp);
  const stampDrawerOpen = useMapStore((s) => s.stampDrawerOpen);
  const setStampDrawerOpen = useMapStore((s) => s.setStampDrawerOpen);
  const selectedUnitIds = useMapStore((s) => s.selectedUnitIds);

  // Inline "name this stamp" + "rename" editors (local, transient text only).
  const [savingName, setSavingName] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const { recents, saved } = stampLibrary;
  const total = recents.length + saved.length;

  // The shape "Save as stamp" would pin: the armed drawer stamp, else the single selected
  // room. Null when neither is available (button disabled).
  const source = useMemo((): Pick<StampDef, 'name' | 'points' | 'subtypeId' | 'unitType'> | null => {
    if (armedStamp) {
      return { name: armedStamp.name, points: armedStamp.points, subtypeId: armedStamp.subtypeId ?? null, unitType: armedStamp.unitType ?? null };
    }
    if (selectedUnitIds.length === 1) {
      const u = units.find((x) => x.id === selectedUnitIds[0]);
      const poly = u?.polygon_coordinates;
      if (u && poly && poly.length >= 3) {
        return { name: u.unit_number, points: normalizeToCentroid(poly), subtypeId: u.subtype_id ?? null, unitType: u.unit_type ?? null };
      }
    }
    return null;
  }, [armedStamp, selectedUnitIds, units]);

  const handleArm = (stamp: StampDef) => {
    if (armedStamp?.id === stamp.id) clearArmedStamp();
    else armStamp(stamp);
  };

  const beginSave = () => {
    if (!source) return;
    setSavingName(source.name || 'Stamp');
  };

  const commitSave = () => {
    if (!source || savingName === null) return;
    const name = savingName.trim() || 'Stamp';
    saveStampToLibrary({
      id: crypto.randomUUID(),
      name,
      points: source.points,
      subtypeId: source.subtypeId ?? null,
      unitType: source.unitType ?? null,
      createdAt: new Date().toISOString(),
    });
    setSavingName(null);
  };

  const beginRename = (stamp: StampDef) => {
    setRenamingId(stamp.id);
    setRenameValue(stamp.name);
  };

  const commitRename = () => {
    if (renamingId) renameSavedStamp(renamingId, renameValue.trim() || 'Stamp');
    setRenamingId(null);
    setRenameValue('');
  };

  const glass = {
    background: 'var(--glass-bg, rgba(255, 255, 255, 0.7))',
    borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.5))',
  } as React.CSSProperties;

  // Collapsed: a small pill that reveals the drawer. Always available so the feature is
  // discoverable even before anything's been stamped.
  if (!stampDrawerOpen) {
    return (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
        <button
          type="button"
          onClick={() => setStampDrawerOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 rounded-2xl border shadow-xl backdrop-blur-md text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-white/40 dark:hover:bg-white/10 transition-colors"
          style={glass}
          title="Open the stamp drawer"
        >
          <Stamp size={16} className="text-fuchsia-500" />
          Stamps
          {total > 0 && (
            <span className="min-w-[1.25rem] text-center rounded-full bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300 text-[11px] font-bold px-1.5 py-0.5">
              {total}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto max-w-[min(92vw,880px)] rounded-2xl border shadow-xl backdrop-blur-md"
      style={glass}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <Stamp size={13} className="text-fuchsia-500" />
          Stamp Drawer
          {armedStamp && (
            <span className="normal-case tracking-normal text-fuchsia-600 dark:text-fuchsia-300 font-semibold">
              — placing “{armedStamp.name}”, click the plan to drop
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Phase 3: flip ON to name + type each stamp as you drop it (then it re-arms). */}
          <button
            type="button"
            role="switch"
            aria-checked={nameEachStamp}
            onClick={() => setMapSettings({ nameEachStamp: !nameEachStamp })}
            className="flex items-center gap-1.5 select-none normal-case tracking-normal text-[11px] font-semibold text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-slate-100 transition-colors"
            title={nameEachStamp
              ? 'Naming each stamp — each drop opens the name/type box, then re-arms. Click to stamp instantly instead.'
              : 'Stamping instantly (auto-named). Click to name + set the type on each drop.'}
          >
            <span
              className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                nameEachStamp ? 'bg-fuchsia-500' : 'bg-slate-300 dark:bg-slate-600'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                  nameEachStamp ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </span>
            Name each stamp
          </button>
          <button
            type="button"
            onClick={() => setStampDrawerOpen(false)}
            className="p-1 rounded-lg text-slate-500 hover:bg-white/40 dark:text-slate-300 dark:hover:bg-white/10 transition-colors"
            title="Close drawer"
          >
            <ChevronDown size={16} />
          </button>
        </div>
      </div>

      <div className="flex items-stretch gap-3 px-3 pb-3 overflow-x-auto overscroll-contain">
        {total === 0 && savingName === null && (
          <div className="text-xs text-slate-500 dark:text-slate-400 py-4 px-2 max-w-md">
            Stamp a room or draw a shape and it shows up here automatically. Select a room and
            press <span className="font-semibold">Save as stamp</span> to pin one for reuse.
          </div>
        )}

        {recents.length > 0 && (
          <Section label="Recent">
            {recents.map((stamp) => (
              <ThumbButton key={stamp.id} stamp={stamp} armed={armedStamp?.id === stamp.id} onArm={handleArm} />
            ))}
          </Section>
        )}

        {saved.length > 0 && (
          <Section label="Saved" divider={recents.length > 0}>
            {saved.map((stamp) => (
              <div key={stamp.id} className="relative group flex flex-col items-center">
                {renamingId === stamp.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                      if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null); }
                    }}
                    className="w-20 mt-1 text-[11px] px-1.5 py-1 rounded-md border border-slate-300 dark:border-white/20 bg-white/90 dark:bg-slate-800 text-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-fuchsia-400"
                  />
                ) : (
                  <>
                    <ThumbButton stamp={stamp} armed={armedStamp?.id === stamp.id} onArm={handleArm} />
                    <div className="flex items-center gap-1 absolute -top-1.5 -right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => beginRename(stamp)}
                        className="p-0.5 rounded-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-white/20 text-slate-500 dark:text-slate-300 shadow-sm hover:text-fuchsia-500"
                        title="Rename stamp"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (armedStamp?.id === stamp.id) clearArmedStamp(); removeSavedStamp(stamp.id); }}
                        className="p-0.5 rounded-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-white/20 text-slate-500 dark:text-slate-300 shadow-sm hover:text-red-500"
                        title="Remove stamp"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </Section>
        )}

        {/* Save-as-stamp: pins the armed stamp or the single selected room. */}
        <div className="flex flex-col justify-center pl-1 border-l border-slate-200/70 dark:border-white/10 shrink-0">
          {savingName === null ? (
            <button
              type="button"
              onClick={beginSave}
              disabled={!source}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-fuchsia-600 dark:text-fuchsia-300 enabled:hover:bg-fuchsia-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              title={source ? 'Save this shape as a reusable stamp' : 'Select a room or arm a stamp first'}
            >
              <Bookmark size={14} /> Save as stamp
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={savingName}
                onChange={(e) => setSavingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitSave(); }
                  if (e.key === 'Escape') { e.preventDefault(); setSavingName(null); }
                }}
                placeholder="Stamp name"
                className="w-28 text-xs px-2 py-1.5 rounded-lg border border-slate-300 dark:border-white/20 bg-white/90 dark:bg-slate-800 text-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-fuchsia-400"
              />
              <button
                type="button"
                onClick={commitSave}
                className="p-1.5 rounded-lg bg-fuchsia-500 text-white hover:bg-fuchsia-600 transition-colors"
                title="Save"
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                onClick={() => setSavingName(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-white/40 dark:text-slate-300 dark:hover:bg-white/10 transition-colors"
                title="Cancel"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ label, children, divider = false }: { label: string; children: React.ReactNode; divider?: boolean }) {
  return (
    <div className={`flex flex-col shrink-0${divider ? ' pl-3 border-l border-slate-200/70 dark:border-white/10' : ''}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1 px-0.5">{label}</div>
      <div className="flex items-start gap-2">{children}</div>
    </div>
  );
}

function ThumbButton({ stamp, armed, onArm }: { stamp: StampDef; armed: boolean; onArm: (s: StampDef) => void }) {
  return (
    <button
      type="button"
      onClick={() => onArm(stamp)}
      className={`flex flex-col items-center gap-0.5 p-1.5 rounded-xl border transition-all ${
        armed
          ? 'border-fuchsia-400 bg-fuchsia-500/10 ring-2 ring-fuchsia-400/50'
          : 'border-transparent hover:bg-white/50 dark:hover:bg-white/10'
      }`}
      title={armed ? `Placing “${stamp.name}” — click to stop` : `Stamp “${stamp.name}”`}
    >
      <StampThumbnail points={stamp.points} />
      <span className="w-12 truncate text-center text-[10px] leading-tight text-slate-600 dark:text-slate-300">{stamp.name}</span>
    </button>
  );
}
