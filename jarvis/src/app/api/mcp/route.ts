import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";

// Unified Model Context Protocol (MCP) Gateway for JARVIS.
//
// Provider policy — REAL DATA ONLY:
//   • github     — live GitHub REST API (public, or authenticated via GITHUB_TOKEN)
//   • filesystem — real disk I/O. Read anywhere, write only inside the project.
//   • googlemaps — live Google Maps data via Serper (Google-indexed) + OSM fallback
//   • whatsapp   — thin honest proxy onto the local WhatsApp daemon
//
// There are NO fabricated/curated fallbacks here. When a provider cannot
// answer, the gateway returns a real error — the UI must never show invented
// places, repos, or "sent" messages.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WHATSAPP_SERVER_URL = process.env.WHATSAPP_SERVER_URL || "http://localhost:3100";
const WHATSAPP_HINT = "WhatsApp daemon is not running. Start it with: npm run whatsapp:server";
const PROJECT_ROOT = process.cwd();

// ─────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────
type Json = Record<string, unknown>;

function ok(mcp: string, action: string, data: unknown, extra: Json = {}) {
  return NextResponse.json({ success: true, mcp, action, data, ...extra });
}
function fail(error: string, status = 400, extra: Json = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

function timeout(ms: number) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

async function jsonFetch(url: string, init: RequestInit, ms: number) {
  const { signal, done } = timeout(ms);
  try {
    return await fetch(url, { ...init, signal });
  } finally {
    done();
  }
}

// ─────────────────────────────────────────────────────────────
// 1. GITHUB MCP — live REST API, any repo
// ─────────────────────────────────────────────────────────────
function ghHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "JARVIS-MCP-Gateway",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function ghGet(url: string) {
  const res = await jsonFetch(url, { headers: ghHeaders() }, 9000);
  const rateLimited = res.headers.get("x-ratelimit-remaining") === "0";
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, body, rateLimited };
}

function ghErrorText(res: Response, body: any, rateLimited: boolean): string {
  if (rateLimited) {
    return "GitHub rate limit reached. Add GITHUB_TOKEN to .env.local to raise the limit to 5,000 requests/hour.";
  }
  if (res.status === 404) return "Not found on GitHub (check the owner/repo spelling and that it is public).";
  if (res.status === 403) {
    return body?.message?.includes("rate limit")
      ? "GitHub rate limit reached. Add GITHUB_TOKEN to .env.local."
      : "GitHub refused the request (403). This action needs an authenticated token with the right scope.";
  }
  if (res.status === 401) return "GitHub token rejected (401). Check GITHUB_TOKEN in .env.local.";
  return body?.message || `GitHub API error (${res.status})`;
}

