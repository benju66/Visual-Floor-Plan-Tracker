"use client";
import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface ScopeComboboxProps {
  value: string;
  onChange: (value: string) => void;
  /** Confirm a value — fired on Enter, on picking a suggestion, and (if commitOnBlur) on blur. */
  onCommit?: (value: string) => void;
  /** The pick-list (existing scopes / dictionary track hints). Free-typing is always allowed. */
  suggestions: string[];
  placeholder?: string;
  /** Wrapper className (e.g. width). */
  className?: string;
  /** Override the input classes entirely (defaults to the app's field style). */
  inputClassName?: string;
  autoFocus?: boolean;
  /** Save-on-blur (for inline edits); still fires onCommit. */
  commitOnBlur?: boolean;
}

const DEFAULT_INPUT =
  'w-full bg-white dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg pl-3 pr-8 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500';

/**
 * A Tailwind-styled "pick an existing one or type a new one" combobox (Scheduling UX
 * Hardening) — replaces the native `<datalist>` dropdowns so scope pickers match the rest
 * of the product. Modelled on {@link ActivityDictionaryField}: an input over an absolutely
 * positioned styled list, with the onMouseDown-preventDefault guard so a click registers
 * before blur closes the menu. Free-typing is always allowed; suggestions are a convenience.
 */
export default function ScopeCombobox({
  value,
  onChange,
  onCommit,
  suggestions,
  placeholder,
  className,
  inputClassName,
  autoFocus,
  commitOnBlur,
}: ScopeComboboxProps) {
  const [open, setOpen] = useState(false);

  const q = value.trim().toLowerCase();
  const matches = useMemo(() => {
    const list = q ? suggestions.filter((s) => s.toLowerCase().includes(q)) : suggestions;
    // Drop an exact-match-only suggestion (nothing to pick) but keep partials.
    return list.filter((s) => s.toLowerCase() !== q || list.length > 1).slice(0, 8);
  }, [suggestions, q]);

  const pick = (s: string) => {
    onChange(s);
    onCommit?.(s);
    setOpen(false);
  };

  return (
    <div className={`relative ${className ?? ''}`}>
      <input
        type="text"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onCommit?.(value.trim()); setOpen(false); }
          if (e.key === 'Escape') setOpen(false);
        }}
        onBlur={() => window.setTimeout(() => { setOpen(false); if (commitOnBlur) onCommit?.(value.trim()); }, 120)}
        className={inputClassName ?? DEFAULT_INPUT}
      />
      {suggestions.length > 0 && (
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      )}
      {open && matches.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-lg">
          {matches.map((s) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-800 dark:text-slate-200 hover:bg-sky-50 dark:hover:bg-slate-800 truncate"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
