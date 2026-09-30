# Mission Control — how to drive it, and how to test it

Everything here is for the JARVIS "Mission Control" deck (the panel behind
`mission: …` in the command bar, and `/api/agent`).

```bash
cd jarvis
npm run dev            # http://localhost:3000
```

Open the deck from the command bar by typing `mission: <goal>`, or from the
Missions rail in the panel. Goals are plain natural language — you never say
"playwright", "firecrawl" or "delegate"; the planner picks the engine.

---

## 0. What runs automatically now

| Goal shape | Behaviour |
|---|---|
| Browse / read / research / compare | Auto-runs (fast lane) — no approval |
| Interactive website work (sign in, cart, orders, forms) | Auto-runs; browser steps are LLM-driven |
| Browser sign-in (`browser_login`) | Auto-runs and opens a visible window |
| Browser replay of a saved recording | Auto-runs |
| Runs commands **on your PC** (`shell_command`) | **Approval gate** — the only one left |
| Delegation to specialists | Auto-runs, in parallel |

The panel's composer sends `auto: true` unless the goal looks critical
(shell / install / delete / restart). The server re-checks this — a plan that
contains `shell_command` is always gated, whatever the client asks for.

**Watch browser** (toggle in the composer) opens a real Chromium window for
autonomous browser steps *in addition to* the in-panel live frames. Leave it
off to keep everything headless — you still get the live view in the panel.

---

## 1. Autonomous browser (`browser_act`)

Type these (they auto-append a browser step even if the planner only wanted a
search):

- `Open Amazon in a real browser, search for a USB-C hub under ₹2000, and report the top 3 with prices`
- `Go to the Flipkart page for the Sony WH-1000XM5 and tell me the current price and delivery date`
- `Search Hacker News for the top 3 stories today and read me their titles`
- `Open https://example.com and tell me what the page says`

**What to watch:** step badge `Autonomous browser`, the **Live browser** card
streaming frames (page URL + last action), and a `browser_act` result with the
answer + `n action(s) taken` + a link to the final page.

---

## 2. Sign-in (`browser_login`) — the fixed flow

- `Sign in to LinkedIn, then tell me which of my connections changed jobs this month`
- `Sign in to Amazon and check my orders to tell me what shipped`

**What happens now:** a visible Chromium window opens and **stays open** (up to
3 minutes). Sign in — including 2FA and captchas. JARVIS only declares success
on a real signal:

- a session cookie that is **new or changed** versus the page-load baseline, or
- you left the sign-in page and stayed away (it started on an auth URL).

It never claims success for anonymous cookies (that was the LinkedIn bug: it
used to "succeed" in ~2 s because LinkedIn sets session-ish cookies before you
type anything, then closed the window you needed). If you close the window
first, or the time runs out, the report says **nothing was saved** — and the
next step honestly says it needs credentials.

The profile is stored in `.browser-sessions/mission_<session>/`, so a later
`browser_act` with the same session name is already signed in.

---

## 3. Browser replay

**Record once (panel):**
1. Open Mission Control → **Browser cookbook**.
2. Name it (e.g. `Daily orders`) and paste the starting URL → **Record**.
3. A browser window opens. Click/type the flow you want to automate.
4. **Stop & save**. The steps land in the recording list.

You can also record by voice/chat: say `mission: record a browser workflow`,
but the panel's record button is more reliable for capturing clicks.

**Replay it:**
- Click **run** on the recording in the cookbook, or type
  `Replay my saved browser recording "Daily orders" and tell me what changed`
  or `Run my saved browser recording "Daily orders"`.

**What to watch:** a `Replay recording` step, the live frames for each step,
and a summary like `Replayed "Daily orders" — 12/12 step(s) executed`.
Recordings live in `.jarvis-data/recordings.json` and the run counter
increments each replay.

---

## 4. Supervisor + specialists (`delegate`)

This is **planner-triggered** — there is no button. The planner spawns 2–4
specialists (`researcher`, `browser`, `writer`, `analyst`) when a goal has
clearly separable workstreams. Each specialist plans and runs its own focused
sub-mission, in parallel, with its own tool budget. Results merge into the
mission and feed later steps via `from:<delegateStepId>`.

**How to trigger it:** give a goal with 2+ *distinct* workstreams, ideally
across domains, and a final synthesis step. Good shapes:

- `Research the best mechanical keyboards under 5000, check current prices on two stores, then write me a recommendation and save it to notes`
- `Research the top 3 AI coding assistants, analyse which is best for a college student on a budget, write a short report, and send it to my Telegram`
- `Find the latest NVIDIA GPU and AMD GPU, compare them, and have a writer turn it into a two-minute video brief`
- `Check the weather in Bengaluru, check my Amazon orders, and write a short morning briefing`

**What to watch:** a **Specialist agents** section appears with one card per
specialist showing the role, its sub-goal, each sub-step and its status. The
timeline shows `Delegate agent` steps. Results (and `partial` flags) merge into
the mission report.

**Where it does NOT show up:** trivial one-liners. `find the best free React
course and open it` stays flat (a single search → decide → open chain) — that is
correct behaviour, not a bug. If you want delegation, make the goal genuinely
multi-part.

---

## 5. Video brief

- Panel: **Video brief** button on a finished mission.
- Chat: `make me a video brief`, `turn this into a reel`, or include it in the
  mission: `…and write me a two-minute video brief`.
- Follow-up: `make a video of this`.

It renders a ~20 s cinematic composition (not a slide deck): hook → full-bleed
proof screenshot (Ken Burns) → brief + counters → data bars from real numbers →
findings with whip/glitch/wipe cuts → artifacts → punchline. Every shot has a
camera move; there is a music bed and SFX from the brag asset library, a running
ticker, timecode, film grain and letterbox. **No narration/TTS.**

### Every brief gets a different template

Six themes ship (`neo-cyan` JARVIS HUD · `editorial` · `sunset` · `terminal`
CRT · `luxe` Noir · `kinetic` Poster). A theme changes **palette, typography
(serif / rounded / condensed / mono / Didot), texture (grid / dots / scanlines /
none), letterbox, grain, motion energy, cut style, SFX set and music track** — so
no two briefs look alike.

The pick is remembered in `.jarvis-data/brief-themes.json`: recent looks are
skipped, so back-to-back briefs **never repeat a template**. Force one with
`renderVideoBrief(job, topic, { themeId: "terminal" })` (that skips the rotation).

### The cuts land on the beat

The brag library ships a cue file per track (`assets/music/cues/*.music-cues.json`:
tempo, detected beats, strong cues). Every shot's start is snapped onto that
grid, and the hook holds from the intro bar to the first real beat — so cuts
land on the music instead of drifting over it. The progress bar draws a tick per
beat (bright = strong cue), the gate shows the tempo, and whip cuts flash a
streak. If a cue file is missing, an even 120 bpm grid keeps the rhythm.

### Controls

Click the poster to play (sound starts with the gesture because browsers block
autoplay), `space` pause, `←/→` seek, click to skip ahead, `R` replay, `🔊` mute.
The first sentence of the poster tells you the theme, tempo, cut count and
runtime. Keep `npm run dev` running — audio and full-bleed frames stream from
`/api/agent/brag-asset` and `/api/agent/artifact`.

For a real MP4, hand the generated HTML to the HyperFrames/brag CLI
(`npx hyperframes`) — the composition already follows brag's laws.

---

## 5b. Widgets — "build me a panel that tracks …"

Any of these in the command bar (or by voice) opens the Widgets drawer and
builds the panel:

- `build me a panel that tracks my assignments and crypto`
- `make a widget for my tasks`
- `track bitcoin and ethereum prices`
- `build me a panel that tracks water intake`
- `show my widgets` / `open the dashboard` — opens the drawer without building

Each widget is a small JSON document; JARVIS writes it, you can rewrite anything
on it. `describe it in plain language` in the drawer builds another one.

### Everything is editable

Hit the **✎** on a card to open its editor:

| Field | What you can do |
|---|---|
| **Title / Subtitle** | Rename (blur or Enter saves) |
| **Kind** | `checklist` · `list` · `bars` · `stat` · `counter` · `text` — switch a card's whole shape |
| **Accent** | 5 swatches (cyan/violet/amber/green/rose) |
| **Data** | `typed by me` · `api` (JSON URL + `path` / `labelKey` / `valueKey`) · `tasks` · `notes` |
| **Rows** | Edit label *and* value in place, **↑ ↓ reorder**, **✕ delete one**, **remove all**, add new |