async function handleGithub(action: string, params: Json) {
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

  // ── Who am I (for authenticated repo listing) ──
  if (action === "get_user") {
    if (!token) return fail("Add GITHUB_TOKEN to .env.local to identify your account.", 400);
    const { res, body, rateLimited } = await ghGet("https://api.github.com/user");
    if (!res.ok) return fail(ghErrorText(res, body, rateLimited), res.status);
    return ok("github", action, {
      login: body.login,
      name: body.name,
      avatar: body.avatar_url,
      repos: body.public_repos,
    });
  }

  // ── List repos for a user/org, or search ──
  if (action === "list_repos") {
    const username = String(params.username || "").trim();
    const query = String(params.query || "").trim();
    const sort = String(params.sort || "updated");
    const perPage = Math.min(Number(params.per_page) || 30, 100);

    let url: string;
    if (query) {
      url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=${perPage}`;
    } else if (username) {
      // Try as a user, then as an org.
      const u = await ghGet(`https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=${sort}&per_page=${perPage}`);
      if (u.res.ok && Array.isArray(u.body)) {
        return ok("github", action, u.body.map(mapRepo), { total: u.body.length });
      }
      const o = await ghGet(`https://api.github.com/orgs/${encodeURIComponent(username)}/repos?sort=${sort}&per_page=${perPage}`);
      if (o.res.ok && Array.isArray(o.body)) {
        return ok("github", action, o.body.map(mapRepo), { total: o.body.length });
      }
      return fail(ghErrorText(u.res, u.body, u.rateLimited), u.res.status === 200 ? 404 : u.res.status);
    } else if (token) {
      const { res, body, rateLimited } = await ghGet(`https://api.github.com/user/repos?sort=${sort}&per_page=${perPage}&affiliation=owner,collaborator,organization_member`);
      if (!res.ok) return fail(ghErrorText(res, body, rateLimited), res.status);
      return ok("github", action, (body as any[]).map(mapRepo), { total: (body as any[]).length });
    } else {
      return fail("Enter a GitHub username, or add GITHUB_TOKEN to list your own repositories.", 400);
    }

    const { res, body, rateLimited } = await ghGet(url);
    if (!res.ok) return fail(ghErrorText(res, body, rateLimited), res.status);
    const items = Array.isArray(body) ? body : body?.items || [];
    return ok("github", action, items.map(mapRepo), { total: body?.total_count ?? items.length });
  }

  // ── Repo summary ──
  if (action === "get_repo") {
    const repo = String(params.repo || "").trim();
    if (!repo.includes("/")) return fail("repo must be in 'owner/name' form", 400);
    const { res, body, rateLimited } = await ghGet(`https://api.github.com/repos/${repo}`);
    if (!res.ok) return fail(ghErrorText(res, body, rateLimited), res.status);
    return ok("github", action, {
      full_name: body.full_name,
      description: body.description,
      stars: body.stargazers_count,
      forks: body.forks_count,
      open_issues: body.open_issues_count,
      watchers: body.subscribers_count,
      language: body.language,
      default_branch: body.default_branch,
      license: body.license?.spdx_id || null,
      pushed_at: body.pushed_at,
      html_url: body.html_url,
      homepage: body.homepage,
      topics: body.topics || [],
      private: body.private,
      archived: body.archived,
    });
  }

  // ── Directory / file contents ──
  if (action === "list_contents") {
    const repo = String(params.repo || "").trim();
    const p = String(params.path || "").replace(/^\/+/, "");
    const ref = params.ref ? `?ref=${encodeURIComponent(String(params.ref))}` : "";
    if (!repo.includes("/")) return fail("repo must be in 'owner/name' form", 400);
    const { res, body, rateLimited } = await ghGet(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(p).replace(/%2F/g, "/")}${ref}`);
    if (!res.ok) return fail(ghErrorText(res, body, rateLimited), res.status);
    if (Array.isArray(body)) {
      return ok("github", action, body.map((f: any) => ({
        name: f.name,
        path: f.path,
        type: f.type === "dir" ? "dir" : "file",
        size: f.size,
        sha: f.sha,
        html_url: f.html_url,
        download_url: f.download_url,
      })), { isDirectory: true });
    }
    // A single file: decode content if present.
    const content = body.content ? Buffer.from(body.content, "base64").toString("utf8") : "";
    return ok("github", action, {
      name: body.name,
      path: body.path,
      size: body.size,
      isDirectory: false,
      html_url: body.html_url,
      content,
    });
  }

  if (action === "get_file") {
    return handleGithub("list_contents", params);
  }

  // ── Issues ──
  if (action === "list_issues") {
    const repo = String(params.repo || "").trim();
    const state = String(params.state || "open");
    const perPage = Math.min(Number(params.per_page) || 20, 100);
    if (!repo.includes("/")) return fail("repo must be in 'owner/name' form", 400);
    const { res, body, rateLimited } = await ghGet(`https://api.github.com/repos/${repo}/issues?state=${state}&per_page=${perPage}&sort=updated`);
    if (!res.ok) return fail(ghErrorText(res, body, rateLimited), res.status);
    const issues = (body as any[]).filter((i) => !i.pull_request);
    return ok("github", action, issues.map((i: any) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      user: i.user?.login,
      labels: (i.labels || []).map((l: any) => l.name),
      comments: i.comments,
      html_url: i.html_url,
      created_at: i.created_at,
      isPullRequest: false,
    })), { total: issues.length });
  }

  // ── Pull requests ──
  if (action === "list_pulls") {
    const repo = String(params.repo || "").trim();
    const state = String(params.state || "open");
    const perPage = Math.min(Number(params.per_page) || 20, 100);
    if (!repo.includes("/")) return fail("repo must be in 'owner/name' form", 400);
    const { res, body, rateLimited } = await ghGet(`https://api.github.com/repos/${repo}/pulls?state=${state}&per_page=${perPage}&sort=updated`);
    if (!res.ok) return fail(ghErrorText(res, body, rateLimited), res.status);
    return ok("github", action, (body as any[]).map((p: any) => ({
      number: p.number,
      title: p.title,
      state: p.state,
      draft: p.draft,
      user: p.user?.login,
      head: p.head?.ref,
      base: p.base?.ref,
      html_url: p.html_url,
      created_at: p.created_at,
      merged_at: p.merged_at,
    })), { total: (body as any[]).length });
  }

  if (action === "get_pull") {
    const repo = String(params.repo || "").trim();
    const number = Number(params.number);
    if (!repo.includes("/") || !number) return fail("repo and number are required", 400);
    const { res, body, rateLimited } = await ghGet(`https://api.github.com/repos/${repo}/pulls/${number}`);
    if (!res.ok) return fail(ghErrorText(res, body, rateLimited), res.status);
    return ok("github", action, {
      number: body.number,
      title: body.title,
      body: body.body,
      state: body.state,
      merged: body.merged,
      additions: body.additions,
      deletions: body.deletions,
      changed_files: body.changed_files,
      user: body.user?.login,
      base: body.base?.ref,
      head: body.head?.ref,
      html_url: body.html_url,
    });
  }

  // ── Commits / branches / releases ──
  if (action === "list_commits") {
    const repo = String(params.repo || "").trim();
    const perPage = Math.min(Number(params.per_page) || 20, 100);
    const branch = params.branch ? `&sha=${encodeURIComponent(String(params.branch))}` : "";
    if (!repo.includes("/")) return fail("repo must be in 'owner/name' form", 400);
    const { res, body, rateLimited } = await ghGet(`https://api.github.com/repos/${repo}/commits?per_page=${perPage}${branch}`);
    if (!res.ok) return fail(ghErrorText(res, body, rateLimited), res.status);
    return ok("github", action, (body as any[]).map((c: any) => ({
      sha: c.sha?.slice(0, 8),
      fullSha: c.sha,
      message: c.commit?.message?.split("\n")[0],
      author: c.commit?.author?.name,
      date: c.commit?.author?.date,
      html_url: c.html_url,
    })), { total: (body as any[]).length });
  }

  if (action === "list_branches") {
    const repo = String(params.repo || "").trim();
    if (!repo.includes("/")) return fail("repo must be in 'owner/name' form", 400);
    const { res, body, rateLimited } = await ghGet(`https://api.github.com/repos/${repo}/branches?per_page=100`);
    if (!res.ok) return fail(ghErrorText(res, body, rateLimited), res.status);
    return ok("github", action, (body as any[]).map((b: any) => ({ name: b.name, sha: b.commit?.sha?.slice(0, 8) })));
  }

  // ── Write actions (require a token) ──
  if (action === "create_issue") {
    if (!token) return fail("Creating issues needs GITHUB_TOKEN in .env.local with 'repo' scope.", 401);
    const repo = String(params.repo || "").trim();
    const title = String(params.title || "").trim();
    if (!repo.includes("/") || !title) return fail("repo and title are required", 400);
    const res = await jsonFetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title, body: params.body || "" }),
    }, 9000);
    const body = await res.json().catch(() => null);
    if (!res.ok) return fail(ghErrorText(res, body, false), res.status);
    return ok("github", action, { number: body.number, html_url: body.html_url, title: body.title });
  }

  if (action === "create_pr") {
    if (!token) return fail("Creating pull requests needs GITHUB_TOKEN in .env.local with 'repo' scope.", 401);
    const repo = String(params.repo || "").trim();
    const { title, head, base, body: prBody } = params as any;
    if (!repo.includes("/") || !title || !head || !base) {
      return fail("repo, title, head and base are required", 400);
    }
    const res = await jsonFetch(`https://api.github.com/repos/${repo}/pulls`, {
      method: "POST",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title, head, base, body: prBody || "" }),
    }, 9000);
    const body = await res.json().catch(() => null);
    if (!res.ok) return fail(ghErrorText(res, body, false), res.status);
    return ok("github", action, { number: body.number, html_url: body.html_url, title: body.title });
  }

  return fail(`Unsupported github action '${action}'`, 400);
}

