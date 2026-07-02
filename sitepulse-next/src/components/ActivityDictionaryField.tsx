'use client';

import { useMemo, useState } from 'react';
import { Link2, Sparkles } from 'lucide-react';
import { useActivityDictionary } from '@/hooks/useActivityDictionary';
import { searchActivityDictionary, resolveActivityByName } from '@/utils/activityDictionary';
import type { ActivityDictionaryEntry } from '@/types/domain';

interface ActivityDictionaryFieldProps {
  /** The activity name being typed. */
  value: string;
  onChange: (name: string) => void;
  /** Reports the explicitly-picked dictionary entry, or null when the text is free-typed. */
  onSelectEntry: (entry: ActivityDictionaryEntry | null) => void;
  /** The currently explicitly-picked entry (owned by the parent), for the link chip. */
  selectedEntry: ActivityDictionaryEntry | null;
  placeholder?: string;
  className?: string;
}

/**
 * A name input backed by the global governed activity dictionary (Scheduling Foundation
 * Slice A, Phase 2). As the user types, it suggests canonical activities matched by name
 * OR alias (so "Rough-Ins" surfaces "MEP Rough-In"); picking one LINKS the new activity to
 * that dictionary entry. Free-typing a name that resolves to no entry stays fully allowed —
 * the parent's add flow proposes it as "Other (pending)" (non-blocking governance). The
 * chip shows whether the current text is Linked (an existing entry, by name or alias) or
 * New (will be proposed). Pure presentation over the warm-cached dictionary; the propose /
 * insert side-effects live in the parent.
 */
export default function ActivityDictionaryField({
  value,
  onChange,
  onSelectEntry,
  selectedEntry,
  placeholder,
  className,
}: ActivityDictionaryFieldProps) {
  const { data: dict = [] } = useActivityDictionary();
  const active = useMemo(() => dict.filter(e => e.status === 'active'), [dict]);
  const [open, setOpen] = useState(false);

  const query = value.trim();
  const matches = useMemo(
    () => (query ? searchActivityDictionary(active, query).slice(0, 8) : []),
    [active, query],
  );
  // Linked if the parent explicitly picked an entry whose name matches the text, OR the
  // text resolves to an entry by name/alias (so an alias typed + Enter still links).
  const resolved = useMemo(() => resolveActivityByName(active, query), [active, query]);
  const linked =
    selectedEntry && selectedEntry.name.trim().toLowerCase() === query.toLowerCase()
      ? selectedEntry
      : resolved;

  const lowerQuery = query.toLowerCase();

  return (
    <div className={`relative flex-1 ${className ?? ''}`}>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => {
          onChange(e.target.value);
          onSelectEntry(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay close so a suggestion click (onClick) fires before blur hides the list.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        className="w-full bg-white dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg pl-3 pr-20 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
      />
      {query && (
        <span
          className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
            linked
              ? 'text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/40'
              : 'text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/40'
          }`}
          title={
            linked
              ? `Linked to the company dictionary entry “${linked.name}”`
              : 'Not in the dictionary yet — adding it will propose it as “Other (pending)”'
          }
        >
          {linked ? <Link2 size={11} /> : <Sparkles size={11} />}
          {linked ? 'Linked' : 'New'}
        </span>
      )}

      {open && query && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-lg">
          {matches.map(entry => {
            const nameHit = entry.name.toLowerCase().includes(lowerQuery);
            const aliasHit = nameHit ? null : entry.aliases.find(a => a.toLowerCase().includes(lowerQuery));
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  // Prevent the input's blur from firing before this click registers.
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    onChange(entry.name);
                    onSelectEntry(entry);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-sky-50 dark:hover:bg-slate-800 flex items-center justify-between gap-2"
                >
                  <span className="truncate text-slate-800 dark:text-slate-200">
                    {entry.name}
                    {aliasHit && (
                      <span className="text-[11px] text-slate-400"> · “{aliasHit}”</span>
                    )}
                  </span>
                  {entry.track && (
                    <span className="text-[10px] text-slate-400 shrink-0">{entry.track}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
