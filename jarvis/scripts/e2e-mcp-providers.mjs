// End-to-end test for the local MCP providers (duckdb / documents / zotero /
// devtools) plus the server-owned price tracker.
//
// These talk to the REAL dev server over HTTP — no module imports, no mocks of
// JARVIS itself — because the thing worth proving is that the providers work
// through the same gateway the UI uses.
//
// One deliberate exception: Zotero. Its positive path needs the Zotero desktop
// app (or a cloud API key) which a test machine may not have, so this script
// starts a tiny HTTP server that speaks Zotero's documented Web API shape on
// 127.0.0.1:23119, then asserts the provider parses it correctly. That tests
// our request paths and item shaping; it does NOT prove anything about a real
// library. The script says which is which in its output.
//
// Run:  node scripts/e2e-mcp-providers.mjs
// Requires the dev server at http://localhost:3000.

import http from "http";
import fs from "fs";
import path from "path";

const BASE = process.env.JARVIS_BASE || "http://localhost:3000";
let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(t) {
  console.log(`\n${t}`);
}

/**
 * Write a minimal, valid one-page PDF.
 *
 * `scratch/` is gitignored, so a checked-in fixture would not survive a fresh
 * clone and this case would silently skip. Generating it here keeps the suite
 * self-contained: it always has a real document with a heading and two rows to
 * convert.
 */
function writeTestPdf(filePath) {
  if (fs.existsSync(filePath)) return filePath;
  const content =
    "BT /F1 18 Tf 72 700 Td (JARVIS Document Test) Tj ET\n" +
    "BT /F1 12 Tf 72 670 Td (Item        Qty     Price) Tj ET\n" +
    "BT /F1 12 Tf 72 650 Td (Widget      2       19.99) Tj ET\n" +
    "BT /F1 12 Tf 72 630 Td (Gadget      1       42.50) Tj ET\n";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, pdf, "latin1");
  return filePath;
}

async function mcp(mcpName, action, params, timeoutMs = 240_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mcp: mcpName, action, params }),
      signal: ctrl.signal,
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: err.name === "AbortError" ? `timeout after ${timeoutMs}ms` : err.message };
  } finally {
    clearTimeout(t);
  }
}

