// Proactive detection — decide when the overlay should offer help on its own.
//
// WHY A DETECTOR INSTEAD OF "ANSWER EVERYTHING"
// ---------------------------------------------
// The old overlay auto-answered any line that started with a question word.
// In a real call that fires on rhetorical questions, on the other person
// talking to a third party, and on half-sentences — and every false positive
// costs a model call AND steals the reading position from the answer the user
// actually needs.
//
// So a line is classified into what it is asking FOR, scored, and then the
// user's per-trigger setting decides what happens:
//
//     off  — ignore this kind entirely
//     prep — prepare the answer in the background, show a chip, answer only
//            when clicked (fast when it is clicked, silent when it is not)
//     auto — answer it immediately (the default for a direct question)
//
// Pure functions, no DOM, so the behaviour is unit-testable.

export type TriggerKind = "question" | "term" | "decision" | "claim" | "followup";

export type TriggerAction = "off" | "prep" | "auto";

export type TriggerSettings = Record<TriggerKind, TriggerAction>;

export const DEFAULT_TRIGGERS: TriggerSettings = {
  // A question aimed at the user is the one case that is worth interrupting for.
  question: "auto",
  term: "prep",
  decision: "prep",
  claim: "prep",
  followup: "auto",
};

export const TRIGGER_META: Record<TriggerKind, { label: string; blurb: string }> = {
  question: { label: "QUESTION TO YOU", blurb: "A direct question someone is waiting on an answer to" },
  term: { label: "TERM", blurb: "A technical term or acronym worth having explained" },
  decision: { label: "DECISION", blurb: "A choice being made — offer the call and the reasoning" },
  claim: { label: "CLAIM", blurb: "A factual claim or number worth checking before agreeing" },
  followup: { label: "FOLLOW-UP", blurb: "A question that depends on what was said earlier" },
};

const TRIGGER_PRIORITY: Record<TriggerKind, number> = {
  question: 5,
  followup: 4,
  decision: 3,
  claim: 2,
  term: 1,
};

export interface Detection {
  kind: TriggerKind;
  /** 0..1 — how strongly this reads as that kind of request. */
  score: number;
  text: string;
  /** Four words of why, shown in the chip tooltip. */
  reason: string;
}

export interface DetectContext {
  /** Topic the conversation is currently on. */
  topic?: string;
  /** Lines already answered, so nothing is answered twice. */
  asked?: string[];
  /** Set while the user is muted or the overlay is paused. */
  listening?: boolean;
}

