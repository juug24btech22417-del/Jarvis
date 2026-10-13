// DuckDB MCP provider — in-process analytical SQL over local data.
//
// WHY: JARVIS accumulates data it can never ask questions of — clipboard
// captures, watcher samples, price history, action-tape events, PC stats, the
// whole SQLite app database. DuckDB is an embedded OLAP engine with zero
// server and zero setup, so it can be loaded *inside the Next.js process* and
// pointed at CSV/Parquet/JSON files or at JARVIS's own SQLite database.
//
// This is deliberately a read-only provider for ad-hoc SQL. Recording,
// attaching and file registration go through dedicated actions so that a
// stray scraped page (or an LLM prompt-injected from one) can't hand this
// handler a `DROP TABLE` or write a file somewhere unexpected.
//
// The instance is pinned to globalThis: registered views and any attached
// database must survive Next.js dev hot reloads, otherwise every file you
// registered would silently vanish on the next code edit.

import fs from "fs";
import path from "path";
import { normalizeLocalPath } from "@/lib/mcp/localPaths";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

type Registry = {
  instance: DuckDBInstance | null;
  conn: DuckDBConnection | null;
  connecting: Promise<DuckDBConnection> | null;
  views: Map<string, string>; // alias -> source path
  attached: Map<string, string>; // alias -> path
  lastError: string | null;
};

const g = globalThis as unknown as { __jarvisDuckDb?: Registry };
if (!g.__jarvisDuckDb) {
  g.__jarvisDuckDb = {
    instance: null,
    conn: null,
    connecting: null,
    views: new Map(),
    attached: new Map(),
    lastError: null,
  };
}
const reg = g.__jarvisDuckDb;

const SQLITE_EXT_ATTEMPTED = new Set<string>();

async function conn(): Promise<DuckDBConnection> {
  if (reg.conn) return reg.conn;
  if (reg.connecting) return reg.connecting;
  reg.connecting = (async () => {
    try {
      const instance = await DuckDBInstance.create(":memory:");
      const c = await instance.connect();
      reg.instance = instance;
      reg.conn = c;
      reg.lastError = null;
      return c;
    } catch (err) {
      reg.lastError = (err as Error).message;
      reg.connecting = null;
      throw err;
    } finally {
      reg.connecting = null;
    }
  })();
  return reg.connecting;
}

/**
 * DuckDB hands back BigInt/Date/Buffer for some columns, none of which survive
 * JSON.stringify. Convert at the boundary so every caller gets plain JSON.
 */
function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `<binary ${value.length}B>`;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

