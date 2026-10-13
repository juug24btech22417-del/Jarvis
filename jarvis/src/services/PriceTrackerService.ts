// Price tracker — server-owned, panel-independent.
//
// WHAT WAS WRONG
// The old implementation kept `trackedProducts` in a module-level array inside
// the route handler and only refreshed when the panel POSTed `action:"update"`.
// Consequences the user hit directly:
//   • Closing the panel stopped all price checks (the browser tab *was* the
//     scheduler).
//   • Any dev-server restart wiped the list and it fell back to demo products,
//     which read as "it doesn't work properly".
//   • With no KEEPA_API_KEY it invented demo products instead of saying so.
//
// WHAT THIS DOES INSTEAD
//   • Products and samples live in Prisma (PriceProduct / PriceSample), so they
//     survive restarts.
//   • A tick loop samples due products on its own timer. No UI required.
//   • Prices come from Keepa when a key is configured, otherwise from a real
//     scrape of the product page via the existing browser engine. If neither
//     can produce a number, the row records `lastError` — it never fabricates
//     a price.
//   • Hitting a target price raises a Telegram alert (same channel the browser
//     watchers already use), so a drop is noticed with the app closed.
//
// Pinned to globalThis so dev hot reloads don't stack up duplicate timers.

import { prisma } from "@/lib/db/queries";
import { runActions, parsePrice, type BrowserAction } from "@/lib/browser/engine";

// Every knob here is environment-overridable — nothing is baked in, so the
// tracker can be tuned (or pointed at another Amazon storefront) without a
// code change.
const DEFAULT_INTERVAL_MIN = Math.max(5, Number(process.env.PRICE_TICK_MINUTES || 30));
const MAX_TICK_BATCH = Math.max(1, Number(process.env.PRICE_TICK_BATCH || 5)); // per tick, so one tick can't run for minutes
const ALERT_COOLDOWN_MS = Math.max(60_000, Number(process.env.PRICE_ALERT_COOLDOWN_MINUTES || 720)) * 60_000;
const MAX_PRODUCTS = Math.max(1, Number(process.env.PRICE_MAX_PRODUCTS || 50));
const AMAZON_DOMAIN = process.env.AMAZON_DOMAIN || "www.amazon.com";
const SCRAPE_TIMEOUT_MS = Math.max(15_000, Number(process.env.PRICE_SCRAPE_TIMEOUT_MS || 75_000));
const KEEPA_DOMAIN = Number(process.env.KEEPA_DOMAIN || 1); // Keepa marketplace id (1 = US)

// Same internal-API convention as instrumentation.ts: never assume port 3000.
const INTERNAL_BASE =
  process.env.INTERNAL_API_URL || `http://localhost:${process.env.PORT || 3000}`;

export type PriceSource = "keepa" | "scrape";

type Runtime = {
  timer: NodeJS.Timeout | null;
  running: boolean;
  lastTickAt: number | null;
  lastTickDurationMs: number | null;
  lastError: string | null;
  tickCount: number;
  inFlight: boolean;
};

const g = globalThis as unknown as { __jarvisPriceTracker?: Runtime };
if (!g.__jarvisPriceTracker) {
  g.__jarvisPriceTracker = {
    timer: null,
    running: false,
    lastTickAt: null,
    lastTickDurationMs: null,
    lastError: null,
    tickCount: 0,
    inFlight: false,
  };
}
const rt = g.__jarvisPriceTracker;

function amazonUrl(asin: string): string {
  return `https://${AMAZON_DOMAIN}/dp/${asin}`;
}

export function normalizeAsin(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  // Accept a bare ASIN or any Amazon product URL (/dp/XXXX, /gp/product/XXXX).
  const fromUrl = raw.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
  if (fromUrl) return fromUrl[1].toUpperCase();
  if (/^[A-Z0-9]{10}$/i.test(raw)) return raw.toUpperCase();
  return null;
}

// ── Fetching ─────────────────────────────────────────────────────────

type FetchedProduct = {
  title: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  source: PriceSource;
  error?: string;
};