function mapRepo(r: any) {
  return {
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    description: r.description || "No description provided.",
    stars: r.stargazers_count ?? 0,
    forks: r.forks_count ?? 0,
    open_issues: r.open_issues_count ?? 0,
    language: r.language,
    topics: r.topics || [],
    updated_at: r.updated_at,
    html_url: r.html_url,
    private: r.private,
  };
}

// ─────────────────────────────────────────────────────────────
// 2. FILESYSTEM MCP — read anywhere, write only inside the project
// ─────────────────────────────────────────────────────────────
function isInsideProject(target: string): boolean {
  const rel = path.relative(PROJECT_ROOT, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function resolveReadTarget(input: string): string {
  const p = String(input || "").trim();
  if (!p) return PROJECT_ROOT;
  if (path.isAbsolute(p)) return path.resolve(p);
  // A bare name like "C:" or "D:" should become a drive root on Windows.
  if (/^[a-zA-Z]:$/.test(p)) return path.resolve(p + path.sep);
  return path.resolve(PROJECT_ROOT, p);
}

function listWindowsDrives(): string[] {
  const drives: string[] = [];
  for (let i = 65; i <= 90; i++) {
    const d = `${String.fromCharCode(i)}:\\`;
    try {
      if (fs.existsSync(d)) drives.push(d);
    } catch {}
  }
  return drives;
}

function handleFilesystem(action: string, params: Json) {
  if (action === "list_roots") {
    const roots = [
      { label: "Project (this app)", path: PROJECT_ROOT, writable: true },
      { label: "Home", path: os.homedir(), writable: false },
      { label: "Desktop", path: path.join(os.homedir(), "Desktop"), writable: false },
      { label: "Documents", path: path.join(os.homedir(), "Documents"), writable: false },
      { label: "Downloads", path: path.join(os.homedir(), "Downloads"), writable: false },
    ].filter((r) => {
      try {
        return fs.existsSync(r.path);
      } catch {
        return false;
      }
    });
    if (process.platform === "win32") {
      for (const d of listWindowsDrives()) {
        roots.push({ label: `Drive ${d.slice(0, 2)}`, path: d, writable: false });
      }
    }
    return ok("filesystem", action, roots);
  }

  if (action === "list_dir") {
    const targetDir = resolveReadTarget(String(params.path || "."));
    if (!fs.existsSync(targetDir)) return fail(`Directory not found: ${targetDir}`, 404);
    const stat = fs.statSync(targetDir);
    if (!stat.isDirectory()) return fail(`Not a directory: ${targetDir}`, 400);

    const entries = fs.readdirSync(targetDir, { withFileTypes: true })
      .filter((e) => e.name !== "node_modules" && !e.name.startsWith(".git"))
      .slice(0, 400)
      .map((e) => {
        const full = path.join(targetDir, e.name);
        let size: number | null = null;
        let mtime: number | null = null;
        try {
          const s = fs.statSync(full);
          size = e.isFile() ? s.size : null;
          mtime = s.mtimeMs;
        } catch {}
        return { name: e.name, isDirectory: e.isDirectory(), size, mtime, writable: isInsideProject(full) };
      })
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));

    const parent = path.dirname(targetDir);
    const parentPath = parent !== targetDir ? parent : null;

    return ok("filesystem", action, entries, {
      cwd: targetDir,
      parentPath,
      writable: isInsideProject(targetDir),
      projectRoot: PROJECT_ROOT,
    });
  }

  if (action === "read_file") {
    const filePath = String(params.filePath || params.path || "");
    if (!filePath) return fail("filePath required", 400);
    const resolved = resolveReadTarget(filePath);
    if (!fs.existsSync(resolved)) return fail(`File not found: ${resolved}`, 404);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return fail("That path is a directory — use list_dir.", 400);
    // Guard against opening binaries as text (puppeteer browsers, images, etc.)
    if (stat.size > 2 * 1024 * 1024) {
      return fail(`File is ${(stat.size / 1024 / 1024).toFixed(1)} MB — too large to display.`, 413);
    }
    try {
      const buf = fs.readFileSync(resolved);
      const isBinary = buf.subarray(0, 8000).includes(0);
      const content = isBinary ? `[binary file — ${stat.size} bytes]` : buf.toString("utf8");
      return ok("filesystem", action, content, {
        filePath: resolved,
        sizeBytes: stat.size,
        isBinary,
        writable: isInsideProject(resolved),
      });
    } catch (e: any) {
      return fail(`Could not read file: ${e.message}`, 500);
    }
  }

  if (action === "write_file") {
    const filePath = String(params.filePath || params.path || "");
    const content = params.content;
    if (!filePath || content === undefined) return fail("filePath and content required", 400);
    const resolved = path.resolve(resolveReadTarget(filePath));
    if (!isInsideProject(resolved)) {
      return fail(`Writes are restricted to the project folder (${PROJECT_ROOT}).`, 403);
    }
    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, String(content), "utf8");
      return ok("filesystem", action, {
        filePath: resolved,
        bytesWritten: Buffer.byteLength(String(content), "utf8"),
        created: !fs.existsSync(resolved),
      });
    } catch (e: any) {
      return fail(`Could not write file: ${e.message}`, 500);
    }
  }

  if (action === "create_dir") {
    const dirPath = String(params.path || "");
    if (!dirPath) return fail("path required", 400);
    const resolved = path.resolve(resolveReadTarget(dirPath));
    if (!isInsideProject(resolved)) return fail("Directory creation is restricted to the project folder.", 403);
    try {
      fs.mkdirSync(resolved, { recursive: true });
      return ok("filesystem", action, { path: resolved });
    } catch (e: any) {
      return fail(`Could not create directory: ${e.message}`, 500);
    }
  }

  if (action === "delete") {
    const target = String(params.path || "");
    if (!target) return fail("path required", 400);
    const resolved = path.resolve(resolveReadTarget(target));
    if (!isInsideProject(resolved)) return fail("Deletes are restricted to the project folder.", 403);
    if (!fs.existsSync(resolved)) return fail("Path not found", 404);
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
      return ok("filesystem", action, { deleted: resolved });
    } catch (e: any) {
      return fail(`Could not delete: ${e.message}`, 500);
    }
  }

  if (action === "search") {
    const query = String(params.query || "").toLowerCase();
    if (!query) return fail("query required", 400);
    const rootDir = resolveReadTarget(String(params.root || PROJECT_ROOT));
    const results: any[] = [];
    const max = Math.min(Number(params.maxResults) || 60, 200);
    const walk = (dir: string, depth: number) => {
      if (depth > 6 || results.length >= max) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (results.length >= max) return;
        if (e.name === "node_modules" || e.name.startsWith(".git")) continue;
        const full = path.join(dir, e.name);
        if (e.name.toLowerCase().includes(query)) {
          let size: number | null = null;
          try {
            size = fs.statSync(full).size;
          } catch {}
          results.push({ name: e.name, path: full, isDirectory: e.isDirectory(), size });
        }
        if (e.isDirectory()) walk(full, depth + 1);
      }
    };
    walk(rootDir, 0);
    return ok("filesystem", action, results, { root: rootDir, total: results.length });
  }

  return fail(`Unsupported filesystem action '${action}'`, 400);
}

