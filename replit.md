# girl-agent WebUI

Telegram AI persona engine web interface — manage AI agent profiles, view logs, configure LLM settings, and control agent lifecycle.

## Run & Operate

- `pnpm --filter @workspace/girl-agent run dev` — run the WebUI frontend (port 21889)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 18 + Vite, Zustand state management, custom CSS (no Tailwind in UI)
- The WebUI talks to a backend API server (not included here — runs separately)

## Where things live

- `artifacts/girl-agent/` — the WebUI React+Vite artifact
- `artifacts/girl-agent/src/App.tsx` — root component, tab-based routing
- `artifacts/girl-agent/src/lib/store.ts` — Zustand store (all app state)
- `artifacts/girl-agent/src/lib/api.ts` — typed API client + WebSocket helpers
- `artifacts/girl-agent/src/styles.css` — the main CSS file with bone/ink palette variables
- `artifacts/girl-agent/src/pages/` — page components (Logs, Config, Memory, Addons, etc.)
- `artifacts/girl-agent/src/components/` — shared UI (Sidebar, Topbar, AuthGate, etc.)

## Architecture decisions

- The UI uses a custom CSS system (not Tailwind/shadcn), based on `--bone`/`--ink`/`--accent` CSS variables with `data-theme="dark"` attribute on `<html>`
- State management via Zustand (`useStore`) — single store in `src/lib/store.ts`
- All API calls go to `/api/*` (proxied by the Replit shared proxy to the backend)
- WebSocket connections for live logs/status via `/ws/logs/:slug` and `/ws/status/:slug`
- The backend server (girl-agent server) is a separate Node.js process not running in this Replit — the frontend will show 502 errors on API calls until connected

## Product

- Login screen (auth gate) — optional password from `GIRL_AGENT_WEBUI_PASSWORD`
- Profile picker — switch between multiple Telegram AI agent profiles
- Logs page — live log streaming + historical log file browser
- Configuration page — full LLM and Telegram config editing
- Memory page — file editor for agent memory files
- Addons page — install/manage plugins for the agent
- Assistant page — AI chat assistant for configuring the agent
- Relationship page — view the emotional relationship scores
- Diagnostics page — system info and health

## Gotchas

- The `styles.css` is the source of truth for CSS — do NOT use Tailwind classes in webui components
- `index.css` (Tailwind scaffold) is not imported by `main.tsx` — only `styles.css` is
- The `data-theme="dark"` attribute on `<html>` controls the dark/light theme via CSS vars
- API calls return 502 unless a running girl-agent backend is connected on `/api`
