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
The architecture is layered for separation of concerns:

1. **Presentation Layer (UI / Panels / HUD)**
   - Located in `jarvis/src/components`
   - Includes the Arc Reactor UI, command surfaces, and feature panels

2. **App & API Layer (Next.js App Router)**
   - Located in `jarvis/src/app`
   - `page.tsx` drives the primary interface
   - `api/*/route.ts` endpoints expose system functions (chat, research, automation, messaging, tools)

3. **Service Layer**
   - Located in `jarvis/src/services`
   - Encapsulates orchestration logic (research, browser actions, scheduling, mission flows)

4. **Core Library Layer**
   - Located in `jarvis/src/lib`
   - Shared domain utilities for memory, agent logic, security, OS bridges, Telegram/WhatsApp helpers, and more

5. **State Layer**
   - Located in `jarvis/src/store`
   - Central client state (Zustand store)

6. **Data Layer**
   - Located in `jarvis/prisma`
   - Prisma schema + SQLite database models

7. **External Runtime Utilities**
   - Root-level scripts (e.g. `whatsapp-server.js`, setup/debug scripts)
   - Complement the main app for specific integrations

---

## Directory Structure
```text
Jarvis/
├─ README.md
├─ .env.example
├─ whatsapp-server.js
├─ package.json
├─ prisma/                      # Root-level Prisma assets/utilities
├─ jarvis/                      # Main Next.js application workspace
│  ├─ package.json
│  ├─ next.config.mjs
│  ├─ prisma/
│  │  └─ schema.prisma
│  ├─ public/
│  ├─ src/
│  │  ├─ app/                   # Next.js App Router pages + API routes
│  │  ├─ components/            # UI panels, reactor, cinematic modules
│  │  ├─ hooks/                 # Client hooks (voice, gesture, sentinel, etc.)
│  │  ├─ lib/                   # Core logic and integrations
│  │  ├─ services/              # Feature orchestration services
│  │  ├─ store/                 # Zustand state
│  │  └─ types/
│  ├─ tests/                    # App-level test suites
│  └─ docs/
└─ scripts and integration helpers
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
