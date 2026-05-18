# SitePulse - Next.js Frontend

This is the primary user interface for the SitePulse Visual Floor-Plan Tracker.

## 🏗️ Tech Stack
- **Framework:** Next.js 16 (App Router)
- **Engine:** React 19 / Konva / React-Konva
- **State:** Zustand (Modularized: `useMapStore`, `useUIStore`, `useSettingsStore`)
- **Query:** TanStack React Query v5 (w/ Offline-First IndexedDB Persistence & WebSocket Injection)
- **Icons:** Lucide React
- **Styling:** Tailwind CSS v4

## 🚀 Key Directories
- `src/components`: UI components, including the heavy `<FloorplanCanvas />`.
- `src/hooks`: Custom TanStack Query hooks for high-performance data fetching.
- `src/store`: Zustand stores for local and persisted state.
- `src/app/api/auth/procore`: SSO integration endpoints.

## 🛠️ Getting Started

First, ensure you have the `.env.local` configured with your Supabase credentials and local API URL:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Then, run the development server:
```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## 📱 Mobile Field Workflow

The field-first mobile experience is accessible at viewports under 768px and is optimized for construction field workers.

- **Swipe Card Deck** — Units are presented as a stack of swipeable cards (powered by Framer Motion). Swipe right to advance status, swipe left to skip. Undo/redo controls are available at the bottom of the deck. The deck is **lazy-loaded** via `next/dynamic` so desktop users never download it.
- **Tap-to-Cycle Status Badge** — The main card displays a large, glove-friendly status badge. Tap to cycle through `planned → ongoing → completed`.
- **Inline Segmented Timeline Controls** — Opening the Timeline overlay reveals all project milestones, each with a 4-segment inline status bar (`× | PLN | ONG | ✓`). Tap any segment to set that milestone's status instantly — no accordion expansion, no layout shift. Designed for the iPhone SE (375px) through Pro Max (430px) viewport range.
- **Pending Review Drawer** — All staged changes are batched and reviewable before committing to the database via the Review FAB.
- **Haptic Feedback** — Status changes trigger subtle vibration feedback on supported devices.
- **Persistent Pending Changes** — All staged changes are persisted to IndexedDB via project-scoped keys. Close the browser, reopen it, and your pending work is still there. Gracefully degrades in private browsing.
- **Sync Status Indicator** — A live green/amber dot in the mobile header shows whether all changes are synced or if pending work exists. Includes count badge and pulsing animation during sync.

## 📖 Architecture Notes
Refer to `AGENTS.md` for specific architectural rules and `SUPABASE_SCHEMA.md` for database table definitions.
