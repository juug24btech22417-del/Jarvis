// Debug endpoint — proxies a `getFile` + download from Telegram and
// returns the bytes inline. Used for panel media preview, curl-based
// inspection, and any vision route that prefers URL-fetch over base64.

import { NextRequest, NextResponse } from "next/server";
import { downloadTelegramFile, getFileMeta } from "@/lib/telegram/media";

export async function GET(
  req: NextRequest,
  ctx: { params: { fileId: string } }
) {
  const fileId = ctx.params.fileId;
  const wantMeta = req.nextUrl.searchParams.get("meta") === "1";

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN not set" }, { status: 500 });
  }

  try {
    if (wantMeta) {
      const meta = await getFileMeta(token, fileId);
      return NextResponse.json({ meta });
    }
    const buf = await downloadTelegramFile(token, fileId);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(buf.length),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "download failed" },
      { status: 500 }
    );
  }
}