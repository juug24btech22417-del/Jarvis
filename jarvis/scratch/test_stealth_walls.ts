// Live test of the hardened engine stealth vs. real bot walls.
// Run: npx tsx scratch/test_stealth_walls.ts
import { createAgentSession } from "../src/lib/browser/engine";

const TARGETS: Array<[string, string]> = [
  ["amazon", "https://www.amazon.in/s?k=wireless+keyboard"],
  ["flipkart", "https://www.flipkart.com/search?q=wireless+keyboard"],
];

async function main() {
  let failures = 0;
  for (const [name, url] of TARGETS) {
    const session = await createAgentSession();
    try {
      await session.goto(url);
      await session.page.waitForTimeout(2500);
      const wall = await session.captcha();
      const snap = await session.snapshot();
      const title = snap.title.slice(0, 70);
      const hasProducts = /₹/.test(snap.text);
      console.log(`[${name}] wall=${wall} productsVisible=${hasProducts} title="${title}" url=${session.url().slice(0, 80)}`);
      if (wall || !hasProducts) failures += 1;
    } catch (e) {
      console.log(`[${name}] ERROR: ${(e as Error).message.slice(0, 140)}`);
      failures += 1;
    } finally {
      await session.close();
    }
  }
  console.log(failures === 0 ? "ALL CLEAR" : `${failures} target(s) walled`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
