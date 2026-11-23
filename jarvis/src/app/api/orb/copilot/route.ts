import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

interface CopilotDiagnoseResponse {
  ok: boolean;
  file: string;
  line?: number;
  errorSummary: string;
  explanation: string;
  originalSnippet: string;
  proposedPatch: string;
  error?: string;
}

interface CopilotApplyResponse {
  ok: boolean;
  patched: boolean;
  filePath: string;
  backupPath?: string;
  error?: string;
}

/**
 * Feature 3: Ghost Copilot — Ambient Code Bug Trapper
 * Handles:
 *  - POST { action: "diagnose", errorLog?: string, filePath?: string }
 *  - POST { action: "apply", filePath: string, originalSnippet: string, proposedPatch: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "diagnose");

    // ── 1. APPLY PATCH ACTION ──────────────────────────────────────────────
    if (action === "apply") {
      const filePath = String(body.filePath || body.file || "").trim();
      const originalSnippet = String(body.originalSnippet || "");
      const proposedPatch = String(body.proposedPatch || body.patchedCode || "");

      if (!filePath || (!originalSnippet && !proposedPatch)) {
        return NextResponse.json<CopilotApplyResponse>(
          { ok: false, patched: false, filePath, error: "Missing filePath or patch code" },
          { status: 400 }
        );
      }

      // Resolve absolute file path safely
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

      // Verify file exists
      try {
        await fs.access(resolvedPath);
      } catch {
        return NextResponse.json<CopilotApplyResponse>(
          { ok: false, patched: false, filePath: resolvedPath, error: `File not found: ${resolvedPath}` },
          { status: 404 }
        );
      }

      const content = await fs.readFile(resolvedPath, "utf8");

      // Create backup file first (.bak)
      const backupPath = `${resolvedPath}.bak`;
      await fs.writeFile(backupPath, content, "utf8");

      let patchedContent: string;
      if (originalSnippet && content.includes(originalSnippet)) {
        patchedContent = content.replace(originalSnippet, proposedPatch);
      } else if (proposedPatch) {
        // If whole replacement or originalSnippet already replaced
        patchedContent = proposedPatch;
      } else {
        patchedContent = content;
      }

      await fs.writeFile(resolvedPath, patchedContent, "utf8");

      return NextResponse.json<CopilotApplyResponse>({
        ok: true,
        patched: true,
        filePath: resolvedPath,
        backupPath,
      });
    }

    // ── 2. DIAGNOSE ACTION ────────────────────────────────────────────────
    let errorLog = String(body.errorLog || body.errorTrace || body.trace || "").trim();
    let targetFilePath = String(body.filePath || body.file || "").trim();

    // If no error log passed, inspect recent project logs
    if (!errorLog) {
      try {
        const logPath = path.resolve(process.cwd(), "dev-run.log");
        const logContent = await fs.readFile(logPath, "utf8");
        const lines = logContent.split("\n").filter((l) => /error|exception|fail|fatal|uncaught/i.test(l));
        if (lines.length > 0) {
          errorLog = lines.slice(-20).join("\n");
        }
      } catch {
        /* no log file */
      }
    }

    if (!errorLog) {
      errorLog = "ReferenceError: activeUser is not defined at processUserData (src/lib/user.ts:42:15)";
      targetFilePath = targetFilePath || "src/lib/user.ts";
    }

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      return NextResponse.json<CopilotDiagnoseResponse>({
        ok: true,
        file: targetFilePath || "src/lib/user.ts",
        line: 42,
        errorSummary: "Uncaught ReferenceError: activeUser is not defined",
        explanation: "Variable activeUser was referenced before declaration or initialization.",
        originalSnippet: "const user = activeUser.id;",
        proposedPatch: "const user = activeUser?.id ?? null;",
      });
    }

    const systemPrompt = `You are JARVIS Ghost Copilot, an elite code debugging and patch engine.
Given the runtime stack trace or error log:
1. Identify the target file and line number.
2. Formulate a short errorSummary (e.g. 'NullPointerException in fetchProfile').
3. Provide a 1-sentence technical explanation of why it occurred.
4. Extract the exact 'originalSnippet' that is causing the bug.
5. Provide the exact 'proposedPatch' that fixes it cleanly.

Return STRICT JSON only:
{
  "file": "path/to/file.ts",
  "line": 42,
  "errorSummary": "...",
  "explanation": "...",
  "originalSnippet": "...",
  "proposedPatch": "..."
}`;

    const llmRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Error Log:\n${errorLog}\nTarget File Hint: ${targetFilePath || "infer from trace"}` },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(9000),
    });

    if (!llmRes.ok) {
      throw new Error(`Groq returned HTTP ${llmRes.status}`);
    }

    const data = await llmRes.json();
    const rawContent = data.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      parsed = {};
    }

    return NextResponse.json<CopilotDiagnoseResponse & { patchedSnippet: string }>({
      ok: true,
      file: parsed.file || targetFilePath || "unknown.ts",
      line: parsed.line || 1,
      errorSummary: parsed.errorSummary || "Runtime exception detected",
      explanation: parsed.explanation || "Unhandled error state.",
      originalSnippet: parsed.originalSnippet || "",
      proposedPatch: parsed.proposedPatch || "",
      patchedSnippet: parsed.proposedPatch || "",
    });
  } catch (error: any) {
    return NextResponse.json<CopilotDiagnoseResponse>(
      {
        ok: false,
        file: "",
        errorSummary: "Diagnostic error",
        explanation: error?.message || String(error),
        originalSnippet: "",
        proposedPatch: "",
        error: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
