// Meeting summary contract: the prompt that asks for detailed notes, and the
// normaliser that keeps a sloppy model response from breaking the panel/Notion.
//
// WHY THIS EXISTS
// The old prompt asked for "2-3 sentences" and got exactly that: five-line
// recaps that told you a meeting had happened without telling you what was
// said. Notes are only worth keeping if someone who missed the call can skip
// the recording, so the prompt now demands a fixed, dense structure (overview,
// chronological sections, decisions with reasons, quotes, open questions,
// concepts) and the normaliser enforces it whatever the model returns.
//
// Pure module: no network, no process.env, no Notion — unit-testable.

export interface MeetingSection {
  /** What this stretch of the meeting was about, e.g. "Bridge rectifier maths". */
  heading: string;
  /** The substance: 90-200 words of prose. */
  body: string;
  /** Optional short list that belongs under the heading. */
  bullets?: string[];
}

export interface SummaryConcept {
  term: string;
  explanation: string;
}

export interface SummaryCore {
  /** Executive overview — several paragraphs, not a one-liner. */
  summary: string;
  keyTopics: string[];
  decisions: string[];
  actionItems: Array<{ task: string; assignee?: string; due?: string; priority?: number }>;
  nextSteps?: string;
  /** Detailed, chronological notes — the part that makes the summary long. */
  sections?: MeetingSection[];
  /** Verbatim-ish quotes worth remembering, formatted "Speaker: quote". */
  highlights?: string[];
  openQuestions?: string[];
  /** Terms, formulas or jargon explained for later revision. */
  concepts?: SummaryConcept[];
}

export interface SummaryPromptInput {
  transcript: string;
  platform: string;
  /** Title from the calendar event (or a generic session label). */
  title?: string;
  /** Human-readable start time, for the model's context. */
  startedAt?: string;
  durationMinutes?: number;
  /** Visual index built by buildVisualPromptIndex(); empty when nothing was captured. */
  visualIndex?: string;
}

/** Trim a string, collapse runs of blank lines, and clamp its length. */
function cleanText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;
}

/** Pull a field that models sometimes emit under snake_case or a synonym. */
function pick(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') return raw[key];
  }
  return undefined;
}

