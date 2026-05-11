import { NextRequest, NextResponse } from "next/server";

// Vision API using TensorFlow.js or external APIs
// Since OpenCV in Node.js is complex, we'll use browser-based vision
// or cloud vision APIs with free tiers

const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;

interface VisionTask {
  type: "object-detection" | "image-classification" | "face-detection" | "ocr";
  image: string; // base64 or URL
}

async function analyzeWithHuggingFace(imageData: string, model: string) {
  if (!HUGGINGFACE_API_KEY) {
    throw new Error("HUGGINGFACE_API_KEY required");
  }

  // Remove data URL prefix if present
  const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
      "Content-Type": "application/octet-stream",
    },
    body: buffer,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vision API error: ${response.status} - ${error}`);
  }

  return response.json();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, image, useExternal = false } = body;

    if (!type || !image) {
      return NextResponse.json(
        { error: "Type and image required" },
        { status: 400 }
      );
    }

    // Use Hugging Face for vision tasks
    if (useExternal && HUGGINGFACE_API_KEY) {
      let model: string;
      let result;

      switch (type) {
        case "object-detection": {
          model = "facebook/detr-resnet-50";
          result = await analyzeWithHuggingFace(image, model);
          return NextResponse.json({
            success: true,
            type,
            objects: result.map((r: any) => ({
              label: r.label,
              score: r.score,
              box: r.box,
            })),
          });
        }

        case "image-classification": {
          model = "google/vit-base-patch16-224";
          result = await analyzeWithHuggingFace(image, model);
          return NextResponse.json({
            success: true,
            type,
            classifications: result.slice(0, 5).map((r: any) => ({
              label: r.label,
              score: r.score,
            })),
          });
        }

        case "face-detection": {
          // Use a face detection model
          return NextResponse.json({
            success: true,
            type,
            message: "Face detection available",
            note: "For production, use browser-based face-api.js or cloud services",
            faces: [],
          });
        }

        case "ocr": {
          model = "microsoft/trocr-base-printed";
          result = await analyzeWithHuggingFace(image, model);
          return NextResponse.json({
            success: true,
            type,
            text: result.generated_text || result[0]?.generated_text,
          });
        }

        default:
          return NextResponse.json(
            { error: "Unknown vision type" },
            { status: 400 }
          );
      }
    }

    // Fallback: return instructions for browser-based vision
    return NextResponse.json({
      success: true,
      mode: "browser",
      type,
      message: "Browser-based vision processing",
      instructions: {
        objectDetection: "Use @tensorflow-models/coco-ssd in browser",
        faceDetection: "Use face-api.js in browser",
        ocr: "Use tesseract.js in browser",
      },
      demo: {
        objects: [
          { label: "person", confidence: 0.95, box: [100, 200, 300, 400] },
          { label: "chair", confidence: 0.87, box: [50, 150, 150, 300] },
        ],
      },
    });
  } catch (error) {
    console.error("Vision API error:", error);
    return NextResponse.json(
      { error: "Vision analysis failed", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    success: true,
    visionCapabilities: {
      browserBased: {
        description: "Real-time processing in browser",
        technologies: [
          "TensorFlow.js - Object detection",
          "face-api.js - Face detection & recognition",
          "tesseract.js - OCR (text recognition)",
          "MediaPipe - Various vision tasks",
        ],
        advantages: [
          "No server latency",
          "Privacy (images stay local)",
          "Free (no API costs)",
        ],
      },
      cloudBased: {
        description: "Hugging Face Inference API",
        requirements: ["HUGGINGFACE_API_KEY"],
        models: {
          objectDetection: "facebook/detr-resnet-50",
          classification: "google/vit-base-patch16-224",
          ocr: "microsoft/trocr-base-printed",
        },
      },
    },
    usage: {
      endpoint: "/api/vision",
      method: "POST",
      body: {
        type: "object-detection|image-classification|face-detection|ocr",
        image: "base64-encoded-image-or-url",
        useExternal: false,
      },
    },
  });
}