/** Keepa is authoritative when a key exists — it has real price history. */
async function fetchFromKeepa(asin: string): Promise<FetchedProduct | null> {
  const key = process.env.KEEPA_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.keepa.com/product?key=${key}&domain=${KEEPA_DOMAIN}&asin=${asin}&stats=1&rating=1`,
      { signal: AbortSignal.timeout(Number(process.env.KEEPA_TIMEOUT_MS || 20_000)) }
    );
    if (!res.ok) {
      return { title: "", price: null, currency: "USD", imageUrl: null, source: "keepa", error: `Keepa HTTP ${res.status}` };
    }
    const data = await res.json();
    const p = data?.products?.[0];
    if (!p) {
      return { title: "", price: null, currency: "USD", imageUrl: null, source: "keepa", error: "Keepa returned no product for that ASIN" };
    }
    const currentCents = p.stats?.current?.[1];
    return {
      title: p.title || asin,
      price: typeof currentCents === "number" && currentCents > 0 ? currentCents / 100 : null,
      currency: p.currency || "USD",
      imageUrl: p.images?.[0] ? `https://m.media-amazon.com/images/I/${p.images[0]}` : null,
      source: "keepa",
      error: currentCents ? undefined : "Keepa has no current price for this ASIN",
    };
  } catch (err) {
    return { title: "", price: null, currency: "USD", imageUrl: null, source: "keepa", error: (err as Error).message };
  }
}

// Amazon renders several price blocks depending on layout/coupons; try the
// specific core block first, then the generic "off-screen" price spans.
const PRICE_SELECTORS = [
  "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
  "#corePrice_feature_div .a-offscreen",
  "#priceblock_ourprice",
  "#priceblock_dealprice",
  ".a-price .a-offscreen",
];

/** Real scrape of the product page using the app's existing browser engine. */
async function fetchFromScrape(asin: string): Promise<FetchedProduct> {
  const url = amazonUrl(asin);
  const actions: BrowserAction[] = [
    { type: "navigate", url },
    { type: "waitForSelector", selector: "#productTitle, .a-price", timeout: 20_000, optional: true },
    { type: "getText", selector: "#productTitle", optional: true },
    ...PRICE_SELECTORS.map((sel) => ({ type: "getText" as const, selector: sel, optional: true })),
    { type: "getAttribute", selector: "#landingImage", value: "src", optional: true },
    { type: "getText", selector: "#productSubtitle", optional: true },
  ];

  const run = await runActions(actions, { globalTimeoutMs: SCRAPE_TIMEOUT_MS });

  const title = run.results.find((r) => r.selector === "#productTitle")?.text ?? null;
  const priceTexts = run.results.filter((r) => r.action === "getText" && r.selector && PRICE_SELECTORS.includes(r.selector!));
  const priceText = priceTexts.map((r) => r.text).find((t) => !!t && parsePrice(t) !== null) ?? null;
  const image = run.results.find((r) => r.action === "getAttribute")?.value ?? null;

  if (run.captcha) {
    return { title: title || asin, price: null, currency: "USD", imageUrl: image, source: "scrape", error: "Amazon served a bot wall / captcha — try again later or configure KEEPA_API_KEY." };
  }
  if (!title && !priceText) {
    return { title: asin, price: null, currency: "USD", imageUrl: null, source: "scrape", error: "Could not read the product page (layout changed, region mismatch, or the request was blocked)." };
  }

  const price = priceText ? parsePrice(priceText) : null;
  // Amazon's off-screen price is a currency-formatted string; keep the symbol.
  // This matters because Amazon localises by IP: the .com storefront happily
  // returns "INR1,141.44" from an Indian connection, so the domain alone does
  // not tell you the currency.
  const currency = priceText?.includes("₹") || /INR/i.test(priceText ?? "") ? "INR"
    : priceText?.includes("€") ? "EUR"
    : priceText?.includes("£") ? "GBP"
    : "USD";

  return {
    // textContent carries the surrounding whitespace of the DOM node; without
    // trimming, listings render as "    USB C to USB C Cable 3FT   ".
    title: (title || asin).replace(/\s+/g, " ").trim(),
    price,
    currency,
    imageUrl: image,
    source: "scrape",
    error: price === null ? "Page loaded but no price element matched (often a coupon-only or out-of-stock listing)." : undefined,
  };
}

