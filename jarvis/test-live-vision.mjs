import axios from "axios";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const apiKey = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const imageUrl = "https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=200";
const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
const base64Image = Buffer.from(response.data).toString("base64");
const dataUrl = `data:image/jpeg;base64,${base64Image}`;

async function testModel(modelName) {
  console.log(`\n--- Testing model: ${modelName} ---`);
  try {
    const res = await axios.post(
      OPENROUTER_URL,
      {
        model: modelName,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image in detail." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 500,
        temperature: 0.4,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 25000,
      }
    );
    console.log("Content:", JSON.stringify(res.data?.choices?.[0]?.message?.content));
  } catch (err) {
    console.error("Error:", err.response?.status, err.response?.data || err.message);
  }
}

await testModel("nvidia/nemotron-nano-12b-v2-vl:free");
await testModel("google/gemma-4-31b-it:free");
await testModel("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free");