// ─────────────────────────────────────────────────────────────
// 3. GOOGLE MAPS MCP — live places via Serper, geocoded precisely
// ─────────────────────────────────────────────────────────────

// Strip filler words and, when a location phrase is folded into the query,
// remove it so "pizza place in bagalkot" searches "pizza" *in* bagalkot.
const FILLER_RE = /\b(near|nearby|around|find|looking for|show|me|best|top|rated|good|cheap|place|places|spot|spots|store|stores|shop|shops|the|a|an|is|are|which|that|it|there|my|location)\b/gi;

type GeoPlace = {
  name: string;
  address: string;
  rating: number | null;
  totalRatings: number | null;
  category?: string | null;
  phone?: string | null;
  website?: string | null;
  priceLevel?: string | null;
  lat: number | null;
  lng: number | null;
  mapsUrl: string;
  source: string;
};

async function geocode(query: string): Promise<{ lat: number; lng: number; display: string; countryCode?: string; location: string } | null> {
  const q = query.trim();
  if (!q) return null;
  // Try progressively shorter prefixes — "bagalkot which is a district..." →
  // "bagalkot the district..." → "bagalkot".
  const words = q.split(/\s+/);
  const candidates = [q];
  if (words.length > 4) candidates.push(words.slice(0, 4).join(" "));
  if (words.length > 2) candidates.push(words.slice(0, 2).join(" "));
  candidates.push(words[0]);

  for (const c of new Set(candidates)) {
    try {
      const res = await jsonFetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(c)}&format=jsonv2&addressdetails=1&limit=1`,
        { headers: { "User-Agent": "JARVIS-MCP/1.0 (personal assistant)" } },
        5000
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) continue;
      const first = data[0];
      const a = first.address || {};
      const city = a.city || a.town || a.village || a.municipality || a.county || a.state_district || "";
      const region = a.state || a.region || a.county || "";
      const country = a.country || "";
      const parts = [city, region, country].filter(Boolean);
      return {
        lat: parseFloat(first.lat),
        lng: parseFloat(first.lon),
        display: first.display_name,
        countryCode: a.country_code,
        location: parts.join(", ") || first.display_name,
      };
    } catch {
      // try next candidate
    }
  }
  return null;
}

/** Turn coordinates into a human address (used for live "my location"). */
async function reverseGeocode(lat: number, lng: number): Promise<{ address: string; short: string } | null> {
  try {
    const res = await jsonFetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&addressdetails=1&zoom=18`,
      { headers: { "User-Agent": "JARVIS-MCP/1.0 (personal assistant)" } },
      5000
    );
    if (!res.ok) return null;
    const d = await res.json();
    const a = d.address || {};
    const short = [a.road || a.neighbourhood || a.suburb, a.city || a.town || a.village, a.state, a.postcode, a.country]
      .filter(Boolean)
      .join(", ");
    return { address: d.display_name || short, short };
  } catch {
    return null;
  }
}

