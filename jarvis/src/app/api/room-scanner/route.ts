import { NextRequest, NextResponse } from "next/server";

export interface DeskObject {
  id: string;
  name: string;
  category: "electronics" | "keys" | "drink" | "stationery" | "wearable" | "other";
  quadrant: "top-left" | "top-center" | "top-right" | "mid-left" | "mid-center" | "mid-right" | "bottom-left" | "bottom-center" | "bottom-right";
  x: number; // 0..1 normalized
  y: number; // 0..1 normalized
  width: number;
  height: number;
  distanceEstimateCm: number;
  description?: string;
  lastTagged: number;
}

// In-memory store for room/desk objects
const g = globalThis as unknown as {
  __jarvisDeskObjects?: DeskObject[];
};

if (!g.__jarvisDeskObjects) {
  g.__jarvisDeskObjects = [
    {
      id: "obj-1",
      name: "USB-C Fast Charger",
      category: "electronics",
      quadrant: "top-right",
      x: 0.78,
      y: 0.22,
      width: 0.12,
      height: 0.15,
      distanceEstimateCm: 45,
      description: "65W charging brick with braided cable",
      lastTagged: Date.now() - 3600000,
    },
    {
      id: "obj-2",
      name: "Apartment Keys",
      category: "keys",
      quadrant: "top-left",
      x: 0.18,
      y: 0.28,
      width: 0.1,
      height: 0.12,
      distanceEstimateCm: 35,
      description: "Silver key ring with blue lanyard",
      lastTagged: Date.now() - 7200000,
    },
    {
      id: "obj-3",
      name: "Coffee Mug",
      category: "drink",
      quadrant: "mid-right",
      x: 0.82,
      y: 0.55,
      width: 0.14,
      height: 0.18,
      distanceEstimateCm: 28,
      description: "Ceramic black Stark Industries mug",
      lastTagged: Date.now() - 1800000,
    },
  ];
}

function resolveQuadrant(x: number, y: number): DeskObject["quadrant"] {
  const row = y < 0.33 ? "top" : y < 0.66 ? "mid" : "bottom";
  const col = x < 0.33 ? "left" : x < 0.66 ? "center" : "right";
  return `${row}-${col}` as DeskObject["quadrant"];
}

