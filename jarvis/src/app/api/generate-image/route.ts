import { NextRequest, NextResponse } from "next/server";

const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;

// Free Stable Diffusion models on Hugging Face
const IMAGE_MODELS = {
  "stable-diffusion-xl": "stabilityai/stable-diffusion-xl-base-1.0",
  "stable-diffusion-v1": "runwayml/stable-diffusion-v1-5",
  "openjourney": "prompthero/openjourney",
  "realistic-vision": "SG161222/Realistic_Vision_V5.1_noVAE",
  "epic-realism": "emilianJR/epiCRealism",
  "anime": "hakurei/waifu-diffusion",
};

async function generateWithHuggingFace(
  prompt: string,
  model: string = IMAGE_MODELS["stable-diffusion-xl"],
  negativePrompt: string = ""
): Promise<Buffer> {
  if (!HUGGINGFACE_API_KEY) {
    throw new Error("HUGGINGFACE_API_KEY not configured");
  }

  const response = await fetch(
    `https://api-inference.huggingface.co/models/${model}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          negative_prompt: negativePrompt || "blurry, low quality, distorted",
          num_inference_steps: 30,
          guidance_scale: 7.5,
          width: 512,
          height: 512,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Hugging Face error: ${response.status} - ${error}`);
  }

  const blob = await response.blob();
  return Buffer.from(await blob.arrayBuffer());
}

async function generateWithPollinations(prompt: string): Promise<string> {
  // Pollinations is a free, no-key image generation API
  const encodedPrompt = encodeURIComponent(prompt);
  return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&nologo=true`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, provider = "pollinations", model, negativePrompt } = body;

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt required" },
        { status: 400 }
      );
    }

    let imageUrl: string;
    let imageData: string | undefined;

    switch (provider) {
      case "huggingface": {
        const selectedModel = IMAGE_MODELS[model as keyof typeof IMAGE_MODELS] || IMAGE_MODELS["stable-diffusion-xl"];
        try {
          const buffer = await generateWithHuggingFace(prompt, selectedModel, negativePrompt);
          imageData = buffer.toString("base64");
          imageUrl = `data:image/png;base64,${imageData}`;
        } catch (error) {
          // Fallback to Pollinations
          console.log("HF failed, falling back to Pollinations:", error);
          imageUrl = await generateWithPollinations(prompt);
        }
        break;
      }

      case "pollinations":
      default: {
        imageUrl = await generateWithPollinations(prompt);
        break;
      }
    }

    return NextResponse.json({
      success: true,
      prompt,
      provider,
      imageUrl,
      // If using base64, also return the data for direct display
      ...(imageData && { base64: imageData }),
    });
  } catch (error) {
    console.error("Image generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate image", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const prompt = searchParams.get("prompt");

  if (!prompt) {
    return NextResponse.json({
      success: true,
      usage: {
        endpoint: "/api/generate-image",
        method: "POST",
        body: {
          prompt: "A minimalist coffee shop logo, modern design, simple colors",
          provider: "pollinations|huggingface",
          model: "stable-diffusion-xl|stable-diffusion-v1|openjourney|realistic-vision|epic-realism|anime",
          negativePrompt: "optional negative prompts",
        },
      },
      providers: {
        pollinations: { cost: "Free", rateLimit: "No limit", quality: "Good" },
        huggingface: { cost: "Free tier: 30k tokens/day", rateLimit: "Variable", quality: "Excellent" },
      },
      models: IMAGE_MODELS,
    });
  }

  // Quick GET generation via Pollinations
  const imageUrl = await generateWithPollinations(prompt);
  return NextResponse.json({
    success: true,
    prompt,
    imageUrl,
  });
}
