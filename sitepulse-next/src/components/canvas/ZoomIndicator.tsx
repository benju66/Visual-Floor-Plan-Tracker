"use client";
import React, { useState, useRef, useEffect } from 'react';

export interface ZoomIndicatorProps {
  stageScale: number;
  onZoomToLevel: (scale: number) => void;
  onFitToView: () => void;
}

const PRESETS = [
  { label: 'Fit to View', scale: null as number | null },
  { label: '50%', scale: 0.5 },
  { label: '100%', scale: 1 },
  { label: '200%', scale: 2 },
  { label: '400%', scale: 4 },
];

export default function ZoomIndicator({ stageScale, onZoomToLevel, onFitToView }: ZoomIndicatorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click, scroll, or pointer down
  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    window.addEventListener('pointerdown', close, { capture: true });
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', close, { capture: true });
      window.removeEventListener('wheel', close);
    };
  }, [isOpen]);

  const percentage = Math.round(stageScale * 100);

  return (
    <div
      ref={dropdownRef}
      className="absolute bottom-3 right-3 z-20 pointer-events-auto select-none"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Preset dropdown */}
      {isOpen && (
        <div
          className="absolute bottom-full right-0 mb-1.5 rounded-xl border shadow-xl backdrop-blur-md overflow-hidden min-w-[140px]"
          style={{
            background: 'var(--glass-bg, rgba(255, 255, 255, 0.95))',
            borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.5))',
          }}
        >
          {PRESETS.map(({ label, scale }) => {
            const isActive = scale !== null && Math.abs(stageScale - scale) < 0.01;
            return (
              <button
                key={label}
                type="button"
                className={`w-full text-left px-3.5 py-2 text-sm transition-colors
                  ${isActive
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-white/10'
                  }`}
                onClick={() => {
                  if (scale === null) {
                    onFitToView();
                  } else {
                    onZoomToLevel(scale);
                  }
                  setIsOpen(false);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Zoom pill */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-1.5 rounded-xl border shadow-lg backdrop-blur-md text-xs font-semibold tabular-nums transition-all hover:scale-105 active:scale-95"
        style={{
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.9))',
          borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.5))',
          color: 'var(--text, #475569)',
        }}
        title="Click to select zoom level"
      >
        {percentage}%
      </button>
    </div>
  );
}
