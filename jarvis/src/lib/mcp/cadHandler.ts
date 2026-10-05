import { parseJsonLoose } from "@/lib/llm/fastJson";

export interface CadModelResult {
  name: string;
  description: string;
  dimensions: { widthMm: number; heightMm: number; depthMm: number };
  openScadCode: string;
  printEstimates: {
    printTimeMinutes: number;
    filamentWeightGrams: number;
    layerCount: number;
    recommendedMaterial: string;
  };
  meshPreset: "phone_stand" | "hex_case" | "bearing_gear" | "cable_clip" | "drone_mount" | "custom_box";
}

export type MeshPreset = CadModelResult["meshPreset"];

// ─────────────────────────────────────────────────────────────
// Fast path: build a complete, printable parametric model locally.
// This is deterministic and instant, so the UI never sits on a spinner
// waiting for a remote model. An LLM pass may still improve it, but only
// if it answers inside a tight deadline (see LLM_BUDGET_MS).
// ─────────────────────────────────────────────────────────────

const LLM_BUDGET_MS = 2600;

interface LocalSpec {
  name: string;
  description: string;
  width: number;
  height: number;
  depth: number;
  material: string;
  meshPreset: MeshPreset;
}

function specFor(prompt: string): LocalSpec {
  const p = prompt.toLowerCase();

  if (/\b(gear|planetary|pinion|cog)\b/.test(p)) {
    return {
      name: "Planetary Gear",
      description:
        "Self-centering planetary gear with a central sun gear and three orbiting planet gears. Clearances tuned for FDM printing.",
      width: 64, height: 14, depth: 64, material: "PLA", meshPreset: "bearing_gear",
    };
  }
  if (/\b(drone|motor mount|quadcopter|propeller)\b/.test(p)) {
    return {
      name: "Drone Motor Mount",
      description:
        "Hexagonal motor mount sized for 2204/2206 brushless motors with a slotted arm clamp.",
      width: 46, height: 30, depth: 46, material: "PETG", meshPreset: "drone_mount",
    };
  }
  if (/\b(cable|clip|clamp|wire|organis|organiz)\b/.test(p)) {
    return {
      name: "Cable Management Clip",
      description:
        "Compact snap-on cable clip that captures 4–6 mm cables with a compliant retention jaw.",
      width: 24, height: 18, depth: 12, material: "TPU", meshPreset: "cable_clip",
    };
  }
  if (/\b(case|box|enclosure|housing|container|capsule)\b/.test(p)) {
    return {
      name: "Custom Enclosure",
      description:
        "Parametric snap-fit enclosure with rounded corners and a removable lid for electronics projects.",
      width: 80, height: 34, depth: 60, material: "PLA", meshPreset: "custom_box",
    };
  }
  if (/\b(hex|hexagonal|honeycomb|bracket)\b/.test(p)) {
    return {
      name: "Hexagonal Mount",
      description:
        "Six-sided mounting body with a reinforced core and M3 bolt bosses.",
      width: 52, height: 26, depth: 52, material: "PETG", meshPreset: "hex_case",
    };
  }
  return {
    name: "Parametric Phone Stand",
    description:
      "Ergonomic desk stand with an adjustable viewing tilt, a retention lip, and integrated cable routing.",
    width: totalWidth(prompt, 70), height: 95, depth: 80, material: "PLA", meshPreset: "phone_stand",
  };
}

/** Pull an explicit size out of the prompt ("120mm wide", "90 mm") when present. */
function totalWidth(prompt: string, fallback: number): number {
  const m = prompt.match(/\b(\d{2,3})\s*mm\b/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 20 && n <= 300) return Math.round(n);
  }
  return fallback;
}

