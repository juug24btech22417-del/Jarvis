// repo_inspect — pure parsing/formatting layer.
//
// AgentService reads package.json and shells out to `npm outdated` /
// `npm view`; the shape of those answers is interpreted here so the rules are
// testable without npm on the box.

export interface PackageFacts {
  name: string;
  version: string;
  dependencies: string[];
  devDependencies: string[];
  scripts: string[];
  /** Raw dependency count (includes optional/peer when present). */
  totalDeps: number;
}

export interface OutdatedRow {
  name: string;
  current: string;
  wanted: string;
  latest: string;
}

/**
 * A package name safe to hand to `npm view` — blocks anything that could be
 * read as a flag, a path, or a shell metacharacter.
 */
export function isSafePackageName(name: string): boolean {
  const n = (name || "").trim();
  if (!n || n.length > 214) return false;
  if (n.startsWith("-")) return false;
  return /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(n);
}

/** Interpret a parsed package.json. Returns null when the shape is unusable. */
export function parsePackageFacts(raw: unknown): PackageFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const keys = (v: unknown): string[] =>
    v && typeof v === "object" ? Object.keys(v as Record<string, unknown>).sort() : [];
  const deps = keys(p.dependencies);
  const devDeps = keys(p.devDependencies);
  if (!deps.length && !devDeps.length && typeof p.name !== "string") return null;
  return {
    name: typeof p.name === "string" ? p.name : "(unnamed)",
    version: typeof p.version === "string" ? p.version : "0.0.0",
    dependencies: deps,
    devDependencies: devDeps,
    scripts: keys(p.scripts),
    totalDeps: deps.length + devDeps.length,
  };
}

/** Normalise a parsed `npm outdated --json` payload into rows. */
export function parseOutdated(raw: unknown): OutdatedRow[] {
  if (!raw || typeof raw !== "object") return [];
  const out: OutdatedRow[] = [];
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = (v ?? {}) as Record<string, unknown>;
    if (typeof r !== "object") continue;
    out.push({
      name,
      current: typeof r.current === "string" ? r.current : "?",
      wanted: typeof r.wanted === "string" ? r.wanted : "?",
      latest: typeof r.latest === "string" ? r.latest : "?",
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Markdown summary a mission report can embed directly. */
export function summarizeRepoInspect(
  facts: PackageFacts,
  outdated: OutdatedRow[],
  extras: { package?: string; packageLatest?: string; path?: string } = {}
): string {
  const lines: string[] = [];
  lines.push(`### 🔎 Repository inspection`);
  lines.push(`**Package:** \`${facts.name}\`@${facts.version}`);
  if (extras.path) lines.push(`**Path:** \`${extras.path}\``);
  lines.push(`**Dependencies:** ${facts.dependencies.length} runtime · ${facts.devDependencies.length} dev`);
  if (facts.scripts.length) lines.push(`**Scripts:** ${facts.scripts.join(", ")}`);
  if (extras.package) lines.push(`\n**Latest \`${extras.package}\`:** ${extras.packageLatest ?? "unknown"}`);
  if (outdated.length) {
    lines.push(`\n**Outdated packages (${outdated.length}):**`);
    for (const r of outdated.slice(0, 25)) {
      lines.push(`- \`${r.name}\`: ${r.current} → ${r.latest}${r.wanted !== r.latest ? ` (wanted ${r.wanted})` : ""}`);
    }
  } else {
    lines.push(`\n✅ **All dependencies look up to date.**`);
  }
  return lines.join("\n");
}

/** Top-level dependencies that look up to date but aren't pinned to latest. */
export function outdatedNames(rows: OutdatedRow[]): string[] {
  return rows.map((r) => r.name);
}