function mapsUrlFor(name: string, address: string, lat: number | null, lng: number | null, cid?: string) {
  if (cid) return `https://www.google.com/maps?cid=${cid}`;
  const q = lat != null && lng != null ? `${lat},${lng}` : `${name} ${address}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Great-circle distance in km. Used to keep results anchored to the place. */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Search real places. Returns null when every engine fails (never fabricates). */
async function searchPlacesReal(
  query: string,
  explicitLocation?: string,
  coords?: { lat: number; lng: number }
): Promise<{ places: GeoPlace[]; source: string; geo?: any } | null> {
  const serperKey = process.env.SERPER_API_KEY;
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;

  // 1) Split query into "what" + "where".
  let what = query.trim();
  let where = (explicitLocation || "").trim();
  if (!where) {
    const m = query.match(/\b(?:in|near|around|at|within)\s+([^,]+?)(?:\s+which\b.*)?$/i);
    if (m) {
      where = m[1].trim();
      what = query.slice(0, m.index).trim();
    }
  }
  what = what.replace(FILLER_RE, " ").replace(/\s+/g, " ").trim();
  if (!what) what = query.replace(/\b(?:in|near|around|at)\b.*$/i, "").trim() || query;

  // 2) Geocode the location so the search is anchored to the right place.
  //    An explicit coordinate pair (the user's live location) wins outright.
  let geo = where ? await geocode(where) : null;
  if (!geo && coords) {
    geo = {
      lat: coords.lat,
      lng: coords.lng,
      location: explicitLocation || `${coords.lat},${coords.lng}`,
      display: explicitLocation || `${coords.lat},${coords.lng}`,
      countryCode: undefined,
    };
  }

  // 3) Google Places (best quality) when a key is configured.
  if (googleKey) {
    try {
      const locPart = geo ? `&location=${geo.lat},${geo.lng}&radius=25000` : "";
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(`${what} ${where}`.trim())}${locPart}&key=${googleKey}`;
      const res = await jsonFetch(url, {}, 6000);
      const data = await res.json();
      if (data.results?.length) {
        return {
          source: "Google Places API",
          geo,
          places: data.results.slice(0, 10).map((p: any) => ({
            name: p.name,
            address: p.formatted_address,
            rating: p.rating ?? null,
            totalRatings: p.user_ratings_total ?? null,
            category: (p.types || [])[0] || null,
            phone: null,
            website: null,
            priceLevel: p.price_level != null ? "$".repeat(p.price_level) : null,
            lat: p.geometry?.location?.lat ?? null,
            lng: p.geometry?.location?.lng ?? null,
            mapsUrl: mapsUrlFor(p.name, p.formatted_address, p.geometry?.location?.lat, p.geometry?.location?.lng),
            source: "google",
          })),
        };
      }
    } catch {
      // fall through to Serper
    }
  }

  // 4) Serper Google Maps data (free tier) — anchored by geocoded location.
  if (serperKey) {
    try {
      // Serper's `location`/`ll` alone still returns far-away matches for
      // common terms, so fold the place into the query itself (verified:
      // "pizza in Bagalkot" returns Bagalkot; bare "pizza" does not).
      const body: Record<string, unknown> = {
        q: geo ? `${what} in ${geo.location}` : what,
        num: 20,
      };
      if (geo) {
        body.location = geo.location;
        body.ll = `@${geo.lat},${geo.lng},12z`;
        if (geo.countryCode) body.gl = geo.countryCode;
      }
      const res = await jsonFetch("https://google.serper.dev/places", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }, 8000);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.places) && data.places.length) {
          const places: GeoPlace[] = data.places.map((p: any) => ({
            name: p.title,
            address: p.address || geo?.location || "",
            rating: p.rating ?? null,
            totalRatings: p.ratingCount ?? null,
            category: p.category || null,
            phone: p.phoneNumber || null,
            website: p.website || null,
            priceLevel: p.priceLevel || null,
            lat: p.latitude ?? null,
            lng: p.longitude ?? null,
            mapsUrl: mapsUrlFor(p.title, p.address || "", p.latitude, p.longitude, p.cid ? String(p.cid) : undefined),
            source: "serper",
          }));
          // Safety net: drop anything absurdly far from the geocoded centre
          // (Hyderabad for a Bagalkot query, etc.). Keep the true local set.
          let finalPlaces = places;
          if (geo) {
            const scored = places
              .filter((p) => p.lat != null && p.lng != null)
              .map((p) => ({ p, d: distanceKm(geo.lat, geo.lng, p.lat as number, p.lng as number) }))
              .sort((a, b) => a.d - b.d);
            const local = scored.filter((x) => x.d <= 75).map((x) => x.p);
            if (local.length > 0) finalPlaces = local;
          }
          return {
            source: geo ? `Google Maps (via Serper) · ${geo.location}` : "Google Maps (via Serper)",
            geo,
            places: finalPlaces.slice(0, 10),
          };
        }
      }
    } catch {
      // fall through to OSM
    }
  }

  // 5) OpenStreetMap fallback: geocode already done; find POIs near it via
  //    Nominatim's structured search. Honest — returns nothing if nothing.
  if (geo) {
    try {
      const res = await jsonFetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${what} ${geo.location}`)}&format=jsonv2&addressdetails=1&limit=10&extratags=1`,
        { headers: { "User-Agent": "JARVIS-MCP/1.0 (personal assistant)" } },
        6000
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length) {
          const places: GeoPlace[] = data.map((p: any) => ({
            name: p.name || (p.display_name || "").split(",")[0],
            address: p.display_name,
            rating: null,
            totalRatings: null,
            category: p.type || null,
            phone: p.extratags?.phone || null,
            website: p.extratags?.website || null,
            priceLevel: null,
            lat: parseFloat(p.lat),
            lng: parseFloat(p.lon),
            mapsUrl: mapsUrlFor(p.name || "", p.display_name, parseFloat(p.lat), parseFloat(p.lon)),
            source: "osm",
          }));
          return { source: `OpenStreetMap · ${geo.location}`, geo, places };
        }
      }
    } catch {}
  }

  return null;
}

