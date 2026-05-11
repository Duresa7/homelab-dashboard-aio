# Homelab Dashboard

A centralized dashboard for monitoring a homelab — UniFi network, Proxmox VMs, Docker containers, UNAS storage, GPU/CPU telemetry, alerts, and events.

## Stack

- **Frontend:** Vite + React 18 + TypeScript — fast HMR, type-safe components, single-bundle SPA
- **Backend:** Express proxy server — authenticates with the UniFi Integration API and serves normalized telemetry to the frontend
- **Styling:** Pure CSS with custom properties (no Tailwind / no UI framework). Themes & aesthetics swap via `data-*` attributes on `<html>`

## Setup

```bash
cp .env.example .env
# Edit .env with your UniFi controller URL and API key
npm install
```

## Run

```bash
# Terminal 1 — backend proxy
npm run server

# Terminal 2 — frontend dev server
npm run dev          # http://localhost:5173
```

## Folder Structure

```
├── src/                   Frontend (React + TypeScript)
│   ├── components/
│   │   ├── charts/        SVG primitives (Sparkline, AreaChart, Donut, Gauge)
│   │   ├── icons/         Inline stroke icons
│   │   ├── layout/        Sidebar, Topbar, Clock, AlertBanner
│   │   ├── tile/          Tile chrome + ExpandOverlay focus modal
│   │   └── widgets/       One file per dashboard tile + tile registry
│   ├── lib/
│   │   ├── telemetry.ts   Live data fetcher + useDashData hook
│   │   └── tweaks.tsx     useTweaks + floating TweaksPanel + form controls
│   ├── pages/             One per route: Overview, Proxmox, Network, Docker, Storage, Events, Alerts
│   ├── styles/            globals.css (tokens, themes) + components.css
│   ├── types/             Shared TypeScript interfaces
│   ├── App.tsx            Shell: sidebar + topbar + routing + tweaks panel
│   └── main.tsx           Entry point
│
├── server/                Backend (Express)
│   └── index.js           UniFi API proxy with caching + normalization
│
├── docs/                  Reference documentation (UniFi API docs, screenshots)
│
├── index.html             Vite entry
├── vite.config.ts         Vite config (proxies /api to backend)
├── tsconfig.json          TypeScript config
├── package.json
├── .env.example           Required environment variables template
└── .gitignore
```

## Features

- **Aesthetics:** Refined Minimal, Terminal, Editorial, Neon
- **Theme:** Light / Dark / Auto (matches system)
- **Density:** Compact / Regular / Comfy
- **Per-tile chart picker:** Area / Sparkline / Bars
- **Expandable tiles:** Focus overlay (Esc to close)
- **Configurable overview:** Pick which tiles appear via the Tweaks panel
- **Live UniFi telemetry:** Gateway stats, switches, APs, clients, WAN throughput, firewall, VPN, DNS
