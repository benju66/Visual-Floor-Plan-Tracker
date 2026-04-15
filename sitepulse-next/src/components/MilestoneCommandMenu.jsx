"use client";
import React, { useEffect } from 'react';
import { Command } from 'cmdk';

/** Command palette for milestones; Cmd/Ctrl+K toggles from parent. */
export default function MilestoneCommandMenu({
  open,
  onOpenChange,
  onSelect,
  title = 'Set status',
  description,
  milestones = [],
}) {
  useEffect(() => {
    if (!open) return;
    const down = (e) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center pt-[15vh] px-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden glass-panel"
        style={{
          background: 'var(--glass-bg)',
          borderColor: 'var(--glass-border)',
          boxShadow: 'var(--glass-shadow)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Command className="text-slate-800 dark:text-slate-100">
          <div className="border-b border-slate-200/60 dark:border-white/10 px-3 py-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</p>
            {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
            <Command.Input
              placeholder="Search milestones (e.g. MEP, Punch)…"
              className="mt-2 w-full rounded-xl border border-slate-200/80 dark:border-white/10 bg-white/50 dark:bg-black/20 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>
          <Command.List className="max-h-[min(50vh,360px)] overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-slate-500">No matches.</Command.Empty>
            <Command.Group heading="Milestones" className="text-[10px] font-bold text-slate-400 uppercase px-2 py-1">
              {milestones.map((m) => (
                <Command.Item
                  key={m.id}
                  value={`${m.name} ${m.id}`}
                  onSelect={() => {
                    onSelect(m);
                    onOpenChange(false);
                  }}
                  className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm data-[selected=true]:bg-blue-500/15 data-[selected=true]:text-blue-800 dark:data-[selected=true]:text-blue-200"
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white/50 shadow"
                    style={{ background: m.color }}
                  />
                  <span className="truncate">{m.name}</span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
          <p className="border-t border-slate-200/60 dark:border-white/10 px-3 py-2 text-[10px] text-slate-400">
            <kbd className="rounded bg-slate-200/80 dark:bg-white/10 px-1">Enter</kbd> select ·{' '}
            <kbd className="rounded bg-slate-200/80 dark:bg-white/10 px-1">Esc</kbd> close
          </p>
        </Command>
      </div>
    </div>
  );
}