function scadFor(spec: LocalSpec): string {
  const { width: w, height: h, depth: d } = spec;
  const head =
    `// JARVIS Mark Prototype — ${spec.name}\n` +
    `// Auto-generated parametric model (millimetres). Tune the parameters below.\n` +
    `$fn = 64;\n` +
    `width = ${w};\n` +
    `height = ${h};\n` +
    `depth = ${d};\n`;

  switch (spec.meshPreset) {
    case "bearing_gear":
      return (
        head +
        `teeth = 18;\n` +
        `diameter = width;\n\n` +
        `module difference() {\n` +
        `  union() {\n` +
        `    // Sun gear\n` +
        `    cylinder(h = height, d = diameter * 0.5, center = true);\n` +
        `    // Teeth ring\n` +
        `    for (a = [0 : 360 / teeth : 359])\n` +
        `      rotate([0, 0, a])\n` +
        `        translate([diameter * 0.28, 0, 0])\n` +
        `          cube([diameter * 0.08, diameter * 0.06, height], center = true);\n` +
        `  }\n` +
        `  // Central shaft bore\n` +
        `  cylinder(h = height + 2, d = diameter * 0.16, center = true);\n` +
        `}\n`
      );
    case "drone_mount":
      return (
        head +
        `bore = 6.5;\n` +
        `spacing = 16;\n\n` +
        `difference() {\n` +
        `  union() {\n` +
        `    cylinder(h = height * 0.35, d = width, $fn = 6, center = true);\n` +
        `    translate([0, 0, height * 0.4]) cylinder(h = height * 0.5, d = width * 0.5, center = true);\n` +
        `    translate([0, -depth * 0.3, 6]) cube([depth * 0.22, depth * 0.6, 12], center = true);\n` +
        `  }\n` +
        `  translate([0, 0, height * 0.5]) cylinder(h = 30, d = bore, center = true);\n` +
        `  for (x = [-spacing / 2, spacing / 2])\n` +
        `    translate([x, 0, 8]) cylinder(h = 24, d = 2.4, center = true);\n` +
        `}\n`
      );
    case "cable_clip":
      return (
        head +
        `gap = 6;\n` +
        `wall = 2.4;\n\n` +
        `difference() {\n` +
        `  union() {\n` +
        `    cube([width, depth, height * 0.4], center = true);\n` +
        `    translate([0, 0, height * 0.35]) cube([width, depth * 0.7, height * 0.5], center = true);\n` +
        `  }\n` +
        `  // Cable channel\n` +
        `  translate([0, -depth * 0.2, 0]) cylinder(h = height + 4, d = gap + wall, center = true);\n` +
        `  // Snap jaw slit\n` +
        `  translate([0, -depth * 0.55, 0]) cube([gap, depth, height + 4], center = true);\n` +
        `}\n`
      );
    case "custom_box":
      return (
        head +
        `wall = 2.2;\n\n` +
        `difference() {\n` +
        `  union() {\n` +
        `    cube([width, depth, height], center = true);\n` +
        `    translate([0, 0, height / 2 + 1.6]) cube([width, depth, 4], center = true);\n` +
        `  }\n` +
        `  translate([0, 0, wall])\n` +
        `    cube([width - wall * 2, depth - wall * 2, height + 6], center = true);\n` +
        `}\n`
      );
    case "hex_case":
      return (
        head +
        `wall = 2.5;\n\n` +
        `difference() {\n` +
        `  cylinder(h = height, d = width, $fn = 6, center = true);\n` +
        `  cylinder(h = height + 2, d = width - wall * 2, $fn = 6, center = true);\n` +
        `  translate([0, 0, height * 0.25]) cylinder(h = height, d = 4, center = true);\n` +
        `}\n`
      );
    case "phone_stand":
    default:
      return (
        head +
        `thickness = 6;\n` +
        `tilt = 20;\n\n` +
        `difference() {\n` +
        `  union() {\n` +
        `    // Base plate\n` +
        `    cube([width, depth, thickness], center = true);\n` +
        `    // Tilted backrest\n` +
        `    rotate([tilt, 0, 0])\n` +
        `      translate([0, depth * 0.25, height / 2])\n` +
        `        cube([width * 0.92, thickness, height], center = true);\n` +
        `    // Retention lip\n` +
        `    translate([0, -depth * 0.38, height * 0.14])\n` +
        `      cube([width * 0.92, 10, height * 0.22], center = true);\n` +
        `  }\n` +
        `  // Cable routing channel\n` +
        `  translate([0, -depth * 0.1, 0])\n` +
        `    cylinder(h = thickness + 4, d = 14, center = true);\n` +
        `}\n`
      );
  }
}

/** Rough FDM estimate from the solid volume: 20% infill PLA ≈ 1.24 g/cm³. */
function estimatesFor(spec: LocalSpec) {
  const volumeCm3 = (spec.width * spec.height * spec.depth) / 1000; // mm³ → cm³
  const solidGrams = volumeCm3 * 1.24;
  const filamentWeightGrams = Math.max(4, Math.round(solidGrams * 0.28));
  const layerCount = Math.max(20, Math.round(spec.height / 0.2));
  const printTimeMinutes = Math.max(
    8,
    Math.round(filamentWeightGrams * 1.6 + layerCount * 0.05)
  );
  return { printTimeMinutes, filamentWeightGrams, layerCount, recommendedMaterial: spec.material };
}

export function buildLocalModel(prompt: string): CadModelResult {
  const spec = specFor(prompt);
  return {
    name: spec.name,
    description: spec.description,
    dimensions: { widthMm: spec.width, heightMm: spec.height, depthMm: spec.depth },
    openScadCode: scadFor(spec),
    printEstimates: estimatesFor(spec),
    meshPreset: spec.meshPreset,
  };
}

// ─────────────────────────────────────────────────────────────
// Optional LLM refinement — raced against a hard deadline so a slow or
// dead provider can never make the UI feel like it stalled.
// ─────────────────────────────────────────────────────────────

const CAD_PROMPT = (prompt: string) =>
  `/no_think\nReturn ONLY a JSON object (no markdown, no code fences) with exactly these keys:\nname, description, widthMm, heightMm, depthMm, openScadCode, printTimeMinutes, filamentWeightGrams, layerCount, recommendedMaterial, meshPreset\n\nGenerate complete valid OpenSCAD code in openScadCode (use \\n for newlines).\nmeshPreset must be one of: phone_stand, hex_case, bearing_gear, cable_clip, drone_mount, custom_box\n\nDesign this 3D printable part: "${prompt}"`;