/** Read-only verbs only. Anything else must go through a dedicated action. */
function assertReadOnly(sql: string): void {
  const stripped = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim();
  const first = stripped.split(/[\s(]+/)[0]?.toUpperCase() ?? "";
  const allowed = new Set(["SELECT", "WITH", "DESCRIBE", "SUMMARIZE", "PRAGMA", "SHOW", "EXPLAIN", "FROM", "TABLE", "VALUES"]);
  if (!allowed.has(first)) {
    throw new Error(
      `Only read-only SQL is allowed here (got "${first}"). Use duckdb.register / duckdb.attach for setup, or run the statement against the JARVIS database directly.`
    );
  }
  // A second statement hidden after a semicolon is the usual way around a
  // first-word check.
  const withoutTrailing = stripped.replace(/;\s*$/, "");
  if (withoutTrailing.includes(";")) {
    throw new Error("Multiple SQL statements are not allowed — send one statement per query.");
  }
}

const DATA_EXTENSIONS = [".csv", ".tsv", ".parquet", ".json", ".jsonl", ".ndjson", ".xlsx"];

function isDataFile(name: string): boolean {
  const lower = name.toLowerCase();
  return DATA_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Choose the right reader for a file extension. */
function readerFor(filePath: string): string {
  const lower = filePath.toLowerCase();
  const lit = filePath.replace(/'/g, "''");
  if (lower.endsWith(".parquet")) return `read_parquet('${lit}')`;
  if (lower.endsWith(".json") || lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) {
    return `read_json_auto('${lit}')`;
  }
  if (lower.endsWith(".xlsx")) return `read_xlsx('${lit}')`;
  if (lower.endsWith(".tsv")) return `read_csv_auto('${lit}', delim='\t')`;
  return `read_csv_auto('${lit}')`;
}

function sanitizeAlias(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error("Alias must be an identifier (letters, digits, underscore).");
  }
  return alias;
}

// ── actions ──────────────────────────────────────────────────────────

async function actionStatus() {
  const c = await conn();
  const version = (await c.runAndReadAll("SELECT version() AS v")).getRowObjects()[0] as { v: string };
  return {
    engine: "duckdb",
    version: version.v,
    database: ":memory:",
    views: [...reg.views.entries()].map(([alias, source]) => ({ alias, source })),
    attached: [...reg.attached.entries()].map(([alias, source]) => ({ alias, source })),
    sqliteExtensionTried: [...SQLITE_EXT_ATTEMPTED],
    lastError: reg.lastError,
    notes:
      "In-process DuckDB. Registered views and attached databases are kept for the life of the server process; they are re-created on demand.",
  };
}

async function actionQuery(params: Record<string, unknown>) {
  const sql = String(params.sql ?? "").trim();
  if (!sql) throw new Error("sql is required");
  assertReadOnly(sql);
  const limit = Math.min(Math.max(Number(params.limit ?? 200), 1), 2000);
  const c = await conn();
  const reader = await c.runAndReadAll(sql);
  const all = reader.getRowObjects();
  const columns = reader.columnNames();
  return {
    columns,
    rowCount: all.length,
    truncated: all.length > limit,
    rows: jsonSafe(all.slice(0, limit)),
  };
}

async function actionDescribe(params: Record<string, unknown>) {
  const sql = String(params.sql ?? "").trim();
  if (!sql) throw new Error("sql is required");
  assertReadOnly(sql);
  const c = await conn();
  const reader = await c.runAndReadAll(`DESCRIBE ${sql}`);
  return { columns: reader.getRowObjects(), sql };
}

async function actionTables() {
  const c = await conn();
  const reader = await c.runAndReadAll(
    `SELECT table_schema, table_name, table_type FROM information_schema.tables ORDER BY table_schema, table_name`
  );
  return { tables: jsonSafe(reader.getRowObjects()) };
}

async function actionFiles(params: Record<string, unknown>) {
  const root = String(params.root ?? process.cwd());
  if (!fs.existsSync(root)) throw new Error(`Path does not exist: ${root}`);
  const maxFiles = Math.min(Math.max(Number(params.limit ?? 200), 1), 1000);
  const results: { path: string; sizeBytes: number; ext: string }[] = [];

  const walk = (dir: string, depth: number) => {
    if (depth > 4 || results.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir (permissions / locked) — skip, don't fail the walk
    }
    for (const e of entries) {
      if (results.length >= maxFiles) return;
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === ".next") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (isDataFile(e.name)) {
        let sizeBytes = 0;
        try {
          sizeBytes = fs.statSync(full).size;
        } catch {
          // size is informational only
        }
        results.push({ path: full, sizeBytes, ext: path.extname(e.name).toLowerCase() });
      }
    }
  };
  walk(root, 0);
  return { root, files: results.sort((a, b) => b.sizeBytes - a.sizeBytes) };
}

async function actionRegister(params: Record<string, unknown>) {
  const alias = sanitizeAlias(String(params.alias ?? "").trim());
  // Same pasted-path cleanup as the documents provider: Explorer quotes and
  // file:// schemes are decoration, not part of the filename.
  const filePath = normalizeLocalPath(params.path);
  if (!filePath) throw new Error("path is required");
  if (!fs.existsSync(filePath)) throw new Error(`File does not exist: ${path.resolve(filePath)}`);

  const c = await conn();
  const reader = readerFor(filePath);
  await c.run(`CREATE OR REPLACE VIEW ${alias} AS SELECT * FROM ${reader}`);
  reg.views.set(alias, filePath);

  const described = await c.runAndReadAll(`DESCRIBE ${alias}`);
  const count = (await c.runAndReadAll(`SELECT count(*) AS n FROM ${alias}`)).getRowObjects()[0];
  return {
    alias,
    source: filePath,
    reader,
    columns: jsonSafe(described.getRowObjects()),
    rowCount: jsonSafe(count),
  };
}

async function actionUnregister(params: Record<string, unknown>) {
  const alias = sanitizeAlias(String(params.alias ?? "").trim());
  const c = await conn();
  await c.run(`DROP VIEW IF EXISTS ${alias}`);
  reg.views.delete(alias);
  return { alias, dropped: true };
}

/**
 * Where JARVIS's SQLite file actually is.
 *
 * Derived from DATABASE_URL rather than hardcoded, because the filename is a
 * project convention that can change. Prisma resolves a relative `file:` path
 * against the schema directory (prisma/), which is why the fallback joins
 * prisma/ and the URL is treated as relative to it.
 */
function jarvisDbPath(): string {
  const url = process.env.DATABASE_URL || "";
  const match = url.match(/^file:(.+)$/);
  if (match) {
    const raw = match[1].trim();
    if (path.isAbsolute(raw)) return raw;
    return path.join(process.cwd(), "prisma", raw.replace(/^\.\//, ""));
  }
  return path.join(process.cwd(), "prisma", "dev.db");
}

/**
 * Attach the JARVIS SQLite database read-only, so memory/tasks/watchers/price
 * history can be queried with real SQL. The sqlite extension is downloaded on
 * first use and cached by DuckDB — the first call may need network access.
 */
async function actionAttachJarvis(params: Record<string, unknown>) {
  const alias = sanitizeAlias(String(params.alias ?? process.env.JARVIS_DB_ALIAS ?? "jarvis").trim());
  const dbPath = params.path ? normalizeLocalPath(params.path) : jarvisDbPath();
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

  const c = await conn();
  let extensionNote = "";
  try {
    await c.run("INSTALL sqlite");
    await c.run("LOAD sqlite");
    SQLITE_EXT_ATTEMPTED.add("ok");
  } catch (err) {
    SQLITE_EXT_ATTEMPTED.add("failed");
    throw new Error(
      `DuckDB's sqlite extension could not be loaded (${(err as Error).message}). ` +
        "It is fetched from the DuckDB extension repository on first use — this needs one working network call."
    );
  }

  const lit = dbPath.replace(/'/g, "''");
  await c.run(`ATTACH IF NOT EXISTS '${lit}' AS ${alias} (TYPE sqlite, READ_ONLY)`);
  reg.attached.set(alias, dbPath);
  extensionNote = "attached read-only";

  // A SQLite database attached through the sqlite extension does NOT show up
  // under a schema of the same name. Its tables are reachable through
  // information_schema with the attachment alias as the CATALOG:
  //   table_catalog = 'jarvis'
  // (Verified against duckdb 1.5.6: qualifying the catalog table directly, as
  // in `jarvis.sqlite_master`, raises "Table with name sqlite_master does not
  // exist".)
  const tables = await c.runAndReadAll(
    `SELECT table_name FROM information_schema.tables WHERE table_catalog = '${alias}' ORDER BY table_name`
  );
  return { alias, path: dbPath, extensionNote, tables: jsonSafe(tables.getRowObjects()) };
}

async function actionDetach(params: Record<string, unknown>) {
  const alias = sanitizeAlias(String(params.alias ?? "").trim());
  const c = await conn();
  await c.run(`DETACH ${alias}`);
  reg.attached.delete(alias);
  return { alias, detached: true };
}

export async function handleDuckDb(action: string, params: Record<string, unknown>) {
  try {
    switch (action) {
      case "status":
        return { success: true, mcp: "duckdb", action, data: await actionStatus() };
      case "query":
        return { success: true, mcp: "duckdb", action, data: await actionQuery(params) };
      case "describe":
        return { success: true, mcp: "duckdb", action, data: await actionDescribe(params) };
      case "tables":
        return { success: true, mcp: "duckdb", action, data: await actionTables() };
      case "files":
        return { success: true, mcp: "duckdb", action, data: await actionFiles(params) };
      case "register":
        return { success: true, mcp: "duckdb", action, data: await actionRegister(params) };
      case "unregister":
        return { success: true, mcp: "duckdb", action, data: await actionUnregister(params) };
      case "attach_jarvis":
        return { success: true, mcp: "duckdb", action, data: await actionAttachJarvis(params) };
      case "detach":
        return { success: true, mcp: "duckdb", action, data: await actionDetach(params) };
      default:
        return {
          success: false,
          mcp: "duckdb",
          error: `Unsupported duckdb action '${action}'. Supported: status, query, describe, tables, files, register, unregister, attach_jarvis, detach.`,
        };
    }
  } catch (err) {
    return { success: false, mcp: "duckdb", error: (err as Error).message };
  }
}
