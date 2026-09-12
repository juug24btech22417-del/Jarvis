import { NextRequest, NextResponse } from "next/server";
import {
  listMacros,
  getMacro,
  saveMacro,
  updateMacro,
  deleteMacro,
} from "@/lib/ghost/macroStore";

// GET /api/ghost/macros — list all macros or get a specific one
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (id) {
      const macro = await getMacro(id);
      if (!macro) {
        return NextResponse.json(
          { success: false, error: "Macro not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, macro });
    }

    const limit = parseInt(url.searchParams.get("limit") || "50");
    const tag = url.searchParams.get("tag") || undefined;
    const isFormFill = url.searchParams.get("formFill") === "true" ? true : undefined;

    const macros = await listMacros({ limit, tag, isFormFill });
    return NextResponse.json({ success: true, macros, count: macros.length });
  } catch (error: any) {
    console.error("[ghost/macros] GET error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

// POST /api/ghost/macros — create a new macro
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, steps, isFormFill, targetUrl, tags } = body;

    if (!name) {
      return NextResponse.json(
        { success: false, error: "Macro name is required" },
        { status: 400 }
      );
    }

    const macro = await saveMacro({
      name,
      description: description || "",
      steps: steps || [],
      isFormFill: isFormFill || false,
      targetUrl,
      tags: tags || [],
    });

    return NextResponse.json({ success: true, macro });
  } catch (error: any) {
    console.error("[ghost/macros] POST error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

// PUT /api/ghost/macros — update an existing macro
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Macro id is required" },
        { status: 400 }
      );
    }

    const macro = await updateMacro(id, updates);
    if (!macro) {
      return NextResponse.json(
        { success: false, error: "Macro not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, macro });
  } catch (error: any) {
    console.error("[ghost/macros] PUT error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

// DELETE /api/ghost/macros?id=xxx — delete a macro
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Macro id is required" },
        { status: 400 }
      );
    }

    const deleted = await deleteMacro(id);
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Macro not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: "Macro deleted" });
  } catch (error: any) {
    console.error("[ghost/macros] DELETE error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
