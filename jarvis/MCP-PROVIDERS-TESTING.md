# Local MCP providers + price tracker — how to use and test them

Four new providers in the MCP Hub run **inside JARVIS**. There is no terminal to
open, no service to start by hand, and no second window to leave running: the
Next.js server spawns and supervises what it needs (see
`src/lib/services/supervisor.ts`).

| Tab | Provider | Runs where |
|---|---|---|
| DuckDB | `duckdb` | In-process, inside the Next.js server |
| Documents | `documents` | `docling-serve` child process, auto-spawned |
| Zotero | `zotero` | Zotero's own local API (or the cloud API) |
| DevTools | `devtools` | `chrome-devtools-mcp` child process, auto-spawned |
| Price tracker | — | Server-owned loop, survives closing the panel |

```bash
cd jarvis
npm run dev            # http://localhost:3000
```

---

## 0. Open the MCP Hub

Two ways, both fine:

- **App Deck** → **MCP Hub** (a switch at the edge of the screen opens the deck).
- **Command bar** → type `3d print` (an existing command that routes here).

You should see ten tabs, the last four being **DuckDB · Documents · Zotero ·
DevTools**.

---

## 1. DuckDB — SQL over your own data

**What it proves:** real SQL answers about real JARVIS data, with no database
server anywhere.

### Try it
1. Click **Attach JARVIS database**. It mounts `prisma/dev.db` **read-only**.
   The button changes to `JARVIS DB attached`.
2. Click the **Memory count by category** preset.
3. You should get a table with rows like `user_fact | 7`.

Then try your own query — for example:

```sql
SELECT title, priority, dueDate FROM jarvis.Task WHERE completed = false LIMIT 20
```

```sql
SELECT category, count(*) AS n FROM jarvis.Memory GROUP BY category ORDER BY n DESC
```

### Things worth checking
- **Only reads are allowed.** Try `DROP TABLE Memory` → you get
  `Only read-only SQL is allowed here…`, not an error page.
- **Two statements at once are refused** (`SELECT 1; SELECT 2`).
- **Your own files work too.** Click **Scan project**, then click any
  `.csv`/`.parquet`/`.json` file to register it as a view and query it.
  In `scratch/` there is an `e2e-sample.csv` you can use.

> Attached databases and registered views live for as long as the server
> process — that is deliberate, so they survive code edits during development.

---

## 2. Documents — PDF/DOCX/XLSX → structured markdown

**What it proves:** JARVIS reads documents locally, keeps table structure, and
tells you honestly which engine ran.

### One-time setup (only if the tab says "not provisioned")

```bash
cd jarvis
uv venv --python 3.12 .jarvis-services/docling-venv
uv pip install --python .jarvis-services/docling-venv/Scripts/python.exe docling-serve
```

The tab shows this exact command when it is needed. It is a large install
(Docling pulls PyTorch and, on first conversion, downloads its layout +
TableFormer models from Hugging Face — measured ~7 minutes on this machine).
JARVIS starts and stops the server itself after that.

### Try it
1. Click **Start Docling** (first start triggers the model download; give it
   time).
2. Put a path in **Local file path** — e.g. the bundled test file:
   `scratch/docling-test.pdf`. Paste it however your OS gives it to you:
   Explorer's **Copy as path** quotes, `file:///…` URLs and `~/…` are all
   cleaned up automatically (this used to fail with a phantom
   `File does not exist: "C:\…"`).
3. Click **Convert**.
4. Check the badges: **engine: docling**, a status, and a timing. The markdown
   keeps structure (`## JARVIS Document Test` rather than a run-on line).
5. **Convert & save .md next to file** writes the markdown beside the source.

### Things worth checking
- **Honest degradation.** With Docling unavailable the panel still converts
  (via `pdf-parse`/`mammoth`) but labels the engine and warns that tables will
  be flattened. It never pretends.
- **A URL** (e.g. an arXiv PDF) works too — that path requires Docling.
- **A missing file** returns a clear `File does not exist` message naming the
  resolved path, whether the file or the whole folder is gone, and listing
  similarly-named files when there are any.

---

## 3. Zotero — your library and your highlights

**What it proves:** JARVIS can read your curated corpus, locally, with no API
key.

### Requirements
- **Local (recommended, no key):** the Zotero desktop app running. In Zotero
  enable **Edit → Settings → Advanced → "Allow other applications on this
  computer to communicate with Zotero"**, otherwise every call 403s.
- **Cloud (fallback):** set `ZOTERO_API_KEY` and `ZOTERO_USER_ID` in `.env.local`.

### Starting Zotero from JARVIS

The tab's button is the fix for the usual failure:

