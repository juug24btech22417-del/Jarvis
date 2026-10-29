/**
 * End-to-end: the meeting bot's two new powers, against a real browser.
 *
 *  1. AUTO-ATTEND — a Google Calendar event that started 30 seconds ago and
 *     carries a conference link in its `location` field is handed to the
 *     scheduler; the scheduler must join it with no human in the loop, and must
 *     leave the future / finished / link-less / all-day events alone.
 *
 *  2. VISUAL SUMMARY — while the bot attends, the "lecture" switches from a
 *     circuit diagram to a worked quadratic to a bar chart. The bot must capture
 *     the shared screen, drop frames that did not change, send the kept frames
 *     through the vision model, and attach them — described and labelled — to
 *     the meeting summary (and to the Notion note).
 *
 * The meeting itself is a local page that looks like Google Meet to the bot
 * (a `meet.google.com` path, caption DOM, leave button, a Join-now button), so
 * every real code path runs — Chrome launch, join flow, caption scraper, capture
 * engine, Gemini vision, summariser, Notion upload — without needing a live
 * lecture. Only the scheduler's calendar feed is injected (a dev-only seam).
 *
 * Dev server first, then:  node scripts/e2e-meeting-bot.mjs
 * Needs: GEMINI_API_KEY (vision + summary). Notion assertions run only when
 * NOTION_TOKEN + NOTION_DATABASE_ID are configured.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.JARVIS_BASE || "http://localhost:3000";
const CAPTURE_DIR = path.resolve("public", "meeting-captures");

let passes = 0;
let fails = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    passes++;
    console.log(`  PASS ${name}`);
  } else {
    fails++;
    console.error(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`);
  }
};
const note = (msg) => console.log(`  …  ${msg}`);

const api = async (route, body) => {
  const res = await fetch(`${BASE}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, error: text.slice(0, 200) };
  }
};

async function waitFor(label, fn, timeoutMs, intervalMs = 4000) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) {
      lastError = e?.message || String(e);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  note(`${label} timed out after ${Math.round(timeoutMs / 1000)}s${lastError ? ` (${lastError})` : ""}`);
  return null;
}

const envKeys = (() => {
  try {
    const text = fs.readFileSync(path.resolve(".env.local"), "utf8");
    return new Set(
      [...text.matchAll(/^([A-Z0-9_]+)\s*=/gm)].map((m) => m[1])
    );
  } catch {
    return new Set();
  }
})();

/* ------------------------------- mock lecture ------------------------------ */

const LECTURE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Signals &amp; Systems — E2E Lecture</title>
<style>
  body { margin:0; background:#0b1020; color:#e5e7eb; font-family:system-ui,sans-serif; }
  #stage { display:block; margin:16px; border-radius:10px; background:#fff; }
  #cap { position:fixed; left:24px; right:24px; bottom:84px; background:rgba(0,0,0,.78);
         padding:12px 16px; border-radius:10px; font-size:20px; }
  .zs7s8d { color:#93c5fd; font-weight:700; margin-right:10px; }
  .VbkSUe { color:#f9fafb; }
  #foot { position:fixed; left:0; right:0; bottom:0; height:64px; background:#111827;
          display:flex; align-items:center; gap:12px; padding:0 16px; }
  #foot button { background:#1f2937; color:#e5e7eb; border:1px solid #374151;
                 border-radius:8px; padding:8px 14px; font-size:14px; }