async function fetchProduct(asin: string): Promise<FetchedProduct> {
  const keepa = await fetchFromKeepa(asin);
  if (keepa && keepa.price !== null) return keepa;
  const scraped = await fetchFromScrape(asin);
  // Keepa may know the title even when it has no price.
  if (keepa?.title && !scraped.title) return { ...scraped, title: keepa.title };
  return scraped;
}

// ── Sampling ─────────────────────────────────────────────────────────

async function sampleProduct(product: {
  id: string;
  asin: string;
  title: string;
  targetPrice: number | null;
  lastAlertAt: Date | null;
  lowestPrice: number | null;
  highestPrice: number | null;
}): Promise<{ price: number | null; alerted: boolean; error: string | null }> {
  const fetched = await fetchProduct(product.asin);
  const now = new Date();

  if (fetched.price === null) {
    await prisma.priceProduct.update({
      where: { id: product.id },
      data: {
        lastCheckedAt: now,
        checkCount: { increment: 1 },
        lastError: fetched.error ?? "No price found",
        ...(fetched.title && fetched.title !== product.asin ? { title: fetched.title } : {}),
        ...(fetched.imageUrl ? { imageUrl: fetched.imageUrl } : {}),
      },
    });
    return { price: null, alerted: false, error: fetched.error ?? "No price found" };
  }

  await prisma.priceSample.create({ data: { productId: product.id, price: fetched.price } });

  const lowest = product.lowestPrice === null ? fetched.price : Math.min(product.lowestPrice, fetched.price);
  const highest = product.highestPrice === null ? fetched.price : Math.max(product.highestPrice, fetched.price);

  const hitTarget = product.targetPrice !== null && fetched.price <= product.targetPrice;
  const canAlert = !product.lastAlertAt || now.getTime() - product.lastAlertAt.getTime() > ALERT_COOLDOWN_MS;

  await prisma.priceProduct.update({
    where: { id: product.id },
    data: {
      title: fetched.title || product.title,
      currentPrice: fetched.price,
      lowestPrice: lowest,
      highestPrice: highest,
      currency: fetched.currency,
      imageUrl: fetched.imageUrl ?? undefined,
      source: fetched.source,
      lastCheckedAt: now,
      checkCount: { increment: 1 },
      lastError: fetched.error ?? null,
      ...(hitTarget && canAlert ? { lastAlertAt: now } : {}),
    },
  });

  let alerted = false;
  if (hitTarget && canAlert) {
    await fetch(`${INTERNAL_BASE}/api/telegram/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `💸 Price drop: "${fetched.title || product.title}" is ${fetched.currency} ${fetched.price} (target ${product.targetPrice}) — ${amazonUrl(product.asin)}`,
        fromSource: "price-tracker",
      }),
    }).catch(() => {});
    alerted = true;
  }

  return { price: fetched.price, alerted, error: fetched.error ?? null };
}

/**
 * One tick: sample products that are due. Guarded so overlapping ticks (a
 * manual refresh plus the timer) can't double-sample and double-alert.
 */
export async function tick(force = false): Promise<{
  checked: number;
  alerted: number;
  errors: { asin: string; error: string | null }[];
  skipped: string | null;
}> {
  if (rt.inFlight) return { checked: 0, alerted: 0, errors: [], skipped: "a tick is already running" };
  rt.inFlight = true;
  const started = Date.now();
  try {
    const now = new Date();
    const candidates = await prisma.priceProduct.findMany({
      where: { active: true },
      orderBy: { lastCheckedAt: "asc" },
      take: MAX_TICK_BATCH * 2,
    });

    const due = candidates
      .filter((p) => {
        if (force) return true;
        if (!p.lastCheckedAt) return true;
        return now.getTime() - p.lastCheckedAt.getTime() >= p.intervalMin * 60_000;
      })
      .slice(0, MAX_TICK_BATCH);

    let alerted = 0;
    const errors: { asin: string; error: string | null }[] = [];

    for (const p of due) {
      try {
        const res = await sampleProduct(p);
        if (res.alerted) alerted++;
        if (res.error) errors.push({ asin: p.asin, error: res.error });
      } catch (err) {
        const message = (err as Error).message;
        errors.push({ asin: p.asin, error: message });
        await prisma.priceProduct
          .update({ where: { id: p.id }, data: { lastCheckedAt: new Date(), lastError: message } })
          .catch(() => {});
      }
    }

    rt.lastTickAt = Date.now();
    rt.lastTickDurationMs = Date.now() - started;
    rt.tickCount++;
    rt.lastError = errors[0]?.error ?? null;
    return { checked: due.length, alerted, errors, skipped: null };
  } catch (err) {
    rt.lastError = (err as Error).message;
    return { checked: 0, alerted: 0, errors: [], skipped: rt.lastError };
  } finally {
    rt.inFlight = false;
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────

export function start(intervalMin = DEFAULT_INTERVAL_MIN): { started: boolean; intervalMin: number } {
  // Already armed — hot reload must not stack timers.
  if (rt.running && rt.timer) return { started: false, intervalMin };
  rt.running = true;
  rt.timer = setInterval(() => {
    void tick().catch(() => {});
  }, Math.max(1, intervalMin) * 60_000);
  // Don't hold the process open on shutdown.
  rt.timer.unref?.();
  console.log(`[PriceTracker] background loop armed — every ${intervalMin} min, no panel needed`);
  return { started: true, intervalMin };
}

export function stop(): boolean {
  if (!rt.timer) {
    rt.running = false;
    return false;
  }
  clearInterval(rt.timer);
  rt.timer = null;
  rt.running = false;
  return true;
}

export function status() {
  const keepa = !!process.env.KEEPA_API_KEY;
  return {
    running: rt.running && !!rt.timer,
    intervalMin: DEFAULT_INTERVAL_MIN,
    lastTickAt: rt.lastTickAt ? new Date(rt.lastTickAt).toISOString() : null,
    nextTickAt: rt.lastTickAt ? new Date(rt.lastTickAt + DEFAULT_INTERVAL_MIN * 60_000).toISOString() : null,
    lastTickDurationMs: rt.lastTickDurationMs,
    tickCount: rt.tickCount,
    inFlight: rt.inFlight,
    lastError: rt.lastError,
    engine: keepa ? "keepa" : "scrape",
    keepaConfigured: keepa,
    amazonDomain: AMAZON_DOMAIN,
    maxProducts: MAX_PRODUCTS,
    tickBatch: MAX_TICK_BATCH,
    alertCooldownMinutes: ALERT_COOLDOWN_MS / 60_000,
    note: keepa
      ? "Prices come from Keepa (authoritative history)."
      : "No KEEPA_API_KEY — prices are read from the live product page and may be blocked by Amazon. Errors are recorded per product rather than faked.",
  };
}

// ── Product CRUD ─────────────────────────────────────────────────────

export async function addProduct(rawAsin: string, targetPrice?: number, intervalMin?: number) {
  const asin = normalizeAsin(rawAsin);
  if (!asin) throw new Error("That doesn't look like an Amazon ASIN or product URL (expected 10 characters, e.g. B08N5WRWNW).");

  const existing = await prisma.priceProduct.findUnique({ where: { asin } });
  if (existing) throw new Error(`Already tracking ${asin} (${existing.title}).`);

  // Cap is enforced here rather than in the UI so every caller (API, chat,
  // another route) hits the same limit.
  const tracked = await prisma.priceProduct.count();
  if (tracked >= MAX_PRODUCTS) {
    throw new Error(`Tracking limit reached (${MAX_PRODUCTS} products). Remove one, or raise PRICE_MAX_PRODUCTS.`);
  }

  const fetched = await fetchProduct(asin);
  if (fetched.price === null && fetched.title === asin) {
    // Nothing at all came back — creating a row would just show a blank
    // listing forever, so fail with the real reason instead.
    throw new Error(fetched.error || "Could not read that product page.");
  }

  const product = await prisma.priceProduct.create({
    data: {
      asin,
      title: fetched.title || asin,
      imageUrl: fetched.imageUrl,
      currency: fetched.currency,
      url: amazonUrl(asin),
      targetPrice: targetPrice ?? (fetched.price !== null ? Number((fetched.price * 0.9).toFixed(2)) : null),
      currentPrice: fetched.price,
      lowestPrice: fetched.price,
      highestPrice: fetched.price,
      source: fetched.source,
      intervalMin: Math.max(5, intervalMin ?? DEFAULT_INTERVAL_MIN),
      lastCheckedAt: new Date(),
      checkCount: 1,
      lastError: fetched.error ?? null,
    },
  });

  if (fetched.price !== null) {
    await prisma.priceSample.create({ data: { productId: product.id, price: fetched.price } });
  }

  return { product, warning: fetched.error ?? null };
}

/**
 * Find products by name instead of making the user hunt for an ASIN.
 *
 * This exists because "add by ASIN" is the main reason the old tracker felt
 * broken: an ASIN copied from a wishlist is frequently dead or region-specific,
 * and the page then returns "Page Not Found" with no price at all. Searching
 * returns ASINs that are live right now, on the configured storefront.
 */
async function searchOnAmazon(query: string): Promise<
  { asin: string; title: string; price: number | null; priceText: string | null; currency: string; imageUrl: string | null; url: string }[]
> {
  const searchUrl = `https://${AMAZON_DOMAIN}/s?k=${encodeURIComponent(query)}`;

  // One evaluate expression pulls the whole result card set. e.s-image is the
  // search-results thumbnail; .a-price .a-offscreen holds the formatted price.
  // Amazon serves different search-result layouts depending on the client: in
  // one variant the h2 holds only the brand ("Anker") with the real title in a
  // sibling span, and prices live in either `.a-offscreen` or the
  // `.a-price-whole`/`.a-price-fraction` pair. Taking the *longest* h2 span and
  // trying every price form survives both variants instead of silently
  // returning brand-only titles and no prices.
  const extractor = `(() => {
    const out = [];
    const cards = document.querySelectorAll('[data-asin]');
    for (const e of cards) {
      const asin = e.getAttribute('data-asin');
      if (!asin || asin.length !== 10) continue;

      let title = '';
      for (const c of e.querySelectorAll('h2 span, h2 a span, h2')) {
        const t = (c.textContent || '').replace(/\s+/g, ' ').trim();
        if (t.length > title.length) title = t;
      }

      let priceText = '';
      const off = e.querySelector('.a-offscreen');
      if (off) priceText = (off.textContent || '').trim();
      if (!priceText) {
        const whole = e.querySelector('.a-price-whole');
        const frac = e.querySelector('.a-price-fraction');
        if (whole) priceText = ((whole.textContent || '').trim() || '') + (frac && frac.textContent ? '.' + frac.textContent.trim() : '');
      }
      if (!priceText) {
        const sym = e.querySelector('.a-price-symbol');
        const whole2 = e.querySelector('.a-price-whole');
        if (sym && whole2) priceText = (sym.textContent || '').trim() + (whole2.textContent || '').trim();
      }

      const img = e.querySelector('img.s-image');
      if (!title && !priceText) continue;
      out.push({
        asin,
        title,
        priceText,
        image: img ? img.getAttribute('src') : '',
        url: 'https://${AMAZON_DOMAIN}/dp/' + asin,
      });
      if (out.length >= 12) break;
    }
    return out;
  })()`;

  // Search-result prices are rendered asynchronously and are NOT reliable:
  // matched runs have shown 28 price nodes and other runs none at all, on the
  // same query. So: wait briefly for them, extract them when they are there,
  // and treat an absent price as normal rather than as an error. The
  // authoritative price is read from the product page when the user adds it.
  const run = await runActions(
    [
      { type: "navigate", url: searchUrl },
      { type: "waitForSelector", selector: "[data-asin] h2", timeout: 25_000, optional: true },
      { type: "waitForSelector", selector: "[data-asin] .a-price .a-offscreen", timeout: 6_000, optional: true },
      { type: "wait", timeout: 1_500 },
      { type: "evaluate", script: extractor },
      { type: "evaluate", script: "document.querySelectorAll('[data-asin]').length" },
    ],
    { globalTimeoutMs: SCRAPE_TIMEOUT_MS }
  );

  if (run.captcha) throw new Error("Amazon served a bot wall for that search. Try again shortly, or configure KEEPA_API_KEY.");

  const raw = run.results.find((r) => r.action === "evaluate" && Array.isArray(r.result))?.result as
    | { asin: string; title: string; priceText: string; image: string; url: string }[]
    | undefined;

  const cardCount = run.results.find((r) => r.action === "evaluate" && typeof r.result === "number")?.result;
  if (!raw || raw.length === 0) {
    throw new Error(
      `No products found for "${query}" on ${AMAZON_DOMAIN}` +
        (cardCount === 0 ? " — the results page rendered no product cards (blocked or an unexpected layout)." : ".")
    );
  }

  return raw.map((r) => ({
    asin: r.asin,
    title: r.title || r.asin,
    price: r.priceText ? parsePrice(r.priceText) : null,
    priceText: r.priceText || null,
    currency: /INR|₹/.test(r.priceText) ? "INR" : /€/.test(r.priceText) ? "EUR" : /£/.test(r.priceText) ? "GBP" : "USD",
    imageUrl: r.image || null,
    url: r.url,
  }));
}

export async function searchProducts(query: string) {
  const q = query.trim();
  if (!q) throw new Error("query is required — pass a product name, e.g. \"usb c cable\".");
  // A pasted ASIN or product URL short-circuits the search entirely.
  const asin = normalizeAsin(q);
  if (asin) {
    const fetched = await fetchProduct(asin);
    return {
      query: q,
      source: "direct" as const,
      products: [
        {
          asin,
          title: fetched.title,
          price: fetched.price,
          priceText: fetched.price === null ? null : String(fetched.price),
          currency: fetched.currency,
          imageUrl: fetched.imageUrl,
          url: amazonUrl(asin),
          error: fetched.error ?? null,
        },
      ],
    };
  }
  return { query: q, source: "search" as const, products: await searchOnAmazon(q) };
}

export async function listProducts() {
  const products = await prisma.priceProduct.findMany({ orderBy: { createdAt: "desc" } });
  return Promise.all(
    products.map(async (p) => {
      const samples = await prisma.priceSample.findMany({
        where: { productId: p.id },
        orderBy: { takenAt: "desc" },
        take: 30,
      });
      return {
        ...p,
        priceHistory: samples
          .map((s) => ({ date: s.takenAt.toISOString(), price: s.price }))
          .reverse(),
        hitTarget: p.targetPrice !== null && p.currentPrice !== null && p.currentPrice <= p.targetPrice,
      };
    })
  );
}

export async function removeProduct(idOrAsin: string) {
  const product = await prisma.priceProduct.findFirst({
    where: { OR: [{ id: idOrAsin }, { asin: idOrAsin.toUpperCase() }] },
  });
  if (!product) throw new Error("No tracked product matches that id or ASIN.");
  await prisma.priceSample.deleteMany({ where: { productId: product.id } });
  await prisma.priceProduct.delete({ where: { id: product.id } });
  return { removed: product.asin, title: product.title };
}

export async function updateTarget(idOrAsin: string, targetPrice: number | null) {
  const product = await prisma.priceProduct.findFirst({
    where: { OR: [{ id: idOrAsin }, { asin: idOrAsin.toUpperCase() }] },
  });
  if (!product) throw new Error("No tracked product matches that id or ASIN.");
  return prisma.priceProduct.update({ where: { id: product.id }, data: { targetPrice } });
}

export async function refreshProduct(idOrAsin: string) {
  const product = await prisma.priceProduct.findFirst({
    where: { OR: [{ id: idOrAsin }, { asin: idOrAsin.toUpperCase() }] },
  });
  if (!product) throw new Error("No tracked product matches that id or ASIN.");
  const res = await sampleProduct(product);
  return { asin: product.asin, price: res.price, alerted: res.alerted, error: res.error };
}

export async function alerts() {
  const products = await prisma.priceProduct.findMany({ where: { active: true } });
  return products
    .filter((p) => p.targetPrice !== null && p.currentPrice !== null && p.currentPrice <= p.targetPrice)
    .map((p) => ({
      itemId: p.id,
      asin: p.asin,
      product: p.title,
      currentPrice: p.currentPrice,
      targetPrice: p.targetPrice,
      currency: p.currency,
      url: p.url,
    }));
}