- **Start Zotero** — Zotero is installed but closed. JARVIS launches it and
  waits for its local API, then loads your library.
- **Get Zotero** — Zotero is not installed (JARVIS checks the standard
  locations and says which). The button opens the download page; install it,
  open it once, then press *Start Zotero*. No API key is involved in local mode.

A portable install is handled with `ZOTERO_APP_PATH`.

### Try it
1. Open the **Zotero** tab. The two badges show `local online/offline` and
   `cloud key set/unset`.
2. Your most recent items load automatically. Search with any word from a
   title, author or tag.
3. Click **Highlights** on an item to list its annotations, comments, colours
   and page numbers.

### Things worth checking
- **The panel tells you which source answered.** If neither is available it
  distinguishes *not installed* from *installed but not running* from
  *running but the permission is off* — three problems with three different
  fixes — and only then mentions the cloud route.
- **It is read-only by design** — nothing here modifies your library.

You can also drive it from a shell:

```bash
curl -X POST http://localhost:3000/api/mcp -H "Content-Type: application/json" \
  -d '{"mcp":"zotero","action":"status"}'   # app.installed / canLaunch
curl -X POST http://localhost:3000/api/mcp -H "Content-Type: application/json" \
  -d '{"mcp":"zotero","action":"launch"}'   # starts it and waits for the API
```

---

## 4. DevTools — the inspector surface for JARVIS's browser work

**What it proves:** the Chrome DevTools MCP server is spawned and driven by
JARVIS, and a browser failure can be explained by evidence (console, network,
trace) instead of guesswork.