</style></head>
<body>
  <div data-meeting-title="Signals &amp; Systems — E2E Lecture"></div>
  <canvas id="stage" width="960" height="540"></canvas>
  <div id="cap" jsname="tgaKEf">
    <span class="zs7s8d">Prof. Rao</span><span class="VbkSUe">welcome to the e2e lecture</span>
  </div>
  <div id="foot">
    <button jsname="Qx7uuf" aria-label="Join now">Join now</button>
    <button aria-label="Leave call">Leave call</button>
    <button aria-label="Mute microphone">Mute</button>
  </div>
  <script>
    var canvas = document.getElementById('stage');
    var ctx = canvas.getContext('2d');
    var t0 = Date.now();
    var slide = -1;

    function frame(title) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 960, 540);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 32px system-ui';
      ctx.fillText(title, 40, 64);
    }

    function circuit() {
      frame('Half-wave rectifier circuit');
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(120, 220); ctx.lineTo(300, 220);
      ctx.moveTo(392, 220); ctx.lineTo(470, 220);
      ctx.moveTo(470, 220); ctx.lineTo(470, 150);
      ctx.lineTo(700, 150); ctx.lineTo(700, 220); ctx.lineTo(820, 220);
      ctx.moveTo(120, 220); ctx.lineTo(120, 400); ctx.lineTo(820, 400); ctx.lineTo(820, 220);
      ctx.stroke();
      // Diode
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.moveTo(300, 190); ctx.lineTo(300, 250); ctx.lineTo(360, 220);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(360, 194, 8, 52);
      // Resistor (zig-zag)
      ctx.beginPath();
      for (var i = 0; i < 6; i++) {
        ctx.lineTo(500 + i * 32, i % 2 === 0 ? 122 : 178);
      }
      ctx.stroke();
      // AC source
      ctx.beginPath(); ctx.arc(470, 400, 38, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(452, 400);
      ctx.bezierCurveTo(460, 380, 480, 420, 488, 400); ctx.stroke();
      ctx.font = '22px system-ui';
      ctx.fillText('D1 (diode)', 290, 300);
      ctx.fillText('R = 1kΩ load', 520, 100);
      ctx.fillText('Vs = 12V AC, 50Hz', 110, 470);
      ctx.fillText('Vout = Vpeak / π ≈ 3.82V', 560, 470);
    }

    function quadratic() {
      frame('Worked problem — solve the quadratic');
      ctx.font = '28px system-ui';
      ctx.fillText('x² − 5x + 6 = 0', 80, 150);
      ctx.fillText('Factorise:  (x − 2)(x − 3) = 0', 80, 215);
      ctx.fillText('Roots:      x = 2  and  x = 3', 80, 280);
      ctx.fillText('Verify x = 2:  4 − 10 + 6 = 0  ✓', 80, 345);
      ctx.fillText('Verify x = 3:  9 − 15 + 6 = 0  ✓', 80, 410);
      ctx.fillText('Discriminant Δ = 25 − 24 = 1', 80, 475);
    }

    function chart() {
      frame('Marks distribution — unit test 2');
      var data = [['A', 8], ['B', 14], ['C', 11], ['D', 5], ['F', 2]];
      var base = 470;
      ctx.font = '20px system-ui';
      data.forEach(function (d, i) {
        var h = d[1] * 20;
        var x = 140 + i * 140;
        ctx.fillStyle = '#2563eb';
        ctx.fillRect(x, base - h, 80, h);
        ctx.fillStyle = '#0f172a';
        ctx.fillText(d[0], x + 32, base + 28);
        ctx.fillText(String(d[1]), x + 32, base - h - 12);
      });
      ctx.strokeStyle = '#0f172a';
      ctx.beginPath(); ctx.moveTo(110, base); ctx.lineTo(860, base); ctx.stroke();
      ctx.font = '20px system-ui';
      ctx.fillText('40 students · mean 62%', 140, 110);
    }

    var slides = [circuit, quadratic, chart];

    function render() {
      var t = (Date.now() - t0) / 1000;
      var index = t < 30 ? 0 : t < 60 ? 1 : 2;
      if (index !== slide) {
        slide = index;
        slides[index]();
      }
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);

    var lines = [
      'the diode only conducts during the positive half cycle',
      'so the output keeps the positive bumps and drops the negatives',
      'that gives us a peak voltage of twelve root two volts',
      'now solve x squared minus five x plus six equals zero',
      'factorise it as x minus two into x minus three',
      'so the two roots are two and three',
      'this chart shows how the marks were distributed'
    ];
    var lineIndex = 0;
    var caption = document.querySelector('.VbkSUe');
    setInterval(function () {
      lineIndex = (lineIndex + 1) % lines.length;
      caption.textContent = lines[lineIndex];
    }, 7000);
  </script>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(LECTURE_HTML);
});

