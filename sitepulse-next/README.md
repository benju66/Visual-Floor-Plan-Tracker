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

## 📖 Architecture Notes
Refer to `AGENTS.md` for specific architectural rules and `SUPABASE_SCHEMA.md` for database table definitions.