async function api(pathname, init = {}, timeoutMs = 240_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${pathname}`, { ...init, signal: ctrl.signal });
    return await res.json();
  } catch (err) {
    return { success: false, error: err.name === "AbortError" ? `timeout after ${timeoutMs}ms` : err.message };
  } finally {
    clearTimeout(t);
  }
}

// ── Zotero stand-in ───────────────────────────────────────────────────
// Serves the documented shape: /api/users/{id}/{collections,items/top,items/:key/children}
//
// Bind exactly where the provider will look, derived from the same env var it
// reads, so overriding ZOTERO_LOCAL_URL moves the stub too instead of leaving
// the test asserting against a port nobody is listening on.
const ZOTERO_LOCAL_URL = process.env.ZOTERO_LOCAL_URL || "http://127.0.0.1:23119/api";
const ZOTERO_STUB = new URL(ZOTERO_LOCAL_URL);
const ZOTERO_STUB_HOST = ZOTERO_STUB.hostname;
const ZOTERO_STUB_PORT = Number(ZOTERO_STUB.port || (ZOTERO_STUB.protocol === "https:" ? 443 : 80));

const MOCK_ITEM = {
  key: "ABCD1234",
  version: 1,
  data: {
    key: "ABCD1234",
    itemType: "journalArticle",
    title: "Attention Is All You Need",
    creators: [{ firstName: "Ashish", lastName: "Vaswani" }],
    date: "2017",
    publicationTitle: "NeurIPS",
    DOI: "10.5555/3295222",
    url: "https://example.org/paper",
    tags: [{ tag: "transformers" }],
    collections: [],
    abstractNote: "A transformer architecture.",
    dateAdded: new Date().toISOString(),
  },
};

function startZoteroStub() {
  const server = http.createServer((req, res) => {
    const url = req.url || "";
    res.setHeader("Content-Type", "application/json");
    if (url.includes("/collections")) {
      res.end(JSON.stringify([{ data: { key: "COLL1", name: "Reading list", parentCollection: false }, meta: { numItems: 1 } }]));
      return;
    }
    if (url.includes("/children")) {
      // annotation children under an attachment
      res.end(
        JSON.stringify([
          {
            data: {
              key: "ATTACH1",
              itemType: "attachment",
              title: "paper.pdf",
            },
          },
        ])
      );
      return;
    }
    if (url.includes("/items/top") || url.includes("/items?")) {
      res.end(JSON.stringify([MOCK_ITEM]));
      return;
    }
    if (url.includes("/items/")) {
      res.end(JSON.stringify(MOCK_ITEM));
      return;
    }
    res.end(JSON.stringify([]));
  });
  return new Promise((resolve) => {
    server.on("error", (err) => resolve({ server: null, error: err.message }));
    server.listen(ZOTERO_STUB_PORT, ZOTERO_STUB_HOST, () => resolve({ server, error: null }));
  });
}

async function main() {
  console.log(`JARVIS MCP provider e2e — target ${BASE}\n`);

  // ─── Gateway ───
  section("1. Gateway advertises the new providers");
  const gw = await api("/api/mcp", { method: "GET" }, 60_000);
  const providers = gw.providers || [];
  for (const p of ["duckdb", "documents", "zotero", "devtools"]) {
    check(`provider '${p}' registered`, providers.includes(p), `got [${providers.join(", ")}]`);
  }

  // ─── DuckDB ───
  section("2. DuckDB — in-process SQL over real data");
  const status = await mcp("duckdb", "status");
  check("status ok", status.success === true, status.error);
  check("engine reports a version", typeof status.data?.version === "string" && status.data.version.length > 0, JSON.stringify(status.data?.version));

  const attach = await mcp("duckdb", "attach_jarvis", {});
  check("attached prisma/dev.db read-only", attach.success === true && attach.data?.extensionNote === "attached read-only", attach.error);
  check("attached DB lists its tables", (attach.data?.tables?.length ?? 0) > 0, `tables=${JSON.stringify(attach.data?.tables)}`);

  const mem = await mcp("duckdb", "query", { sql: "SELECT category, count(*) AS n FROM jarvis.Memory GROUP BY category ORDER BY n DESC" });
  check("queried jarvis.Memory for real rows", mem.success === true && Array.isArray(mem.data?.rows), mem.error);
  check("memory query returned at least one category", (mem.data?.rows?.length ?? 0) > 0, JSON.stringify(mem.data?.rows));

  // read-only guard
  const drop = await mcp("duckdb", "query", { sql: "DROP TABLE something" });
  check("write statements are rejected", drop.success === false && /read-only/i.test(drop.error || ""), JSON.stringify(drop));
  const multi = await mcp("duckdb", "query", { sql: "SELECT 1; SELECT 2" });
  check("multiple statements are rejected", multi.success === false && /multiple/i.test(multi.error || ""), JSON.stringify(multi));

  // register a CSV as a view
  const csvPath = path.join(process.cwd(), "scratch", "e2e-sample.csv");
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.writeFileSync(csvPath, "item,qty,price\nWidget,2,19.99\nGadget,1,42.50\n", "utf8");
  const reg = await mcp("duckdb", "register", { alias: "e2e_sample", path: csvPath });
  check("registered a CSV as a view", reg.success === true, reg.error);
  const csvQuery = await mcp("duckdb", "query", { sql: "SELECT item, qty, price FROM e2e_sample ORDER BY price DESC" });
  check(
    "queried the CSV view",
    csvQuery.success === true && csvQuery.data?.rows?.[0]?.item === "Gadget",
    JSON.stringify(csvQuery.data?.rows ?? csvQuery.error)
  );
  const agg = await mcp("duckdb", "query", { sql: "SELECT sum(price) AS total FROM e2e_sample" });
  // Doubles are doubles: 19.99 + 42.50 is 62.489999999999995. Compare with a
  // tolerance rather than string-matching a floating point sum.
  const total = Number(agg.data?.rows?.[0]?.total);
  check("aggregate over the CSV is correct", Math.abs(total - 62.49) < 0.0001, `total=${total}`);

  // ─── Documents ───
  section("3. Documents — Docling sidecar + built-in fallback");
  const docStatus = await mcp("documents", "status");
  check("status ok", docStatus.success === true, docStatus.error);
  check("reports whether the runtime is provisioned", typeof docStatus.data?.provisioned === "boolean");
  check("reports which engines are available", !!docStatus.data?.engines?.builtin, JSON.stringify(docStatus.data?.engines));
  check(
    "states the Docling runtime honestly (ready / provisioned / not provisioned)",
    typeof docStatus.data?.engines?.docling === "string" && docStatus.data.engines.docling.length > 0
  );

  // Bring the sidecar up deliberately before converting. On a cold install the
  // server downloads its models on first start (minutes), and a conversion
  // issued into that window legitimately falls back to the built-in reader —
  // testing that race would be testing the wrong thing.
  if (docStatus.data?.provisioned) {
    const start = await mcp("documents", "start", undefined, 700_000);
    check("Docling sidecar starts (no terminal needed)", start.success === true, start.error);
    check(
      "sidecar reports ready or a concrete reason",
      !!start.data?.status?.service?.ready || !!start.data?.error,
      JSON.stringify(start.data?.error ?? start.data?.status?.service?.lastError)
    );
  }

  const pdfPath = writeTestPdf(path.join(process.cwd(), "scratch", "docling-test.pdf"));
  if (fs.existsSync(pdfPath)) {
    const conv = await mcp("documents", "convert", { path: pdfPath, doOcr: true }, 700_000);
    check("converted a real PDF", conv.success === true, conv.error);
    check(
      "extracted the expected text",
      /Widget/.test(conv.data?.markdown || "") && /Gadget/.test(conv.data?.markdown || ""),
      JSON.stringify((conv.data?.markdown || "").slice(0, 120))
    );
    check("names the engine that actually ran", typeof conv.data?.engine === "string" && conv.data.engine.length > 0, conv.data?.engine);
    // When the runtime is installed and warm, Docling must be the engine that
    // ran — otherwise the feature is silently degrading to the fallback.
    if (docStatus.data?.provisioned) {
      const ready = (await mcp("documents", "status", undefined, 60_000)).data?.service?.ready;
      check(
        "uses Docling (not the flat-text fallback) when the runtime is ready",
        !ready || conv.data?.engine === "docling",
        `engine=${conv.data?.engine} warnings=${JSON.stringify(conv.data?.warnings)}`
      );
      check(
        "Docling output preserves document structure",
        conv.data?.engine !== "docling" || /^#|\n#/.test(conv.data?.markdown || ""),
        JSON.stringify((conv.data?.markdown || "").slice(0, 60))
      );
    }
  } else {
    console.log("  (skipped PDF case — run the README snippet to create scratch/docling-test.pdf)");
  }

  // A path copied with Windows Explorer's "Copy as path" arrives wrapped in
  // double quotes. That used to reach fs.existsSync verbatim, so a real file was
  // reported missing — the exact bug this guards.
  const quoted = await mcp("documents", "convert", { path: `"${pdfPath}"` }, 700_000);
  check("a path pasted with Explorer's quotes still converts", quoted.success === true, quoted.error);
  check("the quoted path is reported without its quotes", !/["']/.test(quoted.data?.source || ""), JSON.stringify(quoted.data?.source));

  const fileUrl = await mcp("documents", "convert", { path: `file:///${pdfPath.replace(/\\/g, "/")}` }, 700_000);
  check("a file:// path converts too", fileUrl.success === true, fileUrl.error);

  const missingIn = path.join(process.cwd(), "scratch", "does-not-exist.pdf");
  const missing = await mcp("documents", "convert", { path: missingIn });
  check("missing file fails cleanly", missing.success === false && /does not exist/i.test(missing.error || ""), JSON.stringify(missing));
  check(
    "the missing file error names the resolved path",
    (missing.error || "").includes(path.resolve(missingIn)),
    JSON.stringify(missing.error)
  );

  // The other shape of the same failure: the folder itself is gone, which is a
  // different thing to tell the user than "there is no file by that name".
  const missingFolder = await mcp("documents", "convert", { path: path.join(process.cwd(), "scratch", "no-such-dir", "x.pdf") });
  check(
    "a missing folder is named when the folder is what's gone",
    /folder itself does not exist/i.test(missingFolder.error || ""),
    JSON.stringify(missingFolder.error)
  );

  // ─── Zotero ───
  section("4. Zotero — parsing against a stand-in server (NOT a real library)");
  const stub = await startZoteroStub();
  if (!stub.server) {
    console.log(`  (skipped — could not bind ${ZOTERO_STUB_HOST}:${ZOTERO_STUB_PORT}: ${stub.error})`);
  } else {
    try {
      const zs = await mcp("zotero", "status");
      check("status ok", zs.success === true, zs.error);
      check("detected the local API", zs.data?.local?.reachable === true, JSON.stringify(zs.data?.local));
      check("reports the active source as local", zs.data?.activeSource === "local", zs.data?.activeSource);

      const items = await mcp("zotero", "items", { limit: 5 });
      check("fetched items", items.success === true && items.data?.items?.length === 1, items.error);
      check("shaped the item title", items.data?.items?.[0]?.title === "Attention Is All You Need", JSON.stringify(items.data?.items?.[0]?.title));
      check(
        "shaped creators into display names",
        items.data?.items?.[0]?.creators?.[0] === "Ashish Vaswani",
        JSON.stringify(items.data?.items?.[0]?.creators)
      );
      check("read tags", items.data?.items?.[0]?.tags?.includes("transformers"), JSON.stringify(items.data?.items?.[0]?.tags));

      const colls = await mcp("zotero", "collections");
      check("fetched collections", colls.success === true && colls.data?.collections?.[0]?.name === "Reading list", colls.error);

      const search = await mcp("zotero", "search", { query: "transformer" });
      check("search returns items", search.success === true && search.data?.count === 1, search.error);

      const ann = await mcp("zotero", "annotations", { key: "ABCD1234" });
      check("annotation walk returns a well-formed result", ann.success === true && Array.isArray(ann.data?.annotations), ann.error);
    } finally {
      stub.server.close();
    }
  }

  // ─── DevTools ───
  section("5. Chrome DevTools MCP — managed stdio server");
  const dt = await mcp("devtools", "status", undefined, 240_000);
  check("status ok", dt.success === true, dt.error);
  check("server package resolvable", dt.data?.installed === true, dt.data?.lastError);
  check("connected and advertised tools", dt.data?.connected === true && (dt.data?.toolCount ?? 0) > 0, JSON.stringify({ connected: dt.data?.connected, tools: dt.data?.toolCount, error: dt.data?.lastError }));
  check("tool names were listed", (dt.data?.toolNames?.length ?? 0) > 0, JSON.stringify(dt.data?.toolNames?.slice?.(0, 5)));
  check("resolved a real page id (29/30 tools require one)", typeof dt.data?.currentPageId === "number", JSON.stringify(dt.data?.currentPageId));

  const schemas = await mcp("devtools", "tools", undefined, 120_000);
  check("tool schemas expose required args", schemas.success === true && (schemas.data?.tools?.[0]?.required?.length ?? 0) > 0, schemas.error);

  // The real proof: drive the browser and collect page data through the
  // pageId the handler resolved by itself.
  const inspect = await mcp("devtools", "inspect", { url: "http://example.com" }, 300_000);
  check("inspect ran end-to-end", inspect.success === true, inspect.error);
  check(
    "inspect actually collected page data",
    (inspect.data?.sections?.length ?? 0) > 0 || (inspect.data?.warnings?.length ?? 0) > 0,
    JSON.stringify(inspect.data).slice(0, 400)
  );
  check(
    "if it failed, it said why (no silent empty result)",
    (inspect.data?.sections?.length ?? 0) > 0
      ? true
      : (inspect.data?.warnings ?? []).every((w) => typeof w === "string" && w.length > 20),
    JSON.stringify(inspect.data?.warnings)
  );
  check("snapshot or warning text mentions the page state", /example|page|Error|timeout/i.test(JSON.stringify(inspect.data?.sections ?? inspect.data?.warnings ?? "")), "");

  // ─── Price tracker ───
  section("6. Price tracker — server-owned loop");
  const ptStatus = await api("/api/price-tracker?action=status", {}, 60_000);
  check("status ok", ptStatus.success === true, ptStatus.error);
  check("background loop is running with no panel open", ptStatus.status?.running === true, JSON.stringify(ptStatus.status));
  check("reports which price engine is in use", ptStatus.status?.engine === "keepa" || ptStatus.status?.engine === "scrape", ptStatus.status?.engine);
  check("reports its interval", typeof ptStatus.status?.intervalMin === "number" && ptStatus.status.intervalMin > 0, ptStatus.status?.intervalMin);

  const ptList = await api("/api/price-tracker", {}, 60_000);
  check("product list loads", ptList.success === true && Array.isArray(ptList.products), ptList.error);
  check("no fabricated 'demo' products", ptList.demo === undefined, `demo=${ptList.demo}`);

  const badAdd = await api(
    "/api/price-tracker",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", asin: "not-an-asin" }) },
    60_000
  );
  check("invalid ASIN is rejected with a real message", badAdd.success === false && /ASIN/i.test(badAdd.error || ""), JSON.stringify(badAdd));

  const badRemove = await api(
    "/api/price-tracker",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", asin: "B000000000" }) },
    60_000
  );
  check("removing an untracked product fails cleanly", badRemove.success === false && /No tracked product/i.test(badRemove.error || ""), JSON.stringify(badRemove));

  const tick = await api(
    "/api/price-tracker",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "tick" }) },
    120_000
  );
  check("tick endpoint runs without error", tick.success === true, tick.error);
  check("tick reports what it did", Array.isArray(tick.errors), JSON.stringify(tick));

  // A real product: either we get a real number, or we get a clear error. What
  // must NEVER happen is an invented price, which is what the old demo-product
  // fallback did.
  const realAdd = await api(
    "/api/price-tracker",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", asin: "B08N5WRWNW", targetPrice: 100 }),
    },
    180_000
  );
  if (realAdd.success) {
    const price = realAdd.product?.currentPrice;
    check(
      "real product added with a real price or an explicit error recorded",
      typeof price === "number" || !!realAdd.warning || !!realAdd.product?.lastError,
      JSON.stringify({ price, lastError: realAdd.product?.lastError, warning: realAdd.warning })
    );
    check("added product is not marked as demo data", realAdd.product?.source === "keepa" || realAdd.product?.source === "scrape", realAdd.product?.source);
    // Clean up so repeated runs stay idempotent.
    const cleanup = await api(
      "/api/price-tracker",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", asin: "B08N5WRWNW" }) },
      60_000
    );
    check("product can be removed", cleanup.success === true, cleanup.error);
  } else {
    check(
      "when a product cannot be read, the reason is explicit (no silent failure)",
      typeof realAdd.error === "string" && realAdd.error.length > 10,
      JSON.stringify(realAdd)
    );
  }

  // ─── Error quality ───
  section("7. Errors are explicit, never silent");
  for (const [provider, badAction] of [
    ["duckdb", "nonsense"],
    ["documents", "nonsense"],
    ["zotero", "nonsense"],
    ["devtools", "nonsense"],
  ]) {
    const res = await mcp(provider, badAction, {});
    check(
      `${provider}: unknown action returns success:false with the valid list`,
      res.success === false && /supported/i.test(res.error || ""),
      JSON.stringify(res)
    );
  }

  const noSql = await mcp("duckdb", "query", {});
  check("duckdb: missing sql explains what is required", noSql.success === false && /sql is required/i.test(noSql.error || ""), JSON.stringify(noSql));

  const noUrl = await mcp("devtools", "inspect", {});
  check("devtools: missing url explains what is required", noUrl.success === false && /url is required/i.test(noUrl.error || ""), JSON.stringify(noUrl));

  const badTool = await mcp("devtools", "call", { tool: "definitely_not_a_tool" }, 120_000);
  check(
    "devtools: unknown tool names the available tools",
    badTool.success === false && /no such tool/i.test(badTool.error || "") && /navigate_page/.test(badTool.error || ""),
    JSON.stringify(badTool).slice(0, 300)
  );

  const badJson = await api(
    "/api/mcp",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mcp: "duckdb" }) },
    60_000
  );
  check("gateway: missing action is reported", badJson.success === false && /missing mcp or action/i.test(badJson.error || ""), JSON.stringify(badJson));

  // Zotero's two failure modes must be distinguishable and actionable: "not
  // installed" and "installed but not running" need different fixes, and
  // "No Zotero source available" alone told the user neither. (Run after the
  // stand-in server is closed so this reflects this machine's real state.)
  const zStatus = await mcp("zotero", "status");
  check("zotero: status reports whether the app is installed", typeof zStatus.data?.app?.installed === "boolean", JSON.stringify(zStatus.data?.app));
  check("zotero: status lists the locations it checked", Array.isArray(zStatus.data?.app?.checked) && zStatus.data.app.checked.length > 0);
  const zErr = zStatus.data?.local?.error || "";
  check(
    "zotero: an unreachable library explains what to do",
    zStatus.data?.local?.reachable === true || /zotero\.org\/download|not installed|not running|refused the request/i.test(zErr),
    zErr.slice(0, 200)
  );

  const zLaunch = await mcp("zotero", "launch", undefined, 90_000);
  check(
    "zotero: launch connects when the app is present, or names the install page when it is not",
    zLaunch.success === true ? zLaunch.data?.reachable === true : /zotero\.org\/download|not installed/i.test(zLaunch.error || ""),
    (zLaunch.error || JSON.stringify(zLaunch.data)).slice(0, 240)
  );

  const badProvider = await api(
    "/api/mcp",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mcp: "nope", action: "x" }) },
    60_000
  );
  check("gateway: unknown provider is reported", badProvider.success === false && /unknown mcp provider/i.test(badProvider.error || ""), JSON.stringify(badProvider));

  // ─── Summary ───
  console.log(`\n${"-".repeat(60)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log(`\nFailed checks:\n  - ${failures.join("\n  - ")}`);
  }
  console.log("\nNote: the Zotero section ran against a stand-in server, not a real library.");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