/** Coerce string | string[] | {text} into a clean string list. */
function toStringList(value: unknown, maxItems: number, maxChars = 400): string[] {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const out: string[] = [];
  for (const item of items) {
    const text =
      typeof item === 'string'
        ? cleanText(item, maxChars)
        : item && typeof item === 'object'
          ? cleanText(
              ((item as Record<string, unknown>).text as string) ??
                ((item as Record<string, unknown>).content as string) ??
                ((item as Record<string, unknown>).value as string) ??
                '',
              maxChars
            )
          : '';
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Split a prose blob into at most `maxItems` bullet-worthy lines. */
function toBullets(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const lines = value
      .split(/\n|(?:^|\s)[-•*]\s/)
      .map((line) => cleanText(line, 400))
      .filter(Boolean);
    return lines.length ? lines.slice(0, 12) : undefined;
  }
  const list = toStringList(value, 12);
  return list.length ? list : undefined;
}

/**
 * Turn whatever the model returned into a shape the UI and Notion writer can
 * trust. Returns null only when there is no usable overview at all.
 */
export function normalizeMeetingSummary(raw: unknown): SummaryCore | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // Some models answer with an array of paragraphs; join them.
  const overviewRaw = pick(obj, 'summary', 'overview', 'executiveSummary', 'executive_summary');
  let summary: string;
  if (Array.isArray(overviewRaw)) {
    summary = overviewRaw
      .map((part) => cleanText(part, 2000))
      .filter(Boolean)
      .join('\n\n');
  } else {
    summary = cleanText(overviewRaw, 6000);
  }
  if (!summary) return null;

  const sectionsRaw = pick(obj, 'sections', 'detailedNotes', 'detailed_notes', 'notes');
  const sections: MeetingSection[] = [];
  if (Array.isArray(sectionsRaw)) {
    for (const entry of sectionsRaw) {
      if (!entry || typeof entry !== 'object') continue;
      const sectionEntry = entry as Record<string, unknown>;
      const heading = cleanText(
        sectionEntry.heading ?? sectionEntry.title ?? sectionEntry.topic ?? '',
        160
      );
      const bodyRaw = sectionEntry.body ?? sectionEntry.content ?? sectionEntry.summary ?? '';
      const body = Array.isArray(bodyRaw)
        ? bodyRaw
            .map((part) => cleanText(part, 2000))
            .filter(Boolean)
            .join('\n\n')
        : cleanText(bodyRaw, 4000);
      const bullets = toBullets(sectionEntry.bullets);
      if (!heading && !body && !bullets) continue;
      sections.push({
        heading: heading || `Part ${sections.length + 1}`,
        body: body || (bullets || []).join(' '),
        ...(bullets ? { bullets } : {}),
      });
      if (sections.length >= 20) break;
    }
  }

  const conceptsRaw = pick(obj, 'concepts', 'glossary', 'terms');
  const concepts: SummaryConcept[] = [];
  if (Array.isArray(conceptsRaw)) {
    for (const entry of conceptsRaw) {
      if (!entry || typeof entry !== 'object') continue;
      const concept = entry as Record<string, unknown>;
      const term = cleanText(concept.term ?? concept.name ?? '', 120);
      const explanation = cleanText(
        concept.explanation ?? concept.definition ?? concept.meaning ?? '',
        600
      );
      if (!term || !explanation) continue;
      concepts.push({ term, explanation });
      if (concepts.length >= 16) break;
    }
  }

  const actionRaw = pick(obj, 'actionItems', 'action_items', 'tasks', 'todos');
  const actionItems: SummaryCore['actionItems'] = [];
  if (Array.isArray(actionRaw)) {
    for (const entry of actionRaw) {
      if (!entry) continue;
      if (typeof entry === 'string') {
        const task = cleanText(entry, 400);
        if (task) actionItems.push({ task });
      } else if (typeof entry === 'object') {
        const item = entry as Record<string, unknown>;
        const task = cleanText(item.task ?? item.title ?? item.action ?? '', 400);
        if (!task) continue;
        const assignee = cleanText(item.assignee ?? item.owner ?? '', 80);
        const due = cleanText(item.due ?? item.dueDate ?? '', 80);
        const priorityNum = Number(item.priority);
        actionItems.push({
          task,
          ...(assignee ? { assignee } : {}),
          ...(due ? { due } : {}),
          ...(Number.isFinite(priorityNum) && priorityNum > 0
            ? { priority: Math.min(4, Math.round(priorityNum)) }
            : {}),
        });
      }
      if (actionItems.length >= 30) break;
    }
  }

  const nextSteps = cleanText(pick(obj, 'nextSteps', 'next_steps', 'followUp'), 2000);

  return {
    summary,
    keyTopics: toStringList(pick(obj, 'keyTopics', 'key_topics', 'topics'), 16, 160),
    decisions: toStringList(pick(obj, 'decisions'), 20, 500),
    actionItems,
    ...(nextSteps ? { nextSteps } : {}),
    sections,
    highlights: toStringList(pick(obj, 'highlights', 'quotes', 'notableQuotes'), 12, 500),
    openQuestions: toStringList(pick(obj, 'openQuestions', 'open_questions', 'questions'), 12, 500),
    concepts,
  };
}