async function getDirectionsReal(origin: string, destination: string) {
  const o = await geocode(origin);
  const d = await geocode(destination);
  if (!o || !d) {
    return null;
  }
  try {
    const res = await jsonFetch(
      `https://router.project-osrm.org/route/v1/driving/${o.lng},${o.lat};${d.lng},${d.lat}?overview=false&steps=true`,
      {},
      9000
    );
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) return null;
    const steps: string[] = [];
    for (const leg of route.legs || []) {
      for (const s of leg.steps || []) {
        const man = s.maneuver || {};
        const name = s.name ? ` onto ${s.name}` : "";
        const verb = man.type === "depart" ? "Start" : man.modifier ? `${man.type} ${man.modifier}` : man.type;
        steps.push(`${verb}${name} (${Math.round((s.distance || 0) / 10) / 100} km)`);
      }
    }
    return {
      origin: o.display,
      destination: d.display,
      distanceKm: Math.round(route.distance / 100) / 10,
      durationMin: Math.round(route.duration / 60),
      steps: steps.slice(0, 40),
      mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(o.display)}&destination=${encodeURIComponent(d.display)}`,
      source: "OSRM / OpenStreetMap",
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 4. WHATSAPP MCP — honest proxy onto the local daemon
// ─────────────────────────────────────────────────────────────
async function waFetch(p: string, init?: RequestInit): Promise<Response> {
  // Reset/init can take a few seconds while Chromium spawns and mints a QR.
  return jsonFetch(`${WHATSAPP_SERVER_URL}${p}`, init || {}, 20000);
}

async function handleWhatsapp(action: string, params: Json) {
  const clientType = "Headless WhatsApp daemon (whatsapp-web.js)";

  if (action === "get_status") {
    try {
      const r = await waFetch("/status");
      const d = await r.json();
      return ok("whatsapp", action, null, {
        status: d.ready ? "connected" : d.authenticated ? "syncing" : "awaiting_qr",
        isReady: !!d.ready,
        isAuthenticated: !!d.authenticated,
        qrCode: d.qrCode ?? null,
        qrGeneratedAt: d.qrGeneratedAt ?? null,
        error: d.error ?? null,
        clientType,
      });
    } catch {
      return ok("whatsapp", action, null, {
        status: "offline",
        isReady: false,
        isAuthenticated: false,
        qrCode: null,
        clientType,
        error: WHATSAPP_HINT,
      });
    }
  }

  if (action === "init" || action === "reconnect") {
    try {
      const r = await waFetch("/init", { method: "POST" });
      const d = await r.json();
      return ok("whatsapp", action, d, { qrCode: d.qrCode ?? null });
    } catch {
      return fail(WHATSAPP_HINT, 502);
    }
  }

  if (action === "reset") {
    try {
      const r = await waFetch("/reset", { method: "POST" });
      const d = await r.json();
      if (!r.ok) return fail(d.error || "Reset failed", r.status);
      return ok("whatsapp", action, d, { qrCode: d.qrCode ?? null });
    } catch {
      return fail(WHATSAPP_HINT, 502);
    }
  }

  if (action === "list_chats") {
    try {
      const r = await waFetch("/chats");
      const d = await r.json();
      if (!d.success) return ok("whatsapp", action, [], { error: d.error || "WhatsApp not ready" });
      const data = (d.chats || []).slice(0, 60).map((c: any) => ({
        id: c.id,
        name: c.name,
        lastMessage: c.lastMessage || "",
        timestamp: c.timestamp ? new Date(c.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
        unreadCount: c.unreadCount || 0,
        isGroup: !!c.isGroup,
      }));
      return ok("whatsapp", action, data);
    } catch {
      return ok("whatsapp", action, [], { error: WHATSAPP_HINT });
    }
  }

  if (action === "list_contacts") {
    try {
      const r = await waFetch("/contacts");
      const d = await r.json();
      if (!d.success) return ok("whatsapp", action, [], { error: d.error || "WhatsApp not ready" });
      return ok("whatsapp", action, d.contacts || []);
    } catch {
      return ok("whatsapp", action, [], { error: WHATSAPP_HINT });
    }
  }

  // Send by phone number OR by contact name — the daemon resolves names.
  if (action === "send_message") {
    const rawTarget = String(params.recipient ?? params.number ?? params.to ?? params.contact ?? params.name ?? params.recipientName ?? "").trim();
    const message = String(params.message ?? "").trim();
    if (!rawTarget || !message) {
      return fail("Provide a recipient (name or number) and a message", 400);
    }
    const isNum = /^[\+]?[\d\s\-()]{7,}$/.test(rawTarget);
    const payload = isNum
      ? { number: rawTarget.replace(/[\s\-()]/g, ""), message }
      : { name: rawTarget, message };

    try {
      const r = await waFetch("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!d.success) return fail(d.error || "Send failed", r.status || 502);
      return ok("whatsapp", action, {
        recipient: d.recipient,
        chatId: d.chatId,
        message,
        deliveredAt: new Date().toLocaleTimeString(),
        messageId: d.messageId,
        status: "Sent",
      });
    } catch {
      return fail(WHATSAPP_HINT, 502);
    }
  }

  return fail(`Unsupported whatsapp action '${action}'`, 400);
}

// ─────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { mcp, action, params } = await req.json();

    if (!mcp || !action) {
      return fail("Missing mcp or action parameter", 400);
    }

    switch (mcp as string) {
      case "github":
        return await handleGithub(action, params || {});
      case "filesystem":
        return handleFilesystem(action, params || {});
      case "googlemaps": {
        if (action === "search_places") {
          const query = String(params?.query || "").trim();
          if (!query) return fail("query is required", 400);
          const lat = params?.lat != null ? Number(params.lat) : undefined;
          const lng = params?.lng != null ? Number(params.lng) : undefined;
          const coords = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
          // When only coordinates are given, resolve them to a place name so
          // the query reads naturally (e.g. "pizza in Indiranagar, Bengaluru").
          let loc = String(params?.location || "").trim() || undefined;
          if (!loc && coords) {
            const rev = await reverseGeocode(coords.lat, coords.lng);
            loc = rev?.short || rev?.address || undefined;
          }
          const result = await searchPlacesReal(query, loc, coords);
          if (!result) {
            return fail(
              "No live place data available. Add SERPER_API_KEY (or GOOGLE_MAPS_API_KEY) to .env.local, or check your connection.",
              502
            );
          }
          return ok("googlemaps", action, result.places, { source: result.source, geocoded: result.geo || null });
        }
        if (action === "reverse_geocode") {
          const lat = Number(params?.lat);
          const lng = Number(params?.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail("lat and lng are required", 400);
          const rev = await reverseGeocode(lat, lng);
          if (!rev) return fail("Could not resolve that location.", 502);
          return ok("googlemaps", action, { lat, lng, ...rev }, { source: "OpenStreetMap Nominatim" });
        }

        if (action === "get_directions") {
          let origin = String(params?.origin || "").trim();
          const destination = String(params?.destination || params?.to || "").trim();
          // Origin may be the user's live location instead of a place name.
          if (!origin && params?.lat != null && params?.lng != null) {
            const rev = await reverseGeocode(Number(params.lat), Number(params.lng));
            origin = rev?.short || rev?.address || "";
          }
          if (!origin || !destination) return fail("origin and destination are required", 400);
          const dir = await getDirectionsReal(origin, destination);
          if (!dir) return fail("Could not resolve a route between those locations.", 502);
          return ok("googlemaps", action, dir, { source: dir.source });
        }
        return fail(`Unsupported googlemaps action '${action}'`, 400);
      }
      case "whatsapp":
        return await handleWhatsapp(action, params || {});
      case "diplomat": {
        const { handleDiplomat } = await import("@/lib/mcp/diplomatHandler");
        const res = await handleDiplomat(action, params || {});
        return NextResponse.json(res);
      }
      case "vitals": {
        const { handleVitals } = await import("@/lib/mcp/vitalsHandler");
        const res = await handleVitals(action, params || {});
        return NextResponse.json(res);
      }
      case "cad": {
        const { handleCad } = await import("@/lib/mcp/cadHandler");
        const res = await handleCad(action, params || {});
        return NextResponse.json(res);
      }
      default:
        return fail(`Unknown mcp provider '${mcp}'`, 400);
    }
  } catch (err: any) {
    console.error("[MCP Gateway Error]:", err);
    return fail(err?.message || "MCP execution error", 500);
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    providers: ["github", "filesystem", "googlemaps", "whatsapp", "diplomat", "vitals", "cad"],
    projectRoot: PROJECT_ROOT,
  });
}
