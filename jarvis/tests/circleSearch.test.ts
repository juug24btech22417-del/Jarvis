// Circle to Search — the router behind "draw around anything".
//
// These tests pin the two decisions that decide whether the feature feels
// smart or broken:
//   1. Which Google surface a circled thing is sent to (a circled shoe must go
//      to Shopping, a circled face to Images — not to plain web search).
//   2. How a Serper response of any shape becomes the rows the card renders,
//      including the empty/odd responses the API really returns.
//
// The vision and search calls themselves need the network, so they are covered
// by the live route check (scripts/e2e-circle-search.mjs), not here.
//
// Run with:  npx tsx tests/circleSearch.test.ts

import {
  buildSearchUrl,
  coerceKind,
  host,
  isAnswerFirst,
  KIND_LABEL,
  normalizeSerper,
  planFromVision,
  selectSurface,
  type CircleKind,
  type CircleSurface,
} from "../src/lib/agent/circleSearch";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.error(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─────────────────────────────────────────────────────────────────────────
section("Kind vocabulary");

const KINDS: CircleKind[] = [
  "product",
  "place",
  "person",
  "text",
  "question",
  "code",
  "chart",
  "image",
  "other",
];

check(
  "every kind has a card badge",
  KINDS.every((k) => typeof KIND_LABEL[k] === "string" && KIND_LABEL[k].length > 0)
);
check("no emoji in any badge", !KINDS.some((k) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(KIND_LABEL[k])));

// ─────────────────────────────────────────────────────────────────────────
section("coerceKind folds model drift onto our kinds");

check("exact kind passes through", coerceKind("product") === "product");
check("uppercase is normalised", coerceKind("PRODUCT") === "product");
check("whitespace is trimmed", coerceKind("  place  ") === "place");
check("'goods' reads as a product", coerceKind("goods") === "product");
check("'object on a shelf' reads as a product", coerceKind("object on a shelf") === "product");
check("'sneaker' reads as a product", coerceKind("sneaker") === "product");
check("'landmark' reads as a place", coerceKind("landmark") === "place");
check("'restaurant storefront' reads as a place", coerceKind("restaurant storefront") === "place");
check("'celebrity' reads as a person", coerceKind("celebrity") === "person");
check("'portrait' reads as a person", coerceKind("portrait") === "person");
check("'stack trace' reads as code", coerceKind("stack trace") === "code");
check("'dashboard' reads as a chart", coerceKind("dashboard") === "chart");
check("'logo' reads as an image", coerceKind("logo") === "image");
check("'paragraph' reads as text", coerceKind("paragraph") === "text");
check("junk falls back to other", coerceKind("qwertyuiop") === "other");
check("empty falls back to other", coerceKind("") === "other");
check("undefined falls back to other", coerceKind(undefined) === "other");

// ─────────────────────────────────────────────────────────────────────────
section("Surface routing (which Google the circle goes to)");

const EXPECTED_SURFACE: Record<CircleKind, CircleSurface> = {
  product: "shopping",
  place: "places",
  person: "images",
  image: "images",
  chart: "images",
  text: "search",
  question: "search",
  code: "search",
  other: "search",
};

for (const kind of KINDS) {
  check(`${kind} -> /${EXPECTED_SURFACE[kind]}`, selectSurface(kind) === EXPECTED_SURFACE[kind]);
}

// ─────────────────────────────────────────────────────────────────────────
section("Search URLs land on the right Google tab");

check(
  "product opens Shopping",
  buildSearchUrl("sony wh-1000xm5", "product") ===
    "https://www.google.com/search?tbm=shop&q=sony%20wh-1000xm5"
);
check(
  "person opens Images",
  buildSearchUrl("shah rukh khan", "person") ===
    "https://www.google.com/search?tbm=isch&q=shah%20rukh%20khan"
);
check(
  "image opens Images",
  buildSearchUrl("eiffel tower", "image") === "https://www.google.com/search?tbm=isch&q=eiffel%20tower"
);
check(
  "place opens Maps",
  buildSearchUrl("tokyo tower", "place") === "https://www.google.com/maps/search/?api=1&query=tokyo%20tower"
);
check(
  "code opens plain search",
  buildSearchUrl("python indexerror list index out of range", "code") ===
    "https://www.google.com/search?q=python%20indexerror%20list%20index%20out%20of%20range"
);
check("empty query still yields a google url", buildSearchUrl("", "product") === "https://www.google.com/search");
check("quotes and spaces are encoded", buildSearchUrl('a "b" & c', "other") === "https://www.google.com/search?q=a%20%22b%22%20%26%20c");

// ─────────────────────────────────────────────────────────────────────────
section("planFromVision turns model JSON into a plan");

const product = planFromVision({
  kind: "goods",
  title: "Sony WH-1000XM5 Headphones",
  summary: "A pair of over-ear wireless headphones by Sony.",
  query: "Sony WH-1000XM5 headphones price",
  confidence: 0.92,
});
check("aliased kind is coerced", product.kind === "product");
check("title passes through", product.title === "Sony WH-1000XM5 Headphones");
check("query passes through", product.query === "Sony WH-1000XM5 headphones price");
check("confidence passes through", product.confidence === 0.92);

const noQuery = planFromVision({ kind: "product", title: "Nike Air Max 90" });
check("missing query falls back to the title", noQuery.query === "Nike Air Max 90");

const percent = planFromVision({ kind: "image", confidence: 87 });
check("a 0-100 confidence is normalised to 0-1", percent.confidence === 0.87);

const noRaw = planFromVision(null);
check("no vision result is still a usable plan", noRaw.kind === "other" && noRaw.query === "");
check("no vision result keeps the badge meaningful", KIND_LABEL[noRaw.kind] === "Found it");

const hinted = planFromVision(null, "red running shoes");
check("typed question becomes the fallback query", hinted.query === "red running shoes");
check("typed question becomes the fallback title", hinted.title === "red running shoes");

const answerKind = planFromVision({
  kind: "question",
  title: "Physics question",
  answer: "The acceleration is 9.8 m/s squared.",
  query: "acceleration due to gravity",
});
check("question answer is carried", answerKind.answer.startsWith("The acceleration"));
check("question is answer-first", isAnswerFirst(answerKind.kind, answerKind.answer) === true);
check("product is not answer-first", isAnswerFirst("product", "some text") === false);
check("a question with no answer is searched", isAnswerFirst("question", "   ") === false);

const noisy = planFromVision({
  kind: "product",
  title: "x".repeat(400),
  summary: "y".repeat(900),
  query: "z".repeat(400),
});
check("title is bounded", noisy.title.length <= 90, `${noisy.title.length}`);
check("summary is bounded", noisy.summary.length <= 300, `${noisy.summary.length}`);
check("query is bounded", noisy.query.length <= 160, `${noisy.query.length}`);

// ─────────────────────────────────────────────────────────────────────────
section("Serper mapping — Shopping");

const shopping = normalizeSerper("shopping", {
  shopping: [
    { title: "Sony WH-1000XM5", link: "https://amzn.to/x", source: "Amazon", price: "$348.00", imageUrl: "https://img/1.png" },
    { title: "Sony WH-1000XM5 (Renewed)", link: "https://ebay.to/y", source: "eBay", price: "$199.00" },
  ],
  organic: [{ title: "Sony WH-1000XM5 review", link: "https://www.theverge.com/review", snippet: "The best noise cancelling." }],
});
check("shopping rows come first", shopping[0].title === "Sony WH-1000XM5");
check("shopping price is kept", shopping[0].price === "$348.00");
check("shopping source is kept", shopping[0].source === "Amazon");
check("shopping snippet joins source and price", shopping[0].snippet === "Amazon · $348.00");
check("thumbnail is kept", shopping[0].thumbnail === "https://img/1.png");
check("web results back a shopping query", shopping.some((i) => i.source === "theverge.com"));
const manyRows = normalizeSerper("shopping", {
  shopping: Array.from({ length: 30 }, (_, i) => ({ title: `p${i}`, link: `https://a.to/${i}` })),
});
check("serper rows are capped", manyRows.length <= 6, `${manyRows.length}`);

section("Serper mapping — Places / Images / web");

const places = normalizeSerper("places", {
  places: [{ title: "Tokyo Tower", address: "4 Chome-2-8 Shibakoen, Minato City", rating: 4.6 }],
});
check("place keeps its name", places[0].title === "Tokyo Tower");
check("place links to Maps", places[0].url.startsWith("https://www.google.com/maps/search/?api=1&query="));
check("place link carries the address", decodeURIComponent(places[0].url).includes("Tokyo Tower 4 Chome-2-8"));
check("place snippet has the address", places[0].snippet.includes("Minato City"));
check("place rating is shown", places[0].snippet.includes("4.6"));
check("place source says Maps", places[0].source === "Google Maps");

const images = normalizeSerper("images", {
  images: [{ title: "SRK portrait", link: "https://www.bollywoodhungama.com/pic", imageUrl: "https://img/srk.jpg", source: "Bollywood Hungama" }],
});
check("image title is kept", images[0].title === "SRK portrait");
check("image keeps its link", images[0].url === "https://www.bollywoodhungama.com/pic");
check("image keeps its thumbnail", images[0].thumbnail === "https://img/srk.jpg");

const web = normalizeSerper("search", {
  organic: [
    { title: "Python index errors", link: "https://realpython.com/index", snippet: "How to fix IndexError." },
    { title: "Duplicate", link: "https://realpython.com/index", snippet: "dup" },
  ],
});
check("web rows map title/link/snippet", web[0].title === "Python index errors" && web[0].snippet === "How to fix IndexError.");
check("web source is the host without www", web[0].source === "realpython.com");
check("duplicate urls collapse", web.length === 1);

const empty = normalizeSerper("search", {});
check("empty serper body yields no rows", empty.length === 0);
check("null-ish serper body yields no rows", normalizeSerper("search", null).length === 0);
check("rows without a title or url are dropped", normalizeSerper("search", {
  organic: [{ title: "", link: "" }, { title: "ok", link: "https://a.to" }],
}).length === 1);

section("Knowledge panel + host()");

const kg = normalizeSerper("search", {
  knowledgeGraph: { title: "Neural network", description: "Computing systems inspired by biological brains.", website: "https://en.wikipedia.org/wiki/Neural_network", type: "Field of study" },
});
check("knowledge panel becomes a row", kg[0].title === "Neural network");
check("knowledge panel keeps its website", kg[0].url === "https://en.wikipedia.org/wiki/Neural_network");
check("knowledge panel shows its type", kg[0].source === "Field of study");

check("host strips www", host("https://www.amazon.com/dp/x") === "amazon.com");
check("host survives a bare path", host("/local/file") === "");
check("host survives empty input", host("") === "");

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
