import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";

// GET /api/ghost/macros/desktop/screenshot?path=... — serve a screenshot as base64
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const filePath = url.searchParams.get("path");

    if (!filePath) {
      return NextResponse.json(
        { success: false, error: "path parameter is required" },
        { status: 400 }
      );
    }

    // Security: only allow files from temp directory
    const tmpDir = os.tmpdir();
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(tmpDir)) {
      return NextResponse.json(
        { success: false, error: "Access denied" },
        { status: 403 }
      );
    }

    const data = await fs.readFile(resolved);
    const base64 = data.toString("base64");

    return NextResponse.json({
      success: true,
      dataUri: `data:image/png;base64,${base64}`,
      width: 0, // Client can read from image
      height: 0,
    });
  } catch (error: any) {
    console.error("[desktop/screenshot] Error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to read screenshot" },
      { status: 500 }
    );
  }
}