### Try it
1. Open the **DevTools** tab. The header shows `MCP server connected · N tools`.
2. Type a URL (it defaults to JARVIS's own address) and click **Inspect URL**.
   That chains *navigate → snapshot → console → network*.
3. Click **Available tools** to see the live tool list (about 30), then click
   any tool name to load it into **Raw tool call**.

### Things worth checking
- **It never fails silently.** If navigation times out you get
  `"navigate_page" could not finish loading within the tool's own timeout: …`
  plus the arguments that were used — not a blank panel.
- **You never supply a `pageId`.** 29 of the 30 tools require one; the handler
  resolves it from the live page list and injects it. Omit it and it just works.
- **Unknown tool names list the real ones**, e.g. typing `definitely_not_a_tool`
  returns the available tool names.
- **Privacy defaults:** telemetry to Google and CrUX reporting are disabled.
  Chrome runs headless unless you set `JARVIS_DEVTOOLS_HEADLESS=0`, and it can
  attach to an existing Chrome instead of launching its own via
  `JARVIS_DEVTOOLS_BROWSER_URL`.

---

## 5. Price tracker — keeps working with the panel closed

This was the broken part: prices were held in memory inside the route handler
and only refreshed while the panel was open, so closing the tab stopped all
checks and a server restart reset everything to fabricated "demo" products.

### What it does now
- Products and price history live in the database (`PriceProduct`,
  `PriceSample`), so they survive restarts.
- A **server-owned loop** samples them on its own timer. The panel is a *view*,
  not the engine.
- Prices come from **Keepa** if `KEEPA_API_KEY` is set, otherwise from a real
  read of the product page. If neither yields a number, the product records an
  explicit error — it never invents a price.

### Try it
1. Command bar → **`open price tracker`**.
2. Confirm the status strip: **Background loop running**, the engine in use,
   the interval, and "Keeps running with this panel closed".
3. Add a product **by name** (e.g. `anker usb c cable`) and press **Track** on a
   result, or paste an ASIN / Amazon URL. The price is read from the product
   page when you add it.
4. Click **Check now** to force an immediate refresh.

### Proving it survives the panel closing
1. Note the product count and add something to track.
2. **Close the panel** (and you can close the browser tab entirely).
3. Wait a few minutes, then check the server log for
   `[PriceTracker] sampled N product(s)` and re-open the panel — the history
   keeps growing.

You can also verify it from a shell with no UI involved:

```bash
curl "http://localhost:3000/api/price-tracker?action=status"
# running: true, tickCount climbing, lastTickAt advancing
```

### Things worth checking
- **Amazon may block a read.** You then get
  `Amazon served a bot wall / captcha …` on that product. That is the honest
  outcome; set `KEEPA_API_KEY` for reliable history.
- **A dead ASIN** returns `Could not read the product page …` instead of a
  fake listing. Searching by name avoids dead ASINs entirely.
- **A non-ASIN** is rejected with `That doesn't look like an Amazon ASIN or
  product URL …`.

---

## 6. Run the automated tests

Both suites talk to the **running dev server** — start `npm run dev` first.

```bash
cd jarvis

# Unit level: command routing + pasted-path handling (part of `npm test`)
npm test

# API level: every provider and the price tracker, through the real gateway
node scripts/e2e-mcp-providers.mjs      # 76 checks

# UI level: the MCP Hub tabs, plus "open price tracker" via the command bar
node scripts/e2e-mcp-ui.mjs             # 30 checks
```

Both exit non-zero on failure and print each failing check by name.

Notes:
- The Zotero section of the API suite starts a small stand-in HTTP server on
  `127.0.0.1:23119` and asserts the provider parses the documented API shape.
  It does **not** prove anything about your real library — test that by hand
  with the tab.
- The UI suite drives the price-tracker panel **through the command bar**, which
  is the regression that mattered: the widget matcher read "tracker" as a build
  request and opened the Widgets surface instead. It also asserts the widgets
  surface did *not* open.
- Both scripts take `JARVIS_BASE` if your server is not on
  `http://localhost:3000`.

Also worth running after any change here:

```bash
cd jarvis && npx tsc --noEmit
```

---

## 7. Configuration

Nothing is hardcoded. Everything below has a sensible default and can be set in
`.env.local`:

| Variable | Default | Purpose |
|---|---|---|
| `INTERNAL_API_URL` | `http://localhost:${PORT}` | How server-side code reaches its own API |
| `AMAZON_DOMAIN` | `www.amazon.com` | Storefront to scrape (e.g. `www.amazon.in`) |
| `KEEPA_API_KEY` | — | Use Keepa instead of scraping |
| `KEEPA_DOMAIN` | `1` | Keepa marketplace id |
| `KEEPA_TIMEOUT_MS` | `20000` | Keepa request timeout |
| `PRICE_TICK_MINUTES` | `30` | Per-product sampling interval |
| `PRICE_TICK_BATCH` | `5` | Products sampled per tick |
| `PRICE_MAX_PRODUCTS` | `50` | Tracking cap (enforced server-side) |
| `PRICE_ALERT_COOLDOWN_MINUTES` | `720` | Minimum gap between alerts per product |
| `PRICE_SCRAPE_TIMEOUT_MS` | `75000` | Per-product scrape budget |
| `JARVIS_SERVICES_DIR` | `.jarvis-services` | Where service runtimes are installed |
| `JARVIS_DOCLING_VENV` | `docling-venv` | Venv folder name inside that directory |
| `JARVIS_DOCLING_HOST` / `_PORT` | `127.0.0.1` / `5001` | Where `docling-serve` listens |
| `JARVIS_DOCLING_PYTHON` | venv python | Use a different interpreter |
| `JARVIS_DOCLING_MODULE` | `docling_serve` | Python module that runs the server |
| `JARVIS_DOCLING_READY_MS` | `600000` | Cold-start window (models download on first run) |
| `JARVIS_DOCLING_TIMEOUT_MS` | `600000` | Per-conversion timeout |
| `ZOTERO_LOCAL_URL` | `http://127.0.0.1:23119/api` | Zotero desktop local API |
| `ZOTERO_APP_PATH` | auto-detected | Zotero executable, for a portable install |
| `ZOTERO_API_KEY` / `ZOTERO_USER_ID` | — | Cloud API fallback |
| `JARVIS_DEVTOOLS_BROWSER_URL` | — | Attach to an existing Chrome's debug port |
| `JARVIS_DEVTOOLS_HEADLESS` | `1` | Set `0` for a visible Chrome window |
| `JARVIS_DB_ALIAS` | `jarvis` | Catalog name for the attached database |

---

## 8. Where things live

```
src/lib/services/supervisor.ts      spawn/health/lifecycle for sidecars
src/lib/mcp/stdioClient.ts          managed MCP stdio client (DevTools)
src/lib/mcp/localPaths.ts           pasted-path cleanup (quotes, file://, ~)
src/lib/mcp/duckdbHandler.ts        DuckDB provider
src/lib/mcp/documentsHandler.ts     Docling provider + built-in fallback
src/lib/mcp/zoteroHandler.ts        Zotero provider + app launch
src/lib/mcp/devtoolsHandler.ts      Chrome DevTools provider
src/lib/jarvis/commandRouting.ts    shared routing predicates (unit-tested)
src/services/PriceTrackerService.ts server-owned price loop
src/components/mcp/*Tab.tsx         the four new hub tabs
tests/localPaths.test.ts            path-normalisation regression tests
scripts/e2e-mcp-providers.mjs       API end-to-end suite
scripts/e2e-mcp-ui.mjs              UI end-to-end suite
scratch/<service>.log               per-service stdout/stderr logs
```

If a service misbehaves, its log is the first place to look:
`scratch/docling-serve.log`.