/** Rough word count used by the UI and by tests to catch a thin summary. */
export function summaryWordCount(summary: SummaryCore | null | undefined): number {
  if (!summary) return 0;
  const parts = [
    summary.summary,
    summary.nextSteps || '',
    ...(summary.sections || []).map((s) => `${s.heading}\n${s.body}\n${(s.bullets || []).join('\n')}`),
  ];
  return parts
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

/** A title that tells you what the notes are about without opening the page. */
export function meetingNoteTitle(params: {
  title?: string;
  platform: string;
  date?: Date;
}): string {
  const when = (params.date || new Date()).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const platform =
    params.platform === 'zoom'
      ? 'Zoom'
      : params.platform === 'google-meet'
        ? 'Google Meet'
        : params.platform === 'teams'
          ? 'Teams'
          : 'Meeting';
  const topic = (params.title || '').trim();
  return topic
    ? `${topic} — ${when} (${platform})`
    : `Meeting Notes — ${when} (${platform})`;
}

/**
 * The summarisation prompt.
 *
 * The explicit length floors are deliberate: an unconstrained "be thorough"
 * still yields three bullets, because the model optimises for brevity unless a
 * number is on the table. Word targets are ranges, not minimums to pad to, and
 * the prompt forbids inventing detail the transcript does not support.
 */
export function buildSummaryPrompt(input: SummaryPromptInput): string {
  const { transcript, platform, title, startedAt, durationMinutes, visualIndex } = input;
  const contextLines = [
    `Platform: ${platform}`,
    title ? `Meeting title: ${title}` : '',
    startedAt ? `Started: ${startedAt}` : '',
    durationMinutes ? `Approximate duration: ${Math.round(durationMinutes)} minutes` : '',
    `Transcript entries: ${transcript.split('\n').length}`,
  ].filter(Boolean);

  const visualRules = visualIndex
    ? `${visualIndex}

WHEN VISUALS WERE SHOWN
The numbered visuals above are screenshots of the presented screen, analysed by
vision. Cite them inline as (see Visual #N) at the exact point in the notes where
they belong, and describe what is on them (labels, axes, equations, values) so the
notes still make sense to someone who never opens the image. Never cite a visual
that is not in that list.
`
    : '';

  return `You are JARVIS, an elite executive and academic note-taker. You are writing the permanent record of a meeting from its live transcript. Someone who missed the entire call will read ONLY your output, so it must stand alone.

${contextLines.join('\n')}

NON-NEGOTIABLE RULES
1. COVER THE WHOLE MEETING. Walk the transcript from the first entry to the last. Do not summarise only the ending, and do not skip the opening minutes.
2. BE SPECIFIC. Keep names, numbers, dates, formulas, error messages, tool and file names, and the reasons behind decisions. "We discussed the rectifier" is worthless; "Prof. Rao derived Vdc = 2Vm/π for a full-wave bridge with a 470µF smoothing capacitor" is the note.
3. NEVER INVENT. If the transcript is unclear or inaudible, say what is uncertain instead of filling the gap.
4. WRITE PROSE, NOT STUB LISTS. Sections carry real sentences. Bullets are for genuinely enumerable things only.
5. NO META COMMENTARY. Never write "the meeting covered several topics"; write the topics.
6. Match the register of the call: lecture notes for a lecture, decision log for a standup or client call.

LENGTH FLOORS (a thin answer is a failed answer)
- "summary": 180-320 words, 2-4 paragraphs separated by \\n\\n.
- "sections": 5-12 entries, chronological, 90-200 words of body each. A 30-minute meeting needs at least 6 sections.
- "keyTopics": 6-12 short noun phrases.
- "highlights": 5-10 entries formatted "Speaker: quote or near-quote".
- "concepts": 4-10 entries whenever anything technical, numeric or jargon-heavy came up (formulas, acronyms, APIs, domain terms).
- "openQuestions": every unresolved question actually asked and left hanging (0 is allowed only if none were).
- Short meeting? Draw more detail out of what was said — do not pad, and do not drop below 4 sections.
- Aim for 900+ words of total output for a session longer than 20 minutes.

${visualRules}Return ONLY raw JSON, no markdown fences and no commentary, in exactly this shape:
{
  "summary": "string — multi-paragraph executive overview",
  "keyTopics": ["string"],
  "sections": [
    { "heading": "string", "body": "string", "bullets": ["string"] }
  ],
  "decisions": ["string — the decision, then ' — because …' the reason"],
  "actionItems": [
    { "task": "string", "assignee": "person or Unassigned", "due": "date or TBD", "priority": 1 }
  ],
  "openQuestions": ["string"],
  "highlights": ["Speaker: string"],
  "concepts": [{ "term": "string", "explanation": "string" }],
  "nextSteps": "string — 2-4 sentences on what happens next"
}

TRANSCRIPT
${transcript}`;
}
