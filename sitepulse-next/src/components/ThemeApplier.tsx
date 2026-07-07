"use client";
import { useEffect } from 'react';
import { useHydratedStore } from '@/store/useSettingsStore';

// Root-level theme wiring (UI Polish plan, Phase 1). Applies the persisted
// Light/Dark/System setting to <html data-theme> for the WHOLE app — home
// dashboard, project views, and workbench — instead of only inside project
// pages (the effect moved here from project/[projectId]/page.tsx).
//
// Renders nothing; the attribute mutation lives outside React, so there is no
// hydration mismatch. `colorMode` is a persisted read → useHydratedStore.
export default function ThemeApplier() {
  const colorMode = useHydratedStore(s => s.colorMode, 'system');

  useEffect(() => {
    const root = document.documentElement;
    if (colorMode !== 'system') {
      root.setAttribute('data-theme', colorMode);
      return;
    }
    // 'system': follow the OS preference live. Only data-theme="dark" is
    // meaningful in globals.css — removing the attribute renders light.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      if (mq.matches) root.setAttribute('data-theme', 'dark');
      else root.removeAttribute('data-theme');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [colorMode]);

  return null;
}