Nothing is hard-coded: rows that came with a generated widget are ordinary rows
you can rewrite or delete. Cards also have ▼/▲ via the editor and a per-card
refresh (`⟳`), plus **＋ blank checklist / counter / scratchpad** chips in the
drawer to start from an empty manual widget — no LLM involved.

> Live rows (`api` / `tasks` / `notes`) are replaced on the next refresh — the
> editor says so. Switch **Data → typed by me** to keep your own rows.

### Closing it

A drawer, not a wall: it slides in from the right, the chat/command bar stays
reachable **above** it, and it closes on **Esc**, on the backdrop, or on the
`✕ esc` button. (The bottom-right HUD rail still mirrors your first six widgets
on the desktop.)

---

## 5c. Second Brain — the memory constellation

- `show my second brain` / `open my knowledge graph` / `what do you remember about me`

Every memory is a star, clustered by type on a slowly orbiting sphere; links are
the connections between them. Pinned memories are bigger and labelled; faded
stars are forgotten (archived) ones.

**Driving it:**

| Action | How |
|---|---|
| Orbit / zoom | drag · scroll (auto-orbit toggle in the header) |
| Focus a memory | click a star, or click a **📌 label** |
| Pin / unpin | `P`, double-click a star, or the card's button |
| Reinforce | `R` — strengthens and bumps recall count |
| Forget | `F`, right-click a star, or the card (tap twice to confirm) |
| Restore | the card's **restore** on a forgotten memory |
| Search | `/` focuses the search; matching stars stay lit |
| Filter by cluster | the left legend (`all memories (n)` + one row per type) |
| Deselect / close | `Esc` (twice if a memory is selected) |

The right-hand card shows type, pinned/forgotten badges, description, memory
strength, links and recalls. Data: `GET/POST /api/memory/graph`
(`pin|unpin|forget|restore|reinforce|cue`). `forget` is a soft archive — it is
always restorable.

### It learns from what you say

Every chat turn is mined for **durable facts** a few seconds after the reply is
sent (deferred, so it never slows the answer):

- `my sister Ananya just started her masters at IISc Bangalore`
  → adds `Ananya` (PERSON), `IISc Bangalore` (LOCATION) and the edges
  `User → sibling_of → Ananya`, `Ananya → studies_at → IISc Bangalore`.
- `Ananya is coming to visit me in Bengaluru next weekend, she loves filter coffee`
  → **upgrades** the existing `Ananya` node (description sharpened, strength
  refreshed) and adds `Bengaluru`, `filter coffee` with new edges. No duplicate.
- `hey` / `ok thanks` / `open youtube and play lofi` → nothing. Social filler and
  one-off commands are filtered out before any model call.

Repeats deepen instead of duplicating: known names are matched exactly (so
"Sam" never merges into "Samsung"), a repeated relationship strengthens its edge,
and re-mentioning a forgotten memory brings it back. Say something about
yourself in the command bar, wait ~10 s, then `show my second brain` — it is
there.

Under the hood: `src/lib/memory/extractor.ts` prompts the shared provider chain
(Gemini → Groq → OpenRouter → NVIDIA) with your last few turns plus the names
already known; `src/lib/memory/learn.ts` is the pure gate deciding what is worth
extracting; `graph.ts` owns the merge (`findEntityExactly`, `reinforceEntity`,
`upsertRelationship`).

---

## 5d. The app dock (top-left)

Sentinel · Telegram · Connected apps · QR teleporter · Proximity radar · Video
director · Room scanner · Whiteboard OCR. These are **home-screen controls**:
they render only when no panel is open, so they never float over a panel or the
conversation. Every one is a true circle (Sentinel included — its state is now
the ring colour, the status dot and the tooltip).

---

## 6. Follow-ups that actually DO things

After a mission finishes, talk to it:

- `send it to my telegram` / `send me the report on telegram` / `dm me this`
  → pushes a plain-text digest to Telegram (real message, ~1–3 KB).
- `save it to a file` / `export this as a markdown file` → writes into
  `jarvis/notes/` (visible in the Notes panel) and registers a mission artifact.
- `add this to my notes` → same, as a note.
- `make me a video brief` → renders and registers the brief.

