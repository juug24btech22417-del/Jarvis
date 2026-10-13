// Price tracker API — a thin HTTP shell over PriceTrackerService.
//
// The tracker used to live entirely in this file: an in-memory array plus a
// refresh that only ran when the panel asked for it. Closing the panel stopped
// tracking, and every dev-server restart wiped the list back to demo products.
// All real behaviour now lives in the service, which owns its own timer, so
// this route only reads/writes the durable state.
//
// GET  /api/price-tracker                 → tracked products + loop status
// GET  /api/price-tracker?action=alerts   → products at/below target
// GET  /api/price-tracker?action=status   → loop status only
// POST /api/price-tracker {action:"add"|"remove"|"refresh"|"target"|"update"|"tick"|"start"|"stop"}

import { NextRequest, NextResponse } from "next/server";
import {
  addProduct,
  alerts,
  listProducts,
  refreshProduct,
  removeProduct,
  searchProducts,
  start as startLoop,
  status as loopStatus,
  stop as stopLoop,
  tick,
  updateTarget,
} from "@/services/PriceTrackerService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Reading anything from this endpoint also arms the background loop. The
    // instrumentation heartbeat is the real guarantee that it runs with no
    // panel open; this just means opening the panel is enough on its own.
    startLoop();

    const action = new URL(req.url).searchParams.get("action");

    if (action === "status") {
      return NextResponse.json({ success: true, status: loopStatus() });
    }

    if (action === "alerts") {
      return NextResponse.json({ success: true, alerts: await alerts(), status: loopStatus() });
    }

    const status = loopStatus();
    const products = await listProducts();
    return NextResponse.json({
      success: true,
      products,
      count: products.length,
      // Comes from the service (env-configurable), not a literal here.
      maxProducts: status.maxProducts,
      status,
    });
  } catch (error) {
    console.error("[PriceTracker] GET failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load tracked products", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action ?? "");

    switch (action) {
      case "add": {
        const raw = String(body.asin ?? body.url ?? "").trim();
        if (!raw) {
          return NextResponse.json({ success: false, error: "Provide an ASIN or Amazon product URL" }, { status: 400 });
        }
        try {
          const { product, warning } = await addProduct(
            raw,
            body.targetPrice !== undefined && body.targetPrice !== "" ? Number(body.targetPrice) : undefined,
            body.intervalMin ? Number(body.intervalMin) : undefined
          );
          return NextResponse.json({ success: true, product, warning });
        } catch (err) {
          return NextResponse.json({ success: false, error: (err as Error).message }, { status: 400 });
        }
      }

      // Find products by name. Exists because "add by ASIN" is where the old
      // tracker failed: a copied ASIN is often dead or region-specific and the
      // page then yields "Page Not Found" with no price.
      case "search": {
        const query = String(body.query ?? "").trim();
        if (!query) return NextResponse.json({ success: false, error: "query is required" }, { status: 400 });
        try {
          return NextResponse.json({ success: true, ...(await searchProducts(query)) });
        } catch (err) {
          return NextResponse.json({ success: false, error: (err as Error).message }, { status: 502 });
        }
      }

      case "remove": {
        const target = String(body.id ?? body.asin ?? "").trim();
        if (!target) return NextResponse.json({ success: false, error: "id or asin is required" }, { status: 400 });
        try {
          return NextResponse.json({ success: true, ...(await removeProduct(target)) });
        } catch (err) {
          return NextResponse.json({ success: false, error: (err as Error).message }, { status: 404 });
        }
      }

      case "refresh": {
        const target = String(body.id ?? body.asin ?? "").trim();
        if (!target) return NextResponse.json({ success: false, error: "id or asin is required" }, { status: 400 });
        try {
          return NextResponse.json({ success: true, result: await refreshProduct(target) });
        } catch (err) {
          return NextResponse.json({ success: false, error: (err as Error).message }, { status: 404 });
        }
      }

      case "target": {
        const target = String(body.id ?? body.asin ?? "").trim();
        if (!target) return NextResponse.json({ success: false, error: "id or asin is required" }, { status: 400 });
        try {
          const updated = await updateTarget(
            target,
            body.targetPrice === null || body.targetPrice === "" ? null : Number(body.targetPrice)
          );
          return NextResponse.json({ success: true, product: updated });
        } catch (err) {
          return NextResponse.json({ success: false, error: (err as Error).message }, { status: 404 });
        }
      }

      // "update" keeps the old panel contract (refresh everything now).
      case "update": {
        const result = await tick(true);
        return NextResponse.json({ success: true, products: await listProducts(), tick: result, status: loopStatus() });
      }

      case "tick": {
        // Called by the instrumentation heartbeat. `force` stays false so a
        // heartbeat can never hammer retailers faster than intervalMin.
        startLoop();
        const result = await tick(false);
        return NextResponse.json({ success: true, ...result, status: loopStatus() });
      }

      case "start":
        return NextResponse.json({ success: true, ...startLoop(Number(body.intervalMin) || undefined) });

      case "stop":
        return NextResponse.json({ success: true, stopped: stopLoop() });

      default:
        return NextResponse.json({ success: false, error: `Invalid action '${action}'` }, { status: 400 });
    }
  } catch (error) {
    console.error("[PriceTracker] POST failed:", error);
    return NextResponse.json({ success: false, error: "Failed to process request", details: String(error) }, { status: 500 });
  }
}
