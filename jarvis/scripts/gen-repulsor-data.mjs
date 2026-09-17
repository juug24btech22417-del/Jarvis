/** One-shot generator: embed public/sounds/repulsor.mp3 as a base64 module. */
import fs from "fs";

const mp3 = fs.readFileSync("public/sounds/repulsor.mp3");
const b64 = mp3.toString("base64");

const header = [
  "/**",
  " * AUTO-GENERATED from public/sounds/repulsor.mp3 — do not edit by hand.",
  " * Regenerate with:  node scratch/gen-repulsor-data.mjs",
  " *",
  " * The blast is embedded as raw base64. sounds.ts decodes it into a Blob",
  " * and plays it via a blob: URL — playback never touches the network.",
  " * Why: the dashboard holds several long-lived HTTP connections (SSE",
  " * stream, polling, HMR websocket) and Chromium caps ~6 per host, so a",
  " * media request for /sounds/repulsor.mp3 stalled forever (readyState 0).",
  " * A data: URI was tried first but Chromium's media stack rejects those",
  " * outright (NotSupportedError) — blob: URLs are the supported in-memory path.",
  " */",
  "export const REPULSOR_B64 =",
  '  "' + b64 + '";',
  "",
].join("\n");

fs.writeFileSync("src/lib/repulsorData.ts", header);
console.log("src/lib/repulsorData.ts written,", mp3.length, "bytes embedded");
