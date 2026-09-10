// Journey engine smoke test — patterns, duration math, throwbacks.
import { PrismaClient } from "@prisma/client";
import {
  isJourneyQuestion,
  parseTimeWindow,
  formatDuration,
  getThrowback,
  getAnniversary,
  JOURNEY_EPOCH,
} from "../src/lib/companion/journey";

const prisma = new PrismaClient();

async function main() {
  console.log("── Journey phrasings (should all be true) ──");
  const yes = [
    "how far have we come",
    "How much have we grown since the beginning?",
    "how long have we been at this",
    "our journey so far",
    "remember when we started",
    "how old is this project",
    "100 days of us",
    "what have we built so far together",
    "come a long way havent we",
    "JOURNEY SO FAR BOSS",
  ];
  for (const t of yes) console.log(`${isJourneyQuestion(t) ? "PASS" : "FAIL"} | ${t}`);

  console.log("── Non-journey (should all be false) ──");
  const no = [
    "what's the weather",
    "set a timer for 10 minutes",
    "how's my cpu doing",
    "play some spotify",
  ];
  for (const t of no) console.log(`${!isJourneyQuestion(t) ? "PASS" : "FAIL"} | ${t}`);

  console.log("── Duration math ──");
  const d = formatDuration(JOURNEY_EPOCH, new Date("2026-09-10T12:00:00+05:30"));
  console.log(`${d.text === "five months and four days" ? "PASS" : "FAIL"} | epoch → "${d.text}" (want "five months and four days")`);
  const d2 = formatDuration(new Date("2026-04-06T19:52:36+05:30"), new Date("2027-04-06T19:52:36+05:30"));
  console.log(`${d2.text === "one year" ? "PASS" : "FAIL"} | exactly one year → "${d2.text}"`);

  console.log("── Time windows ──");
  const w1 = parseTimeWindow("what did we do last week?");
  console.log(`${w1?.label === "the past week" ? "PASS" : "FAIL"} | last week → "${w1?.label}"`);
  const w2 = parseTimeWindow("what have we been doing in the last 3 days");
  console.log(`${w2?.label === "the last 3 days" ? "PASS" : "FAIL"} | last 3 days → "${w2?.label}"`);

  console.log("── Throwback (synthetic milestone, cleaned up after) ──");
  const fake = await prisma.milestone.create({
    data: { title: "vision capture engine", category: "auto", happenedAt: new Date("2026-07-10T12:00:00+05:30") },
  });
  const tb = await getThrowback(new Date("2026-09-10T12:00:00+05:30"));
  console.log(`${tb?.includes("two months ago today, we shipped **vision capture engine**") ? "PASS" : "FAIL"} | "${tb}"`);
  await prisma.milestone.delete({ where: { id: fake.id } });
  const tb2 = await getThrowback(new Date("2026-09-10T12:00:00+05:30"));
  console.log(`${tb2 === null ? "PASS" : "FAIL"} | cleanup → null`);

  console.log("── Anniversary (day 200 completes 2026-10-23 19:52 IST) ──");
  const ann = await getAnniversary(new Date("2026-10-23T20:00:00+05:30"));
  console.log(`${ann?.includes("Day 200 of us") ? "PASS" : "FAIL"} | "${ann}"`);
  const ann2 = await getAnniversary(new Date("2026-10-23T12:00:00+05:30"));
  console.log(`${ann2 === null ? "PASS" : "FAIL"} | day-199 noon → null`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("ERR:", e.message);
    await prisma.$disconnect();
    process.exit(1);
  });