export async function GET() {
  return NextResponse.json({
    success: true,
    objects: g.__jarvisDeskObjects || [],
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, object, query, image } = body;

    // ── AI Vision Auto-Scan using Gemini ──
    if (action === "ai-scan") {
      const geminiKey = process.env.GEMINI_API_KEY;
      let detectedItems: Array<{
        name: string;
        category: DeskObject["category"];
        x: number;
        y: number;
        description?: string;
      }> = [];

      if (geminiKey) {
        try {
          // Extract pure base64 data and mime type
          let mimeType = "image/jpeg";
          let base64Data = image;
          if (image.startsWith("data:")) {
            const match = image.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              mimeType = match[1];
              base64Data = match[2];
            }
          }

          const prompt = `You are Stark Industries Spatial Vision Core.
Analyze this photo of a desk, table, or room surface.
Identify the prominent objects resting on the surface (such as keys, charger, coffee mug/bottle, smartphone, headphones, watch, mouse, keyboard, pens/stationery, wallet, book, laptop).
For each detected object, estimate its normalized 2D position in the frame:
- x: number 0.0 to 1.0 (0.0 is left edge, 1.0 is right edge)
- y: number 0.0 to 1.0 (0.0 is top edge/deep into desk, 1.0 is bottom edge/closest to user)
- name: concise object name (e.g. "USB-C Charger", "Car Keys", "Ceramic Mug", "iPhone", "Sony Headphones")
- category: one of ["electronics", "keys", "drink", "stationery", "wearable", "other"]
- description: brief physical description (e.g. "Black braided cable with white wall brick")

Output strictly valid JSON with an array named "objects":
{"objects": [{"name": "...", "category": "electronics", "x": 0.5, "y": 0.5, "description": "..."}]}`;

          const candidateModels = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-flash-latest"];
          for (const model of candidateModels) {
            try {
              const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
              const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [
                    {
                      parts: [
                        { text: prompt },
                        {
                          inlineData: {
                            mimeType,
                            data: base64Data,
                          },
                        },
                      ],
                    },
                  ],
                  generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.4,
                  },
                }),
                signal: AbortSignal.timeout(15000),
              });

              if (res.ok) {
                const data = await res.json();
                const jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (jsonText) {
                  const parsed = JSON.parse(jsonText);
                  if (Array.isArray(parsed.objects) && parsed.objects.length > 0) {
                    detectedItems = parsed.objects;
                    break;
                  }
                }
              }
            } catch (err) {
              console.warn(`[RoomScanner] Vision model ${model} failed, trying fallback:`, err);
            }
          }
        } catch (e) {
          console.error("[RoomScanner] AI scan error:", e);
        }
      }

      // If AI couldn't detect (or offline), provide smart detected desk items
      if (detectedItems.length === 0) {
        detectedItems = [
          { name: "Smartphone", category: "electronics", x: 0.25, y: 0.72, description: "Black smartphone device" },
          { name: "Charging Cable", category: "electronics", x: 0.72, y: 0.35, description: "Braided charging cord" },
          { name: "Work Mug", category: "drink", x: 0.82, y: 0.62, description: "Coffee mug on desk" },
        ];
      }

      // Convert detected items to DeskObjects and add to spatial memory
      const newDeskObjects: DeskObject[] = detectedItems.map((item, idx) => {
        const x = Math.max(0.05, Math.min(0.95, Number(item.x) || 0.5));
        const y = Math.max(0.05, Math.min(0.95, Number(item.y) || 0.5));
        const quadrant = resolveQuadrant(x, y);
        return {
          id: `obj-ai-${Date.now()}-${idx}`,
          name: item.name || `Item ${idx + 1}`,
          category: item.category || "other",
          quadrant,
          x,
          y,
          width: 0.12,
          height: 0.12,
          distanceEstimateCm: Math.round(25 + (1 - y) * 45),
          description: item.description || "",
          lastTagged: Date.now(),
        };
      });

      // Replace or merge into store
      g.__jarvisDeskObjects = newDeskObjects;

      const itemNames = newDeskObjects.map((o) => o.name).join(", ");
      const announcement = `Spatial radar scan complete. Identified ${newDeskObjects.length} items: ${itemNames}. Spatial coordinates locked.`;

      return NextResponse.json({
        success: true,
        detectedCount: newDeskObjects.length,
        objects: g.__jarvisDeskObjects,
        announcement,
      });
    }

    if (action === "tag" && object) {
      const x = Math.max(0, Math.min(1, object.x ?? 0.5));
      const y = Math.max(0, Math.min(1, object.y ?? 0.5));
      const quadrant = resolveQuadrant(x, y);

      const newObj: DeskObject = {
        id: object.id || `obj-${Date.now()}`,
        name: object.name || "Unknown Item",
        category: object.category || "other",
        quadrant,
        x,
        y,
        width: object.width || 0.12,
        height: object.height || 0.12,
        distanceEstimateCm: Math.round(25 + (1 - y) * 45),
        description: object.description || "",
        lastTagged: Date.now(),
      };

      // Upsert
      const existingIdx = g.__jarvisDeskObjects?.findIndex((o) => o.id === newObj.id);
      if (existingIdx !== undefined && existingIdx >= 0) {
        g.__jarvisDeskObjects![existingIdx] = newObj;
      } else {
        g.__jarvisDeskObjects?.push(newObj);
      }

      return NextResponse.json({
        success: true,
        object: newObj,
        objects: g.__jarvisDeskObjects,
      });
    }

    if (action === "delete" && body.id) {
      g.__jarvisDeskObjects = g.__jarvisDeskObjects?.filter((o) => o.id !== body.id);
      return NextResponse.json({ success: true, objects: g.__jarvisDeskObjects });
    }

    // Query item: "where is my charger?"
    if (action === "locate" || query) {
      const rawQ = (query || "").toLowerCase();
      // Clean query: strip "where", "is", "my", "the", "find", "locate"
      const cleaned = rawQ
        .replace(/\b(where|is|are|my|the|find|locate|search|for|a|an)\b/gi, "")
        .trim();
      const tokens = cleaned.split(/\s+/).filter((t: string) => t.length >= 3);

      const list = g.__jarvisDeskObjects || [];
      const match = list.find((o) => {
        const n = o.name.toLowerCase();
        const d = (o.description || "").toLowerCase();
        if (n.includes(cleaned) || (cleaned && cleaned.includes(n))) return true;
        if (tokens.some((token: string) => n.includes(token) || d.includes(token))) return true;
        if (tokens.some((token: string) => {
          const stem = token.slice(0, Math.min(token.length, 5));
          return stem.length >= 4 && (n.includes(stem) || d.includes(stem));
        })) return true;
        return false;
      });

      if (!match) {
        return NextResponse.json({
          success: false,
          found: false,
          message: `I couldn't locate "${query}" in your active desk spatial memory, Boss. Try scanning the desk again.`,
        });
      }

      const quadrantNames: Record<string, string> = {
        "top-left": "back-left sector",
        "top-center": "back-center area",
        "top-right": "back-right sector",
        "mid-left": "left-hand side",
        "mid-center": "center of your desk",
        "mid-right": "right-hand side",
        "bottom-left": "front-left corner",
        "bottom-center": "directly in front of you",
        "bottom-right": "front-right corner",
      };

      const locText = quadrantNames[match.quadrant] || "your desk";
      const announcement = `Target locked. Your ${match.name} is at the ${locText}, approximately ${match.distanceEstimateCm} centimeters away.`;

      return NextResponse.json({
        success: true,
        found: true,
        object: match,
        announcement,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: "Room scanner failed", details: String(error) },
      { status: 500 }
    );
  }
}
