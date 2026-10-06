# J.A.R.V.I.S.
### Just A Rather Very Intelligent System

A cinematic, modular AI assistant platform built with **Next.js + TypeScript**. JARVIS combines a rich interactive UI, API-driven automations, local system controls, and multi-service integrations (LLMs, messaging, web automation, and more).

---

## Table of Contents
- [Overview](#overview)
- [Project Architecture](#project-architecture)
- [Directory Structure](#directory-structure)
- [How to Clone or Download](#how-to-clone-or-download)
- [Local Setup](#local-setup)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [Tech Stack](#tech-stack)
- [Notes](#notes)

---

## Overview
JARVIS is organized as a main repository with a dedicated app workspace in `jarvis/`.

It includes:
- A futuristic React/Next.js frontend with multiple operational panels
- A large set of server routes under `src/app/api/*` for assistant features
- Service and integration layers for research, browser automation, scheduling, and messaging
- Prisma + SQLite persistence for memory, tasks, reports, reminders, and automations
- Optional WhatsApp server bridge for persistent messaging connectivity

---

## Project Architecture
The system is organized in layered modules with a shared integration surface:

```mermaid
flowchart TD
  U[User / Operator] --> UI[Presentation Layer\n`jarvis/src/components`\nHUD, panels, widgets, cinematic UI]
  UI --> APP[App Router Layer\n`jarvis/src/app`\nPages + API routes]
  APP --> SRV[Service Orchestration Layer\n`jarvis/src/services`\nResearch, automation, mission, media]
  SRV --> LIB[Core Library Layer\n`jarvis/src/lib`\nMemory, agent/runtime logic, OS bridges,\nsecurity, messaging, integrations]
  UI <--> ST[Client State Layer\n`jarvis/src/store`\nZustand]
  APP --> DATA[Data Layer\n`jarvis/prisma`\nPrisma schema + SQLite]
  LIB --> EXT[External Systems\nLLM providers, Telegram, WhatsApp,\nSpotify, browser/desktop tooling]
  ROOT[Root Runtime Utilities\n`*.js` / `*.bat` at repo root] --> APP
  ROOT --> EXT
```

### Architecture Mapping
- **Presentation Layer**: `jarvis/src/components/*` (reactor, panels, cinematic surfaces, control overlays)
- **Routing + API Layer**: `jarvis/src/app/*` (UI routes + `api/*/route.ts` server handlers)
- **Service Layer**: `jarvis/src/services/*` (orchestration and workflow composition)
- **Core Library Layer**: `jarvis/src/lib/*` (shared domain modules and integration clients)
- **State Layer**: `jarvis/src/store/jarvis.store.ts`
- **Data Layer**: `jarvis/prisma/schema.prisma` + migrations
- **Runtime Utility Layer**: root scripts and helper entry points (server bridges, debug/bootstrap scripts)

---

## Directory Structure
```text
Jarvis/
├─ .agents/                     # Local agent skills and support assets
├─ README.md
├─ .env.example
├─ package.json
├─ package-lock.json
├─ prisma/                      # Root-level Prisma schema/assets
├─ whatsapp-server.js           # Optional WhatsApp bridge server
├─ *.bat                        # Windows bootstrap and workflow helpers
├─ test-*.js                    # Root integration/debug test scripts
├─ jarvis/                      # Main Next.js application workspace
│  ├─ package.json
│  ├─ next.config.mjs
│  ├─ docs/                     # App-specific design/ops notes
│  ├─ scripts/                  # App automation/e2e helper scripts
│  ├─ scratch/                  # Local experiments and diagnostics
│  ├─ notes/                    # User notes and generated text artifacts
│  ├─ prisma/
│  │  ├─ schema.prisma
│  │  └─ migrations/
│  ├─ public/                   # Static assets, vision/model artifacts
│  ├─ src/
│  │  ├─ app/                   # App Router pages + API route handlers
│  │  ├─ components/            # UI panels, HUD, reactor, cinematic modules
│  │  ├─ hooks/                 # Client hooks (voice, gesture, sentinel, etc.)
│  │  ├─ lib/                   # Core runtime logic and integrations
│  │  ├─ services/              # Feature orchestration services
│  │  ├─ store/                 # Zustand state
│  │  └─ types/
│  ├─ tests/                    # App-level test suites
│  └─ tsconfig.json
└─ debug and integration helpers at repository root
```

---

## How to Clone or Download
### Option A — Clone with Git (recommended)
```bash
git clone https://github.com/juug24btech22417-del/Jarvis.git
cd Jarvis
```

### Option B — Download ZIP
1. Open the repository on GitHub.
2. Click **Code** → **Download ZIP**.
3. Extract the archive.
4. Open a terminal in the extracted `Jarvis` folder.

---

## Local Setup
> Main app commands run from the `jarvis/` directory.

1. Install root dependencies (for root utilities):
```bash
npm install
```

2. Move into the app workspace and install app dependencies:
```bash
cd jarvis
npm install
```

3. Create local environment file:
```bash
cp ../.env.example .env.local
```
> On Windows PowerShell:
```powershell
Copy-Item ..\.env.example .env.local
```

4. Configure `.env.local` with your API keys and credentials.

5. Initialize database:
```bash
npx prisma db push
```

6. Start development server:
```bash
npm run dev
```

7. Open:
- `http://localhost:3000` (default Next.js dev port)

---

## Environment Variables
The template is in `.env.example` (repository root).

Key groups:
- **Core**: app URL
- **Web Intelligence**: Firecrawl, Tavily
- **AI Models**: OpenAI, Gemini, Anthropic, Hugging Face
- **Communication**: WhatsApp, Telegram
- **Services**: Spotify, Instagram
- **Database**: `DATABASE_URL` (SQLite)

Never commit real secrets.

---

## Available Scripts
From `jarvis/`:
- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run start` — run production build
- `npm run lint` — run lint checks
- `npm run test` — run test suites
- `npm run hotkey` — start PowerShell hotkey listener
- `npm run clipboard` — start clipboard watcher
- `npm run whatsapp:server` — launch root WhatsApp bridge (`../whatsapp-server.js`)

---

## Tech Stack
- **Frontend/App**: Next.js 14, React 18, TypeScript
- **Styling/UX**: Tailwind CSS, Framer Motion, Three.js / React Three Fiber
- **State**: Zustand
- **Data**: Prisma + SQLite
- **Automation/Integrations**: Playwright, Firecrawl, Telegram, WhatsApp Web
- **AI Integrations**: OpenAI, Gemini, Anthropic, Hugging Face

---

## Notes
- This repository contains both the main app (`jarvis/`) and root-level integration scripts.
- Some integrations require platform-specific tools (especially certain Windows/PowerShell flows).
- If optional integrations are not configured, core UI/dev workflows can still run.

---

Built for an ambitious, modular AI assistant experience.
