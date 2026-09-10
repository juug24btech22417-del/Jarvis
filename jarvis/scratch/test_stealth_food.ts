// One-off: verify Swiggy/Zomato don't wall the hardened engine.
// Run: npx tsx scratch/test_stealth_food.ts
import { createAgentSession } from "../src/lib/browser/engine";

async function t(name: string, url: string) {
  const s = await createAgentSession();
  try {
    await s.goto(url);
    await s.page.waitForTimeout(2500);
    const wall = await s.captcha();
    const snap = await s.snapshot();
    console.log(`[${name}] wall=${wall} textLen=${snap.text.length} title="${snap.title.slice(0, 60)}"`);
  } catch (e) {
    console.log(`[${name}] ERR: ${(e as Error).message.slice(0, 120)}`);
  } finally {
    await s.close();
  }
}

async function main() {
  await t("swiggy", "https://www.swiggy.com/search?query=pizza");
  await t("zomato", "https://www.zomato.com/ncr/restaurants");
  process.exit(0); // browser singleton keeps the loop alive otherwise
}
main();