let sessionActive = false;

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  // The path matters: MeetingBotService decides the platform from the URL, and
  // "meet.google.com/" in it makes the real Google Meet join flow run.
  const lectureUrl = `http://127.0.0.1:${port}/meet.google.com/e2e-lecture-abc`;
  console.log(`\nMeeting bot E2E — ${BASE}\nmock lecture: ${lectureUrl}\n`);

  /* ------------------------------- preflight ------------------------------- */

  const preflight = await api("/api/meeting");
  if (!preflight || preflight.error) {
    console.error(`FAIL cannot reach the JARVIS dev server at ${BASE}. Start it with \`npm run dev\`.`);
    process.exitCode = 1;
    throw new Error("dev server unreachable");
  }
  check("dev server reachable", preflight.success !== false);
  if (preflight.isActive) {
    console.error("\nA meeting session is already active — leave it in the panel before running this e2e.");
    process.exitCode = 1;
    throw new Error("meeting session already active");
  }
  if (!envKeys.has("GEMINI_API_KEY")) {
    console.error("\nGEMINI_API_KEY is required — the visual summary is produced by the vision model.");
    process.exitCode = 1;
    throw new Error("GEMINI_API_KEY missing");
  }

  /* ---------------------- 1. auto-attend from a calendar -------------------- */

  console.log("\n1. Auto-attend from a calendar event");

  await api("/api/meeting/autojoin", { action: "reset-history" });

  // Real calendar, real decisions, no join. Proves the calendar path works even
  // before the synthetic event below drives the scheduler.
  const preview = await api("/api/meeting/autojoin", { action: "preview" });
  check("calendar preview answered", preview.success === true && Array.isArray(preview.events));
  note(
    preview.calendarAuthenticated
      ? `real Google Calendar read: ${preview.events.length} upcoming event(s) with a verdict`
      : "Google Calendar is not connected — real-calendar assertions limited to the demo feed"
  );
  check(
    "every event got a verdict",
    (preview.events || []).every((e) => typeof e.badge === "string" && e.badge.length > 0)
  );

  const saved = await api("/api/meeting/autojoin", {
    action: "settings",
    settings: {
      enabled: true,
      platforms: { googleMeet: true, zoom: true },
      joinLeadSeconds: 30,
      joinGraceSeconds: 900,
    },
  });
  check("auto-attend settings saved", saved.success === true && saved.settings?.enabled === true);

  const now = Date.now();
  const minutes = (n) => new Date(now + n * 60_000).toISOString();
  const syntheticEvents = [
    {
      id: "e2e-ready",
      summary: "E2E Lecture — auto-attend",
      status: "confirmed",
      start: { dateTime: minutes(-0.5) },
      end: { dateTime: minutes(25) },
      location: lectureUrl, // the link really is often in the location field
    },
    {
      id: "e2e-future",
      summary: "Later meeting",
      status: "confirmed",
      start: { dateTime: minutes(180) },
      end: { dateTime: minutes(210) },
      description: "https://meet.google.com/aaa-bbbb-ccc",
    },
    {
      id: "e2e-past",
      summary: "Yesterday's lecture",
      status: "confirmed",
      start: { dateTime: minutes(-180) },
      end: { dateTime: minutes(-120) },
      description: "https://meet.google.com/ddd-eeee-fff",
    },
    {
      id: "e2e-nolink",
      summary: "Room booking",
      status: "confirmed",
      start: { dateTime: minutes(60) },
      end: { dateTime: minutes(90) },
      location: "Block C, Room 204",
    },
    {
      id: "e2e-allday",
      summary: "Holiday",
      status: "confirmed",
      start: { date: "2026-10-27" },
      end: { date: "2026-10-28" },
    },
  ];

  const tick = await api("/api/meeting/autojoin", { action: "tick", events: syntheticEvents });
  check("the scheduler joined the due meeting by itself", tick.joined === true, JSON.stringify(tick).slice(0, 400));
  check("it joined the event that was in progress", tick.joinedEventId === "e2e-ready", String(tick.joinedEventId));
  check("the link was read out of the location field", tick.joinedUrl === lectureUrl, String(tick.joinedUrl));
  check("the join reported no error", !tick.error, tick.error);

  const verdicts = Object.fromEntries((tick.events || []).map((e) => [e.id, e.badge]));
  check("a meeting hours away is scheduled, not joined", verdicts["e2e-future"] === "Scheduled", verdicts["e2e-future"]);
  check("a finished meeting is skipped", verdicts["e2e-past"] === "Finished", verdicts["e2e-past"]);
  check("an event without a link is skipped", verdicts["e2e-nolink"] === "No link", verdicts["e2e-nolink"]);
  check("an all-day event is skipped", verdicts["e2e-allday"] === "All-day", verdicts["e2e-allday"]);

  const afterJoin = await waitFor(
    "bot session",
    async () => {
      const s = await api("/api/meeting");
      return s.isActive ? s : null;
    },
    60_000,
    2000
  );
  check("the bot is actually in the meeting", Boolean(afterJoin));
  sessionActive = Boolean(afterJoin);

  // The transcription engine arms a couple of seconds after the join flow
  // returns, so wait for it rather than sampling it the instant we're in.
  const recording = await waitFor(
    "transcription engine",
    async () => {
      const s = await api("/api/meeting");
      return s.isRecording ? s : null;
    },
    60_000,
    2000
  );
  check("it is transcribing", Boolean(recording));
  note(`status: ${recording?.statusMessage || afterJoin?.statusMessage || "unknown"}`);

  // A second tick must not stack a second browser on top of the live session.
  const secondTick = await api("/api/meeting/autojoin", { action: "tick", events: syntheticEvents });
  check(
    "a second tick refuses to open another browser",
    secondTick.skipped === "already-in-meeting" && secondTick.joined === false,
    JSON.stringify(secondTick).slice(0, 200)
  );

  /* ---------------------- 2. capture the presented screen ------------------ */

  console.log("\n2. Capture the diagrams / worked problem off the shared screen");

  const captured = await waitFor(
    "screen captures",
    async () => {
      const s = await api("/api/meeting");
      const attempts = Number(s.visualFramesAttempted) || 0;
      const kept = Number(s.visualsCaptured) || 0;
      note(`frames: ${attempts} looked at, ${kept} kept`);
      return kept >= 2 && attempts >= 3 ? s : null;
    },
    200_000,
    5000
  );
  check("screen frames were captured", Boolean(captured));
  check(
    "frames that did not change were not stored",
    Number(captured?.visualFramesAttempted) > Number(captured?.visualsCaptured),
    `${captured?.visualFramesAttempted} attempts / ${captured?.visualsCaptured} kept`
  );

  const liveFrame = captured?.visuals?.[0];
  if (liveFrame?.imageUrl) {
    const imageRes = await fetch(`${BASE}${liveFrame.imageUrl}`);
    const type = imageRes.headers.get("content-type") || "";
    check("a captured frame is served over HTTP", imageRes.ok && type.includes("image"), `${imageRes.status} ${type}`);
  } else {
    check("a captured frame is served over HTTP", false, "no live visual returned by status");
  }

  /* ------------------------- 3. summary with visuals ---------------------- */

  console.log("\n3. Leave, summarise, and attach the visuals");

  const leave = await api("/api/meeting", { action: "leave" });
  check("leave accepted", leave.success === true, JSON.stringify(leave).slice(0, 200));
  sessionActive = false;

  const result = await waitFor(
    "summary",
    async () => {
      const s = await api("/api/meeting");
      return s.lastResult?.summary ? s.lastResult : null;
    },
    300_000,
    4000
  );
  check("a summary was produced", Boolean(result?.summary?.summary), JSON.stringify(result || {}).slice(0, 200));
  check("the transcript was captured", Number(result?.captionCount) >= 3, `captionCount=${result?.captionCount}`);

  // The notes are the deliverable: a five-line recap is a failure even when
  // every other assertion passes, so the depth of the write-up is graded here.
  const notes = result?.summary || {};
  const sections = Array.isArray(notes.sections) ? notes.sections : [];
  const noteWords = [
    notes.summary || "",
    notes.nextSteps || "",
    ...sections.map((s) => `${s.heading}\n${s.body}\n${(s.bullets || []).join("\n")}`),
  ]
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  const overviewWords = String(notes.summary || "").split(/\s+/).filter(Boolean).length;
  check("the notes are detailed, not a five-line recap", noteWords >= 250, `${noteWords} words`);
  check("the overview is a real overview", overviewWords >= 80, `${overviewWords} words`);
  check("the notes are broken into chronological sections", sections.length >= 3, `${sections.length} sections`);
  check(
    "every section carries prose, not a stub",
    sections.every((s) => String(s.body || "").split(/\s+/).filter(Boolean).length >= 15),
    JSON.stringify(sections.map((s) => [s.heading, String(s.body || "").split(/\s+/).length])).slice(0, 300)
  );
  // A lecture has nothing to decide, so "decisions" may legitimately be empty;
  // what must never be empty is the topic map plus the quote/question/key-concept
  // layer that makes the notes navigable.
  const detailLayers = [notes.decisions, notes.highlights, notes.openQuestions, notes.concepts].filter(
    (layer) => Array.isArray(layer) && layer.length > 0
  ).length;
  check(
    "topics and detail layers are populated",
    (notes.keyTopics || []).length >= 4 && detailLayers >= 2,
    `topics=${(notes.keyTopics || []).length} detailLayers=${detailLayers}`
  );
  check(
    "the note is titled after the calendar event",
    String(result?.title || "").includes("E2E Lecture") && String(result?.title || "").includes("Google Meet"),
    String(result?.title)
  );
  note(
    `notes: ${noteWords} words · ${sections.length} sections · ${
      (notes.highlights || []).length
    } quote(s) · ${(notes.concepts || []).length} concept(s)`
  );
  if (result?.summary?.summary) note(`summary: ${result.summary.summary.slice(0, 220)}`);
  if (sections.length) note(`sections: ${sections.map((s) => s.heading).join(" | ")}`);

  const visuals = result?.summary?.visuals || [];
  check("the summary carries the captured visuals", visuals.length >= 2, `${visuals.length} visual(s)`);
  check(
    "every visual points at a real image file",
    visuals.every((v) => typeof v.imageUrl === "string" && v.imageUrl.startsWith("/meeting-captures/")),
    JSON.stringify(visuals.map((v) => v.imageUrl)).slice(0, 300)
  );
  check(
    "every visual has a title and a timestamp",
    visuals.every((v) => Boolean(v.title) && /^\d{2}:\d{2}:\d{2}$/.test(String(v.clock || ""))),
    JSON.stringify(visuals.map((v) => [v.title, v.clock])).slice(0, 300)
  );

  const labelled = visuals.filter(
    (v) =>
      ["diagram", "equation", "chart", "table", "slide", "code", "text"].includes(v.type) &&
      typeof v.description === "string" &&
      v.description.length > 20
  );
  if (result?.visualsLabelled === false) {
    // The frames were kept, but every vision model refused (rate limit /
    // overload). Report the outage instead of pretending the frames were junk.
    note("vision provider unavailable this run — frames attached without descriptions");
  } else {
    check(
      "the vision model labelled and described them",
      labelled.length >= 2,
      JSON.stringify(visuals.map((v) => [v.type, (v.description || "").slice(0, 40)])).slice(0, 400)
    );
  }
  note(`visuals: ${visuals.map((v) => `${v.type} "${v.title}"`).join(" · ")}`);

  for (const visual of visuals.slice(0, 4)) {
    const res = await fetch(`${BASE}${visual.imageUrl}`);
    check(
      `image reachable ${visual.imageUrl.split("/").pop()}`,
      res.ok && (res.headers.get("content-type") || "").includes("image"),
      String(res.status)
    );
  }

  /* ---------------------- 4. ask the transcript --------------------------- */

  console.log("\n4. Chat with the meeting (answers with timestamp citations)");

  const status = await api("/api/meeting");
  check("the panel is told the transcript is queryable", status.qa?.available === true, JSON.stringify(status.qa));
  check("the queryable transcript has lines", Number(status.qa?.turns) >= 3, `${status.qa?.turns} turns`);

  const question = "What formula was used for the rectifier output voltage on screen?";
  const askStarted = Date.now();
  const asked = await api("/api/meeting", { action: "ask", question });
  const askMs = Date.now() - askStarted;
  check("the question was answered", asked.success === true && asked.answer?.length > 20, JSON.stringify(asked).slice(0, 300));
  check("the answer is not a refusal", !/no transcript|could not/i.test(asked.answer || ""), String(asked.answer).slice(0, 120));
  // Speed is part of the feature, but it is measured on the fast path: when
  // Gemini itself is rate-limited the LLM chain answers instead and takes as
  // long as it takes. The panel surfaces which path was used.
  if (asked.provider === "gemini") {
    check("it replied fast enough to feel like chat", askMs < 15000, `${askMs}ms`);
  } else {
    note(`answered via fallback (${askMs}ms) — Gemini was unavailable`);
  }
  note(`answered in ${askMs}ms · ${(asked.citations || []).length} citation(s)`);

  const citations = asked.citations || [];
  check("the answer carries timestamp citations", citations.length >= 1, JSON.stringify(citations).slice(0, 300));
  check(
    // Transcript citations carry an offset clock and a real line; a screen-only
    // citation has line 0 and must carry the visual it came from.
    "every citation points at a real moment in the meeting",
    citations.every(
      (c) =>
        /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(c.clock || "")) &&
        (Number(c.line) >= 1 || (Number(c.line) === 0 && Number(c.visual) >= 1))
    ),
    JSON.stringify(citations.map((c) => [c.line, c.visual, c.clock]))
  );
  check(
    "citations quote the transcript, not the model",
    citations.every((c) => typeof c.quote === "string" && c.quote.length > 0 && typeof c.speaker === "string"),
    JSON.stringify(citations.slice(0, 2))
  );
  note(`cites: ${citations.map((c) => `${c.clock} ${c.speaker}`).join(" · ")}`);
  check("follow-up questions were suggested", (asked.followUps || []).length >= 1, JSON.stringify(asked.followUps));

  const repeatStarted = Date.now();
  const repeat = await api("/api/meeting", { action: "ask", question });
  const repeatMs = Date.now() - repeatStarted;
  check("a repeated question is served from cache", repeat.cached === true, JSON.stringify(repeat).slice(0, 200));
  check("the cached answer is instant", repeatMs < 1500, `${repeatMs}ms`);

  const emptyAsk = await api("/api/meeting", { action: "ask", question: "   " });
  check("an empty question is rejected", emptyAsk.success === false, JSON.stringify(emptyAsk).slice(0, 160));

  /* ------------------------- 5. revision kit ------------------------------ */

  console.log("\n5. Revision kit (flashcards + formula sheet)");

  const kit = await api("/api/meeting/study", { action: "generate" });
  check("a revision kit was generated", kit.success === true, JSON.stringify(kit).slice(0, 300));
  check("the kit has flashcards", Number(kit.flashcards) >= 5, `${kit.flashcards} cards`);
  check("the kit has the formula that was on screen", Number(kit.formulas) >= 1, `${kit.formulas} formulas`);
  note(`kit: ${kit.flashcards} cards · ${kit.formulas} formulas`);

  const kitJson = await (await fetch(`${BASE}/api/meeting/study?format=json`)).json();
  const cards = kitJson?.kit?.flashcards || [];
  const formulas = kitJson?.kit?.formulas || [];
  check(
    "every card has a question and an answer",
    // A numeric answer like "12 V." is correct and short, so only emptiness is
    // a failure; the prompt already forbids one-word non-answers.
    cards.length >= 5 && cards.every((c) => String(c.front || "").length > 5 && String(c.back || "").trim().length > 1),
    JSON.stringify(cards.filter((c) => String(c.back || "").trim().length <= 1)).slice(0, 300)
  );
  check(
    "the formula sheet carries a real expression",
    formulas.length >= 1 && formulas.every((f) => String(f.expression || "").length > 2),
    JSON.stringify(formulas.slice(0, 2)).slice(0, 300)
  );
  note(`formulas: ${formulas.map((f) => f.expression).join(" | ")}`);

  const csvRes = await fetch(`${BASE}/api/meeting/study?format=csv`);
  const csv = await csvRes.text();
  check("the CSV downloads", csvRes.ok && /text\/csv/.test(csvRes.headers.get("content-type") || ""), String(csvRes.status));
  // Count records the way a spreadsheet would: newlines outside quoted fields.
  let records = 0;
  let inQuotes = false;
  for (const char of csv) {
    if (char === '"') inQuotes = !inQuotes;
    else if (char === "\n" && !inQuotes) records++;
  }
  check("the CSV has one row per flashcard", records === Number(kit.flashcards), `${records} rows vs ${kit.flashcards} cards`);
  check("every CSV row has three quoted fields", csv.split("\n").filter(Boolean).every((row) => (row.match(/(^|,)"/g) || []).length === 3));

  const mdRes = await fetch(`${BASE}/api/meeting/study?format=md`);
  const md = await mdRes.text();
  check("the formula sheet downloads", mdRes.ok && /markdown/.test(mdRes.headers.get("content-type") || ""), String(mdRes.status));
  check("the sheet has a formula section", md.includes("## Formula sheet"), md.slice(0, 120));
  check("the sheet lists the flashcards", md.includes("## Flashcards") && md.includes("1. **"), md.slice(0, 120));
  check("the sheet names the meeting", md.includes("E2E Lecture"), md.split("\n")[0]);

  const kitAgain = await api("/api/meeting/study", { action: "generate" });
  check("a second kit request is cached", kitAgain.success === true && kitAgain.cached === true, JSON.stringify(kitAgain).slice(0, 200));

  if (envKeys.has("NOTION_TOKEN") && envKeys.has("NOTION_DATABASE_ID")) {
    check("the note synced to Notion", Boolean(result?.notionUrl), String(result?.notionUrl));
    check(
      "the captured screenshots were embedded in the note",
      Number(result?.notionVisualImages) > 0,
      `embedded=${result?.notionVisualImages}`
    );
    if (result?.notionUrl) note(`notion: ${result.notionUrl}`);
  } else {
    note("skipped Notion assertions — NOTION_TOKEN / NOTION_DATABASE_ID not configured");
  }
} catch (e) {
  if (e?.message !== "dev server unreachable" && e?.message !== "meeting session already active" && e?.message !== "GEMINI_API_KEY missing") {
    console.error("\nE2E aborted:", e);
  }
  if (fails === 0) fails++;
} finally {
  // Always leave: a bot stuck in a browser window after a failed assertion is
  // worse than the failure itself.
  if (sessionActive) {
    await api("/api/meeting", { action: "leave" }).catch(() => {});
  }
  // Auto-attend is opt-in — never leave it switched on just because a test ran.
  await api("/api/meeting/autojoin", { action: "settings", settings: { enabled: false } }).catch(() => {});
  await api("/api/meeting/autojoin", { action: "reset-history" }).catch(() => {});
  server.close();
  console.log(
    `\n${passes} passed, ${fails} failed` +
      (fs.existsSync(CAPTURE_DIR) ? `\ncaptures kept in ${CAPTURE_DIR} (gitignored, 5 sessions retained)` : "")
  );
  process.exitCode = fails > 0 ? 1 : 0;
}
