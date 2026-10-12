# Circle to Act — say what you want, over anything on screen

Circle to Search already answers "what is this?". Circle to Act answers
"do this with it". There is **no action menu and no intent list** anywhere in
the path: the crop is described by a vision model, your own words become the
goal, and the same ReAct agent that drives every other JARVIS task picks a real
tool and runs it. Add a tool to the agent later and it is available here for
free.

```
What it can reach (all real, all chosen by the agent)
  email.send         writes + sends a real email from your connected Gmail
  text.translate     translates the circled text, and can paint it in place
  memory.save        stores the fact in the long-term memory graph
  browser.act        drives a REAL visible browser (cart, forms, booking)
  maps.search        live place discovery
  maps.directions    real driving route + distance/time
  web.search         live web search
  github             live GitHub REST
  whatsapp.send      real WhatsApp send (needs the bridge connected)
  finish             end the run with an honest summary
```

## The gesture

1. Press **Ctrl+Alt+S** — the screen freezes and dims.
2. Draw a loop around anything. The search card appears.
3. Click **"Tell JARVIS what to do"**.
4. Type what you want and press **Enter**.

```
email this to rahul@example.com asking him to pay the invoice by the 30th
translate this into Hindi
remember that this is the laptop I want to buy
find the cheapest place to buy this near me
add this to my cart on amazon
```

Esc cancels the ask box. The result card shows the tool that actually ran and
its real output — never a claim it did not do.

### Translate in place

Ask for a translation and the translation is also painted **over the region you
circled**, so it sits where the original text was instead of in a card across
the screen. Click it to dismiss, or it lifts on its own after 12s. The card also
carries a **Show in place** button to bring it back.

## How to test it

Everything below assumes the dev server is up (`npm run dev`).

### Automated

```bash
npm run smoke:cards      # 67 checks — card UI, crop geometry, act/translate cards
npm run smoke:circle     # the real gesture: hotkey → draw → answer → Esc → re-dim
npm run e2e:circle       # live vision + Serper, 18 checks
npm run e2e:circle:act   # live agent + translate + a real email, 14 checks
npm test                 # all 21 unit suites
```

`npm run e2e:circle:act` sends a **real** email when given a recipient:

```bash
node scripts/e2e-circle-act.mjs --to you@example.com
```

> Only one process can own `ctrl+alt+s`. Close your running watcher before
> `npm run smoke:circle`, or it fails to register the hotkey.

### By hand

1. `npm run dev` — wait for "Ready".
2. `npm run clipboard` — wait for `Circle to search ready - press ctrl+alt+s`.
3. Open an invoice, a foreign-language page, or a product page.
4. Circle it, click **Tell JARVIS what to do**, type one of the examples above.

**Translate check:** circle a paragraph in French/Spanish and type
`translate this into English`. Expect the translation to appear in place over
the paragraph *and* on the card.

**Email check:** circle a receipt or an invoice and type
`email this to <your own address> asking for a summary`. Expect a card saying
which address it sent to, and the mail arriving within a few seconds.

## Email: what was broken, and what was fixed

Three separate faults, all fixed and verified:

1. **Nothing ever sent.** `startEmailDispatcher()` had **no caller anywhere** —
   the module existed, the composer worked, the 30s cancel window worked, but no
   ticker ever flushed a queued row, so every email sat at `status="pending"`
   past its `fireAt` forever. `src/instrumentation.ts` now drives
   `POST /api/composio/email/dispatch` every 5s (an HTTP self-call, the same
   pattern the watcher heartbeat uses — importing the dispatcher directly pulled
   Prisma into the edge build and 500'd every API route).

2. **Placeholder signatures were mailed out.** Free models, asked to "sign off
   appropriately", emit `Best regards,\n[Your title]\n[Company name]\n[Contact
   info]`, and the old code only *appended* the real signature when the name was
   missing — so literal brackets went out in real email. The body is now
   stripped of placeholder lines and of the model's own closing block, and
   exactly one canonical signature is added: real name + contact, never a job
   title or company.

3. **The body was the model's working, not an email.** One mail went out reading
   "No extra text. Let's craft… We must not include any placeholder… Now produce
   final answer." Composition is now JSON-first (`{"subject","body"}`) and a body
   that looks like reasoning is rejected, with a clean deterministic fallback.

Inspect the queue at any time:

```bash
curl http://localhost:3000/api/composio/email/dispatch     # queue + last results
curl -X POST http://localhost:3000/api/composio/email/dispatch   # force a tick now
```

`npm run test` includes `tests/emailIdentity.test.ts`, which pins the signature
rules (no placeholders, exactly one signature, no title/company, and an internal
"thanks for the update" must not truncate the mail).

## Voice

`POST /api/voice/listen` records the microphone **server-side** (Windows' own MCI
waveaudio device, transcribed by the Groq Whisper helper the Telegram voice notes
use) and returns the text. The recording is deliberately not done in the watcher:
"watch the clipboard + own global hotkeys + capture the screen + capture the mic"
in one file is the shape Windows Defender's AMSI scanner blocks outright, and it
has already blocked that file once.

It is not wired to a button, because **this laptop reports no recording device at
all** (`waveInGetNumDevs() == 0` — hardware, not software), so the card is
typed-first by design. On a machine with a working mic it returns
`{ ok: true, text }` and can be wired to a Speak button in one line.