// ── Patterns ───────────────────────────────────────────────────────────────
// Second person is the strongest signal that a question is aimed AT the user
// ("what do you think?", "how would you handle it?") as opposed to at someone
// else in the room.
const DIRECT_PERSON = /\b(you|your|yourself|you're|yours)\b/i;
const ASK_PHRASES =
  /\b(can you|could you|would you|do you|did you|have you|are you|will you|tell me|tell us|walk me|walk us|show me|what do you|how do you|how would you|what's your|what is your|thoughts on|your take|what about your)\b/i;
const ASK_VERBS =
  /^(what|why|how|when|where|who|which|whose|can|could|would|should|do|does|did|is|are|was|were|will|explain|describe|define|compare|walk|tell|give|write|make|create|build|fix|debug|refactor|implement|code|show|list|name|summari[sz]e|translate|convert|calculate|solve|draft|rewrite|review|design|plan|help)\b/i;

const DECISION_PHRASES =
  /\b(should we|should i|which (one|option|approach|vendor|tool)|we need to (decide|choose|pick)|i need to (decide|choose|pick)|pros and cons|trade-?offs?|go with|decide between|worth (it|doing)|better to|instead of|or should)\b/i;
const CLAIM_PHRASES =
  /\b(studies show|research shows|everyone knows|it's (a )?fact|always|never|guaranteed|100%|the best|the only|proven to|statistically)\b/i;
const FOLLOWUP_PHRASES =
  /^(and|also|so|then|but|what about|how about|what if|why not|and the|and what|and how|ok(ay)? so|right so)\b/i;

// Domain vocabulary the overlay can explain without being asked. Kept to words
// that actually show up in calls and that a generalist would want glossed.
const TECH_TERMS = [
  "api", "sdk", "rest", "graphql", "grpc", "websocket", "webhook", "oauth", "oidc", "jwt", "saml", "sso",
  "sql", "nosql", "postgres", "postgresql", "mysql", "mongodb", "redis", "elasticsearch", "kafka",
  "rabbitmq", "docker", "kubernetes", "k8s", "terraform", "ansible", "helm", "cicd", "ci/cd", "jenkins",
  "github actions", "lambda", "serverless", "ec2", "s3", "cloudfront", "vpc", "iam", "cdn", "dns", "tls",
  "mtls", "vpn", "load balancer", "reverse proxy", "sharding", "replication", "partition", "index",
  "migration", "schema", "orm", "cache", "cache invalidation", "ttl", "rate limit", "throttling",
  "backpressure", "idempotent", "race condition", "deadlock", "mutex", "semaphore", "eventual consistency",
  "cap theorem", "microservice", "monolith", "message queue", "pub/sub", "etl", "data warehouse", "lakehouse",
  "llm", "rag", "embedding", "vector database", "transformer", "fine tune", "prompt injection",
  "observability", "tracing", "slo", "sla", "sli", "error budget", "blue green", "canary", "feature flag",
  "tdd", "unit test", "integration test", "e2e", "regression", "code review", "tech debt", "monorepo",
  "repository", "pull request", "trunk based", "scrum", "kanban", "sprint", "epic",
  "arr", "mrr", "cac", "ltv", "churn", "burn rate", "runway", "gross margin", "cogs", "ebitda", "nps",
  "dau", "mau", "conversion rate", "attribution", "retention", "cohort", "okr", "kpi", "roi", "roas",
  "p&l", "cap table", "dilution", "vesting", "safe", "term sheet", "dpa", "gdpr", "soc2", "hipaa", "iso27001",
];

const ACRONYM = /\b[A-Z][A-Z0-9]{1,5}\b/g;
const KNOWN_ACRONYMS = new Set(["API", "SDK", "SQL", "CPU", "GPU", "RAM", "URL", "URI", "HTTP", "HTTPS", "JSON", "XML", "HTML", "CSS", "UI", "UX", "AWS", "GCP", "SLA", "KPI", "OKR", "CEO", "CTO", "VP", "ROI", "MRR", "ARR", "CAC", "LTV", "NPS", "B2B", "B2C", "SaaS", "SAML", "SSO", "JWT", "TLS", "DNS", "CDN", "VPC", "IAM", "EC2", "S3", "CI", "CD", "ETL", "RAG", "LLM", "ML", "AI", "QA", "PM", "PO", "MVP", "POC", "NDA", "DPA", "GDPR", "SOC2", "HIPAA", "MVCC", "CRUD", "ORM", "TTL", "QPS", "RPS"]);

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Words already covered by the conversation, so the same term is not offered
 * twice. */
function alreadyCovered(text: string, asked: string[]): boolean {
  const norm = text.trim().toLowerCase().replace(/\s+/g, " ");
  return asked.some((a) => {
    const b = a.trim().toLowerCase().replace(/\s+/g, " ");
    return b === norm || (b.length > 12 && (b.includes(norm) || norm.includes(b)));
  });
}

export function detect(text: string, ctx: DetectContext = {}): Detection[] {
  const raw = (text || "").trim();
  const found: Detection[] = [];
  if (raw.length < 6) return found;
  // A line that is plainly incomplete ("I was going to say") is never a request.
  if (raw.split(/\s+/).length < 3 && !raw.endsWith("?")) return found;
  if (ctx.asked && alreadyCovered(raw, ctx.asked)) return found;

  const isQuestionMark = raw.includes("?");
  const direct = DIRECT_PERSON.test(raw) || ASK_PHRASES.test(raw);
  const asksVerb = ASK_VERBS.test(raw.replace(/^[-–•\s]+/, ""));

  // ── question ────────────────────────────────────────────────────────────
  if (isQuestionMark || asksVerb) {
    let score = 0.3;
    if (isQuestionMark) score += 0.2;
    if (asksVerb) score += 0.2;
    if (direct) score += 0.25;
    if (ctx.topic && !/\b(he|she|they)\b/i.test(raw)) score += 0.05;
    if (raw.length > 240) score -= 0.15; // a monologue, not a question
    found.push({
      kind: "question",
      score: clamp01(score),
      text: raw,
      reason: direct ? "aimed at you" : "asked as a question",
    });
  }

  // ── decision ────────────────────────────────────────────────────────────
  if (DECISION_PHRASES.test(raw)) {
    found.push({
      kind: "decision",
      score: clamp01(0.45 + (isQuestionMark ? 0.15 : 0) + (direct ? 0.15 : 0) + (ASK_VERBS.test(raw) ? 0.1 : 0)),
      text: raw,
      reason: "a choice is being made",
    });
  }

  // ── claim ───────────────────────────────────────────────────────────────
  const numeric = /\b\d+(\.\d+)?\s?(%|percent|x|ms|s\b|k\b|m\b|bn\b|billion|million|users|requests|qps|rps)/i.test(raw);
  if (CLAIM_PHRASES.test(raw) || numeric) {
    found.push({
      kind: "claim",
      score: clamp01(0.4 + (numeric ? 0.2 : 0) + (/\b(studies|research|report|data) (show|shows|says?s?)\b/i.test(raw) ? 0.2 : 0)),
      text: raw,
      reason: numeric ? "a number worth checking" : "a claim worth checking",
    });
  }

  // ── term ────────────────────────────────────────────────────────────────
  const lower = ` ${raw.toLowerCase()} `;
  const hitTerms = TECH_TERMS.filter((t) => lower.includes(` ${t} `) || lower.includes(` ${t},`) || lower.includes(` ${t}.`));
  const acronyms = (raw.match(ACRONYM) || []).filter((a) => KNOWN_ACRONYMS.has(a));
  const termHit = [...new Set([...hitTerms, ...acronyms.map((a) => a.toLowerCase())])];
  if (termHit.length) {
    found.push({
      kind: "term",
      score: clamp01(0.35 + Math.min(0.3, termHit.length * 0.15)),
      text: `Explain "${termHit[0]}" in this context`,
      reason: `heard “${termHit[0].toUpperCase()}”`,
    });
  }

  // ── follow-up ───────────────────────────────────────────────────────────
  const startsWithConnector = FOLLOWUP_PHRASES.test(raw.toLowerCase());
  if (startsWithConnector && ctx.topic) {
    found.push({
      kind: "followup",
      score: clamp01(0.4 + (isQuestionMark ? 0.2 : 0) + (raw.length < 120 ? 0.15 : 0)),
      text: raw,
      reason: "continues the current topic",
    });
  }

  return found.sort((a, b) => b.score - a.score);
}

/** The single detection worth acting on: highest score, ties broken by how much
 * a real person is waiting on it. */
export function pickPrimary(detections: Detection[]): Detection | null {
  if (!detections.length) return null;
  return [...detections].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return TRIGGER_PRIORITY[b.kind] - TRIGGER_PRIORITY[a.kind];
  })[0];
}

/** Every detection whose kind is set to `action`. */
export function forAction(detections: Detection[], settings: TriggerSettings, action: TriggerAction): Detection[] {
  return detections
    .filter((d) => settings[d.kind] === action)
    .sort((a, b) => TRIGGER_PRIORITY[b.kind] - TRIGGER_PRIORITY[a.kind] || b.score - a.score);
}

/** Is this line worth even asking the model about, given the settings? */
export function anyEnabled(detections: Detection[], settings: TriggerSettings): boolean {
  return detections.some((d) => settings[d.kind] !== "off");
}

export const TRIGGER_ORDER: TriggerKind[] = ["question", "followup", "decision", "claim", "term"];
