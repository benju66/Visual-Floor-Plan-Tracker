"use client";
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface AnchoredMenuProps {
  open: boolean;
  anchorRect: DOMRect | null;
  onClose: () => void;
  children: React.ReactNode;
  /** Menu width in px (used for right-alignment + viewport clamping). */
  width?: number;
}

/**
 * A lightweight dropdown rendered in a portal with fixed positioning, anchored to a
 * trigger's bounding rect. Portaling + fixed avoids clipping by the table's
 * `overflow-auto` scroll container. Closes on backdrop click, Escape, or scroll.
 */
export default function AnchoredMenu({ open, anchorRect, onClose, children, width = 200 }: AnchoredMenuProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, onClose]);

  if (!open || !mounted || !anchorRect || typeof document === 'undefined') return null;

  const margin = 8;
  const left = Math.min(Math.max(anchorRect.right - width, margin), window.innerWidth - width - margin);
  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - margin);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[90]" onClick={onClose} />
      <div
        role="menu"
        className="fixed z-[91] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100"
        style={{ top, left, width, maxHeight: 'min(360px, 80vh)', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body
  );
}

/** Standard menu item row. */
export function MenuItem({
  icon,
  label,
  onClick,
  danger,
  trailing,
}: {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-left transition-colors ${
        danger
          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30'
          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
      }`}
    >
      {icon && <span className="shrink-0 w-4 flex items-center justify-center">{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}
