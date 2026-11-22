import { NextRequest, NextResponse } from "next/server";
import {
  groundTarget,
  bestMatch,
  GROUND_ACCEPT,
  type GroundCandidate,
} from "@/lib/screen/elementGrounding";

/**
 * POST /api/screen/ground
 * Body: { query: string, candidates?: GroundCandidate[] }
 *
 * When no candidates are supplied:
 *  1. Calls GET /api/screenshot/capture?context=1 to get the real
 *     foreground window title + visible app list from PowerShell.
 *  2. Derives real candidates from that live desktop context.
 *  3. Falls back gracefully when PowerShell is unavailable.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const query = String(body.query || "").trim();
    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    // If the caller already knows the candidates, use them directly.
    if (Array.isArray(body.candidates) && body.candidates.length > 0) {
      return jsonGroundResult(query, body.candidates as GroundCandidate[], "caller-supplied");
    }

    // ── Derive real candidates from the live desktop context ──────────────
    const { candidates, source } = await buildRealCandidates(req, query);
    return jsonGroundResult(query, candidates, source);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function jsonGroundResult(
  query: string,
  candidates: GroundCandidate[],
  source: string
) {
  const match  = bestMatch(query, candidates);
  const ranked = groundTarget(query, candidates);

  return NextResponse.json({
    ok: true,
    query,
    source,
    match: match
      ? {
          ref:        match.ref,
          role:       match.role,
          name:       match.name,
          confidence: match.confidence,
          accepted:   (match.confidence ?? 0) >= GROUND_ACCEPT,
          why:        match.why,
        }
      : null,
    topCandidates: ranked.slice(0, 3).map((c) => ({
      ref:        c.ref,
      role:       c.role,
      name:       c.name,
      confidence: c.confidence,
    })),
    candidatesUsed: candidates.length,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

async function buildRealCandidates(
  req: NextRequest,
  query: string
): Promise<{ candidates: GroundCandidate[]; source: string }> {
  try {
    // Call our own screenshot/capture endpoint in context-only mode (fast, no bitmap)
    const origin = req.nextUrl.origin;
    const ctxRes = await fetch(`${origin}/api/screenshot/capture?context=1`, {
      signal: AbortSignal.timeout(8000),
    });

    if (!ctxRes.ok) throw new Error(`context endpoint returned ${ctxRes.status}`);
    const ctxData = (await ctxRes.json()) as {
      desktopContext?: string;
      success?: boolean;
    };

    const ctx = ctxData.desktopContext ?? "";
    const candidates = parseContextToCandidates(ctx, query);
    return { candidates, source: "live-desktop" };
  } catch (err) {
    console.warn("[screen/ground] context fetch failed:", (err as Error)?.message);
    // Minimal fallback: treat the query itself as the named target
    return {
      candidates: [{ ref: "query-target", role: "button", name: query }],
      source: "query-fallback",
    };
  }
}

/**
 * Parse the PowerShell desktop context string into GroundCandidates.
 *
 * Example context:
 *   FOREGROUND_WINDOW: Visual Studio Code
 *   FOREGROUND_PROCESS: code
 *   VISIBLE_WINDOWS:
 *     - [chrome] YouTube – Google Chrome
 *     - [code] JARVIS – Visual Studio Code
 */
function parseContextToCandidates(ctx: string, query: string): GroundCandidate[] {
  const candidates: GroundCandidate[] = [];

  const fgWindowMatch  = ctx.match(/FOREGROUND_WINDOW:\s*(.+)/);
  const fgProcessMatch = ctx.match(/FOREGROUND_PROCESS:\s*(.+)/);
  const fgTitle        = fgWindowMatch?.[1]?.trim();
  const fgProcess      = fgProcessMatch?.[1]?.trim();

  if (fgTitle) {
    candidates.push({ ref: "fg-window",  role: "window",      name: fgTitle   });
  }
  if (fgProcess) {
    candidates.push({ ref: "fg-process", role: "application", name: fgProcess });
  }

  // Parse every visible window
  const visibleBlock = ctx.match(/VISIBLE_WINDOWS:([\s\S]*?)(?:TOP_PROCESSES:|$)/);
  if (visibleBlock) {
    for (const line of visibleBlock[1].split("\n")) {
      const m = line.match(/\s*-\s*\[([^\]]+)\]\s*(.+)/);
      if (!m) continue;
      const [, proc, title] = m;
      const ref = `win-${proc.trim().toLowerCase().replace(/\W+/g, "-")}`;
      if (!candidates.some((c) => c.ref === ref)) {
        candidates.push({ ref, role: "window", name: title.trim() });
      }
    }
  }

  // If nothing was parsed, build candidates from query words
  if (candidates.length === 0) {
    const words = query.split(/\s+/).filter((w) => w.length > 2);
    words.forEach((word, i) => {
      candidates.push({ ref: `q-${i}`, role: "button", name: word });
    });
    candidates.push({ ref: "q-full", role: "window", name: query });
  }

  return candidates;
}
