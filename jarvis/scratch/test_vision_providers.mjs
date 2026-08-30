// Quick diagnostic: test both NVIDIA and Groq vision APIs with a tiny 1x1 red pixel JPEG
import { readFileSync } from "fs";
import { config } from "dotenv";

config({ path: ".env.local" });

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const GROQ_API_KEY   = process.env.GROQ_API_KEY;

// 1x1 red pixel JPEG (smallest valid JPEG possible)
const TINY_JPEG_B64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARC AABAAEDASIA/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAHxAAAQQDAAMAAAAAAAAAAAAAAQIDBAUREiEx/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKjLiyMqXEVKpI3YKKmq5JBX53JO8tPuAA//2Q==";

const PROMPT = "Describe this image in one word.";

async function testNVIDIA() {
  console.log("\n=== Testing NVIDIA ===");
  if (!NVIDIA_API_KEY) { console.log("❌ NVIDIA_API_KEY missing"); return; }
  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${NVIDIA_API_KEY}` },
      body: JSON.stringify({
        model: "meta/llama-3.2-90b-vision-instruct",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${TINY_JPEG_B64}` } }
          ]
        }],
        max_tokens: 50,
        temperature: 0.1,
      }),
    });
    const body = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Body: ${body.slice(0, 500)}`);
  } catch (e) {
    console.log("Error:", e.message);
  }
}

async function testGroq() {
  console.log("\n=== Testing Groq (llama-3.2-11b-vision-instruct) ===");
  if (!GROQ_API_KEY) { console.log("❌ GROQ_API_KEY missing"); return; }
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.2-11b-vision-instruct",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${TINY_JPEG_B64}` } }
          ]
        }],
        max_tokens: 50,
        temperature: 0.1,
      }),
    });
    const body = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Body: ${body.slice(0, 500)}`);
  } catch (e) {
    console.log("Error:", e.message);
  }
}

async function testGroqScout() {
  console.log("\n=== Testing Groq (meta-llama/llama-4-scout-17b-16e-instruct) ===");
  if (!GROQ_API_KEY) { console.log("❌ GROQ_API_KEY missing"); return; }
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${TINY_JPEG_B64}` } }
          ]
        }],
        max_tokens: 50,
        temperature: 0.1,
      }),
    });
    const body = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Body: ${body.slice(0, 500)}`);
  } catch (e) {
    console.log("Error:", e.message);
  }
}

async function listGroqModels() {
  console.log("\n=== Groq Available Models ===");
  if (!GROQ_API_KEY) return;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    });
    const data = await res.json();
    console.log("All Groq models:", data.data?.map(m => m.id));
  } catch (e) {
    console.log("Error:", e.message);
  }
}

async function testOpenRouter() {
  console.log("\n=== Testing OpenRouter Free Models ===");
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) { console.log("❌ OPENROUTER_API_KEY missing"); return; }
  
  const realB64 = readFileSync("zoom_webinar_reg.png").toString("base64");
  
  const models = [
    "thinkingmachines/inkling:free",
    "thinkingmachines/inkling-small:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "google/gemma-4-31b-it:free"
  ];

  for (const model of models) {
    console.log(`\nTesting model: ${model}...`);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "Jarvis"
        },
        body: JSON.stringify({
          model: model,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: `data:image/png;base64,${realB64}` } }
            ]
          }],
          max_tokens: 50,
        }),
      });
      const body = await res.text();
      console.log(`Status: ${res.status}`);
      console.log(`Body: ${body.slice(0, 300)}`);
    } catch (e) {
      console.log(`Error testing ${model}:`, e.message);
    }
  }
}

async function listOpenRouterModels() {
  console.log("\n=== OpenRouter Available Vision Models ===");
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    const data = await res.json();
    
    const visionModels = data.data?.filter(m => {
      const id = m.id.toLowerCase();
      const desc = (m.description || "").toLowerCase();
      // Check if model name or description indicates vision/multimodal/image/vl
      const isVision = id.includes("vision") || id.includes("vl") || id.includes("gemini") || id.includes("clip") || id.includes("multimodal") || desc.includes("multimodal") || desc.includes("image") || desc.includes("vision");
      return isVision;
    });

    console.log("Vision Models:");
    visionModels.slice(0, 40).forEach(m => {
      console.log(` - ID: ${m.id}`);
      console.log(`   Price: Prompt=${m.pricing?.prompt}, Completion=${m.pricing?.completion}`);
    });
  } catch (e) {
    console.log("Error:", e.message);
  }
}

await listGroqModels();
await listOpenRouterModels();
await testNVIDIA();
await testGroq();
await testGroqScout();
await testOpenRouter();
