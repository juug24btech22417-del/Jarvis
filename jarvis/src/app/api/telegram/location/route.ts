// Read/upsert the user's last-known location.
//
//   GET  /api/telegram/location?chatId=X  → { location | null }
//   POST /api/telegram/location           → upsert
//
// Body: { chatId, latitude, longitude, accuracyM?, livePeriodSeconds?, heading? }

import { NextRequest, NextResponse } from "next/server";
import {
  upsertUserLocation,
  getUserLocation,
} from "@/lib/telegram/location";

export async function GET(req: NextRequest) {
  const chatIdStr = req.nextUrl.searchParams.get("chatId");
  if (!chatIdStr) {
    return NextResponse.json(
      { error: "chatId query param required" },
      { status: 400 }
    );
  }
  const loc = await getUserLocation(Number(chatIdStr));
  return NextResponse.json({ location: loc });
}

interface UpsertBody {
  chatId?: number;
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
  livePeriodSeconds?: number;
  heading?: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as UpsertBody;
    if (
      !body.chatId ||
      typeof body.latitude !== "number" ||
      typeof body.longitude !== "number"
    ) {
      return NextResponse.json(
        { error: "chatId, latitude, longitude required" },
        { status: 400 }
      );
    }
    await upsertUserLocation(body.chatId, {
      latitude: body.latitude,
      longitude: body.longitude,
      accuracyM: body.accuracyM ?? null,
      livePeriodSeconds: body.livePeriodSeconds ?? null,
      heading: body.heading ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[api/telegram/location] POST error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "internal error" },
      { status: 500 }
    );
  }
}