Action turns answer deterministically (`✅ Sent …`), so the confirmation can
never disagree with what happened. If Telegram isn't reachable you get
`⚠️ Couldn't reach Telegram: …` and the reason (missing token / no registered
chat — message your bot once, then retry).

---

## 7. Complex multi-part commands (copy/paste)

These exercise several engines at once:

1. `Research the best budget noise-cancelling headphones under 8000, extract the specs of the top pick, save it to notes, and send it to my Telegram`
2. `Find today's weather in Bengaluru, play matching music on Spotify, and open today's tech news on YouTube`
3. `Open Amazon in a real browser, find a USB-C hub under ₹2000, screenshot the results, and save the top 3 to a file`
4. `Sign in to LinkedIn, check my connection requests, and write me a summary`
5. `Compare the RTX 5090 and RX 9900 XT on price and performance, pick a winner, and turn it into a video brief`
6. `Research three open-source AI coding agents, rank them for a solo dev, write it up, and DM me the result`
7. `Check my Amazon orders in the browser, then save a list of what shipped to notes`
8. `Replay my saved browser recording "Daily orders", then tell me anything that changed`
9. `Open my project in VS Code and check whether my dev server is running` *(approval gate — command on this PC)*
10. `I have two hours free, set up a focused coding session: open the editor, queue deep-focus music, set a 120-minute timer`

---

## 8. Where things live / troubleshooting

| Thing | Where |
|---|---|
| Missions (durable) | `.jarvis-data/missions.json` |
| Artifacts (shots, briefs, files) | `.jarvis-data/artifacts/<jobId>/` |
| Recordings | `.jarvis-data/recordings.json` |
| Browser profiles | `.browser-sessions/` |
| Notes / saved files | `jarvis/notes/` |
| Live frames | `GET /api/agent/live?jobId=…[&meta=1]` |
| Music + SFX | `.agents/skills/brag/assets/` via `/api/agent/brag-asset` |

- **No live frames?** The frame is only published while a browser step is
  running. Check `/api/agent/live?jobId=…&meta=1` (`active: true` = streaming).
- **Sign-in window closed instantly?** It shouldn't any more. If it does, the
  step's `message` tells you whether a signal fired; `reason` and
  `closedByUser` are on the step result.
- **Specialists never appear?** Re-read §4 — the goal has to be genuinely
  multi-part.
- **Video brief silent?** Click the poster (autoplay policy); audio needs
  `npm run dev` running on the origin the brief was rendered from.
- **Tests:** `npx tsx tests/missionPlan.test.ts`,
  `npx tsx tests/missionRuntime.test.ts`, `npx tsx tests/missionAgents.test.ts`,
  `npx tsx tests/jarvisSurfaces.test.ts` (instant planner, video themes + beat
  sync, widgets, constellation layout), `npx tsx tests/memoryLearn.test.ts`
  (what the assistant decides is worth remembering).
  (`npm test` also runs the pre-existing eye/hand suites, which currently have
  2 unrelated `eyeCalibration` failures.)
- **Widget looks empty?** A live source with no rows keeps the last good rows
  and shows the reason under the card; a `✎` edit always works offline.
- **Second Brain empty?** It needs memories — run a mission, chat, or tell
  JARVIS something about yourself.

---

## 9. Speeding it up / stopping it

- **Instant plans.** Common goals never wait for the planner: weather, `n
  minute timer`, `play X on spotify`, `open youtube and play …`, `find X and open
  it`, `sign in to <known site>`, `price of X`. These are matched locally and
  start immediately (`⚡ Instant plan` in the log). Set `JARVIS_FAST_PLANNER=0` to
  disable. Long or research-heavy goals still go to the LLM.
- **Faster planning.** Provider race stagger is 180 ms with a 12 s ceiling, and
  missions run up to 6 steps in parallel.
- **Live frames don't slow the loop** — screenshots are fire-and-forget.
- **Memory is learned in the background.** Extraction is deferred ~4 s after a
  reply, capped at 12 new nodes / 16 edges per turn, and silently skipped when no
  provider is reachable — it can never block or slow a chat.
- **Abort.** The `abort` button in Mission Control (running strip) or the
  preview's **Discard** cancels cleanly: the in-flight step is not recorded as
  OK, the job settles to `Mission aborted`, and browser automation
  (`browser_act` / `browser_login` / replay) stops between actions instead of
  finishing a task you no longer want.