async function tryGroqCadNoThink(prompt: string): Promise<any | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key || key.includes("your_")) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_BUDGET_MS);
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        temperature: 0.1,
        max_tokens: 750,
        messages: [{ role: "user", content: CAD_PROMPT(prompt) }],
      }),
    });
    if (!res.ok) {
      console.warn("[CadHandler] Groq HTTP", res.status);
      return null;
    }
    const data = await res.json();
    const raw: string | undefined = data?.choices?.[0]?.message?.content;
    if (!raw) return null;
    const stripped = raw.replace(/ thinking[\s\S]*?<\/think>/gi, "").trim();
    return parseJsonLoose(stripped);
  } catch (e: any) {
    console.warn("[CadHandler] Groq failed:", e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function tryGeminiCad(prompt: string): Promise<any | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.includes("your_")) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_BUDGET_MS);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: "You are a 3D CAD generator. Return ONLY valid JSON, no markdown." }],
          },
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
            maxOutputTokens: 700,
            thinkingConfig: { thinkingBudget: 0 },
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Return JSON with: name, description, widthMm, heightMm, depthMm, openScadCode, printTimeMinutes, filamentWeightGrams, layerCount, recommendedMaterial, meshPreset.\nDesign: ${prompt}`,
                },
              ],
            },
          ],
        }),
      }
    );
    if (!res.ok) {
      console.warn("[CadHandler] Gemini HTTP", res.status);
      return null;
    }
    const data = await res.json();
    const raw: string | undefined = data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("");
    return raw ? parseJsonLoose(raw) : null;
  } catch (e: any) {
    console.warn("[CadHandler] Gemini failed:", e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Race providers and resolve with the first non-null result, or `null` once
 * `deadlineMs` elapses. Resolving early does not cancel the underlying
 * fetches — their own abort timers still fire — but the caller stops waiting.
 */
function raceProviders(prompt: string, deadlineMs: number): Promise<any | null> {
  const attempts = [tryGroqCadNoThink(prompt), tryGeminiCad(prompt)];
  const first = new Promise<any>((resolve) => {
    let pending = attempts.length;
    let done = false;
    for (const p of attempts) {
      p.then((val) => {
        if (done) return;
        if (val !== null) {
          done = true;
          resolve(val);
          return;
        }
        if (--pending === 0) resolve(null);
      }).catch(() => {
        if (!done && --pending === 0) resolve(null);
      });
    }
  });
  const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), deadlineMs));
  return Promise.race([first, deadline]);
}

const VALID_PRESETS: MeshPreset[] = [
  "phone_stand",
  "hex_case",
  "bearing_gear",
  "cable_clip",
  "drone_mount",
  "custom_box",
];

/** Overlay only the fields the LLM actually produced and that look sane. */
function mergeLlm(local: CadModelResult, llm: any): CadModelResult {
  if (!llm || typeof llm !== "object") return local;
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const str = (v: unknown, fallback: string) =>
    typeof v === "string" && v.trim() ? v.trim() : fallback;
  return {
    name: str(llm.name, local.name),
    description: str(llm.description, local.description),
    dimensions: {
      widthMm: num(llm.widthMm, local.dimensions.widthMm),
      heightMm: num(llm.heightMm, local.dimensions.heightMm),
      depthMm: num(llm.depthMm, local.dimensions.depthMm),
    },
    openScadCode:
      typeof llm.openScadCode === "string" && llm.openScadCode.length > 40
        ? llm.openScadCode
        : local.openScadCode,
    printEstimates: {
      printTimeMinutes: num(llm.printTimeMinutes, local.printEstimates.printTimeMinutes),
      filamentWeightGrams: num(llm.filamentWeightGrams, local.printEstimates.filamentWeightGrams),
      layerCount: num(llm.layerCount, local.printEstimates.layerCount),
      recommendedMaterial: str(llm.recommendedMaterial, local.printEstimates.recommendedMaterial),
    },
    meshPreset: VALID_PRESETS.includes(llm.meshPreset) ? llm.meshPreset : local.meshPreset,
  };
}

export async function handleCad(action: string, params: Record<string, any>) {
  if (action === "generate") {
    const prompt = String(params.prompt || "iPhone desk stand with 20 degree tilt").trim();

    // 1) Instant local model — the response is never blocked on the network.
    const local = buildLocalModel(prompt);

    // 2) Give the LLM a short head start; only accept it if it beats the
    //    deadline. On timeout we return the (already complete) local model.
    let model = local;
    try {
      const llm = await raceProviders(prompt, LLM_BUDGET_MS);
      if (llm) model = mergeLlm(local, llm);
    } catch {
      // keep the local model
    }

    return {
      success: true,
      mcp: "cad",
      action,
      data: model,
      meta: { source: model === local ? "parametric" : "llm+parametric", budgetMs: LLM_BUDGET_MS },
    };
  }

  return { success: false, error: `Unsupported cad action '${action}'` };
}
